import { CleanlinessAdapter } from "./CleanlinessAdapter.js";
import { CurrencyAdapter } from "./CurrencyAdapter.js";
import { TavernPricing } from "./TavernPricing.js";
import { TavernState } from "./TavernState.js";

const PURCHASE_CATEGORIES = new Map([
  ["food", "food"],
  ["drink", "drinks"],
  ["drinks", "drinks"],
  ["room", "lodging"],
  ["rooms", "lodging"],
  ["lodging", "lodging"],
  ["service", "services"],
  ["services", "services"]
]);

const MAX_CART_LINES = 50;
const MAX_QUANTITY = 99;
const MAX_DAYS = 365;

export class TavernPurchaseService {
  static normalizeLines(items) {
    if (!Array.isArray(items) || !items.length) throw new Error("Корзина пуста.");
    if (items.length > MAX_CART_LINES) throw new Error(`В корзине слишком много строк. Максимум: ${MAX_CART_LINES}.`);

    return items.map((item) => {
      const category = PURCHASE_CATEGORIES.get(String(item?.category ?? "").trim());
      if (!category) throw new Error("Некорректная категория покупки.");

      const entryId = String(item?.entryId ?? "").trim();
      if (!entryId) throw new Error("У позиции покупки отсутствует идентификатор.");

      const quantity = this.#boundedInteger(item?.quantity, 1, MAX_QUANTITY);
      const days = category === "lodging" ? this.#boundedInteger(item?.days, 1, MAX_DAYS) : 1;
      const quotedPrice = item?.unitPrice == null ? null : Number(item.unitPrice);
      if (quotedPrice !== null && (!Number.isSafeInteger(quotedPrice) || quotedPrice < 1)) throw new Error("Некорректная цена в корзине.");
      return { category, entryId, quantity, days, quotedPrice };
    });
  }

  static async execute({ userId, actorId, tavernId = null, sceneId = null, items = [], requestId = null, expectedTotal = null } = {}) {
    const lines = this.normalizeLines(items);
    return TavernState.transaction((transaction) => this.#executeLocked({ userId, actorId, tavernId, sceneId, lines, requestId, expectedTotal, transaction }));
  }

  static async #executeLocked({ userId, actorId, tavernId, sceneId, lines, requestId, expectedTotal, transaction }) {
    const user = game.users.get(String(userId ?? ""));
    const actor = game.actors.get(String(actorId ?? ""));

    if (!user) throw new Error("Пользователь не найден.");
    if (!user.active) throw new Error("Пользователь больше не подключен к миру.");
    if (!actor) throw new Error("Актер не найден.");
    if (!actor.testUserPermission(user, "OWNER")) throw new Error(`${user.name} не владеет актером ${actor.name}.`);

    const receiptId = JSON.stringify([user.id, requestId || foundry.utils.randomID(20)]);
    const fingerprint = JSON.stringify({ actorId, tavernId, sceneId, lines, expectedTotal });
    const previous = TavernState.getPurchase(receiptId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new Error("Этот номер покупки уже использован для другой корзины.");
      if (previous.status === "completed") {
        let tavern = null;
        try { tavern = TavernState.resolveTrustedTavern({ tavernId: previous.tavernId, sceneId }); } catch (_error) { /* Tavern may have been deleted since the purchase. */ }
        return { ...previous.result, actor, user, tavern, replayed: true };
      }
      if (previous.status === "failed") throw new Error(previous.message);
      throw this.#pendingError();
    }
    if (TavernState.pendingPurchases().some((record) => record.actorId === actor.id)) throw this.#pendingError();

    let tavern = TavernState.resolveTrustedTavern({ tavernId, sceneId });
    let total = 0;
    const purchaseLines = [];
    const cleanlinessEntries = [];

    for (const line of lines) {
      const entry = TavernState.findEntry(tavern, line.category, line.entryId);
      if (!entry) throw new Error("Позиция таверны не найдена или меню уже изменилось.");

      const unitPrice = TavernPricing.effectiveEntryPrice(entry, tavern, { category: line.category });
      if (line.quotedPrice !== null && line.quotedPrice !== unitPrice) {
        throw new Error("Цена в меню изменилась. Корзина обновлена; проверь сумму и нажми «Оплатить» ещё раз. Деньги не списаны.");
      }
      const lineTotal = unitPrice * line.quantity * (line.category === "lodging" ? line.days : 1);
      const result = TavernState.purchaseEntryInData(tavern, line.category, line.entryId, {
        quantity: line.quantity,
        days: line.days,
        actorId: actor.id,
        userId: user.id,
        actorName: actor.name
      });

      tavern = result.tavern;
      total += lineTotal;
      purchaseLines.push({
        ...line,
        lodging: line.category === "lodging",
        entryName: result.entry.name,
        unitPrice,
        total: lineTotal,
        booking: result.booking
      });

      if (line.category === "services" && result.entry?.cleanliness) cleanlinessEntries.push(result.entry);
    }

    if (expectedTotal !== null && Number(expectedTotal) !== total) {
      throw new Error("Сумма корзины изменилась. Проверь обновлённые цены и подтверди оплату ещё раз. Деньги не списаны.");
    }
    CurrencyAdapter.assertCanAfford(actor, total);
    const walletSnapshot = CurrencyAdapter.snapshot(actor);
    const storageSnapshot = TavernState.snapshotTavernStorage(tavern.id);
    const receipt = {
      fingerprint, status: "pending", createdAt: Date.now(), userId: user.id, actorId: actor.id,
      tavernId: tavern.id, total, walletBefore: walletSnapshot,
      result: { lines: purchaseLines, total, cleanlinessMessages: [] }
    };
    await TavernState.recordPurchase(receiptId, receipt, { transaction });

    let updatedTavern;
    try {
      await CurrencyAdapter.spend(actor, total);
      updatedTavern = await TavernState.persistPurchaseTavern(tavern, {
        transaction, receipt: { id: receiptId, record: { ...receipt, status: "completed" } }
      });
    } catch (error) {
      const rollbackErrors = [];
      try {
        await TavernState.restoreTavernStorageSnapshot(storageSnapshot, { transaction });
      } catch (rollbackError) {
        rollbackErrors.push(`состояние таверны: ${rollbackError.message ?? rollbackError}`);
      }
      try {
        await CurrencyAdapter.restore(actor, walletSnapshot);
      } catch (rollbackError) {
        rollbackErrors.push(`кошелек: ${rollbackError.message ?? rollbackError}`);
      }

      if (rollbackErrors.length) {
        console.error("fbl-tavern-generator | Purchase rollback incomplete", rollbackErrors);
        const pendingError = this.#pendingError();
        pendingError.message = `${error.message ?? error}. Откат выполнен не полностью; ГМу нужно проверить ${rollbackErrors.join(" и ")}.`;
        throw pendingError;
      }
      await TavernState.recordPurchase(receiptId, { ...receipt, status: "failed", message: error.message ?? String(error) }, { transaction });
      throw error;
    }

    const cleanlinessMessages = [];
    for (const entry of cleanlinessEntries) {
      try {
        const result = await CleanlinessAdapter.applyFromEntry(actor, entry);
        if (result?.message) cleanlinessMessages.push(result.message);
      } catch (error) {
        console.warn("fbl-tavern-generator | Cleanliness effect failed after committed purchase", error);
        const message = `Помытость не применена автоматически: ${error?.message ?? error}. ГМ должен проверить состояние актера.`;
        cleanlinessMessages.push(message);
        globalThis.ui?.notifications?.warn?.(message);
      }
    }

    if (cleanlinessMessages.length) {
      try {
        await TavernState.recordPurchase(receiptId, {
          ...receipt, status: "completed", result: { ...receipt.result, cleanlinessMessages }
        }, { transaction });
      } catch (error) {
        console.warn("fbl-tavern-generator | Could not save cleanliness receipt", error);
      }
    }

    return {
      actor,
      user,
      tavern: updatedTavern,
      lines: purchaseLines,
      total,
      cleanlinessMessages
    };
  }

  static #boundedInteger(value, min, max) {
    const number = Math.trunc(Number(value) || min);
    return Math.max(min, Math.min(max, number));
  }

  static #pendingError() {
    const error = new Error("Предыдущая попытка оплаты прервалась. Повторное списание остановлено; ГМ должен сверить кошелёк и журнал покупок (game.fblTaverns.pendingPurchases()).");
    error.code = "PURCHASE_PENDING";
    return error;
  }
}
