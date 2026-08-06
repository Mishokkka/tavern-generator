import { AsyncLock } from "./AsyncLock.js";
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
      return { category, entryId, quantity, days };
    });
  }

  static async execute({ userId, actorId, tavernId = null, sceneId = null, items = [] } = {}) {
    const lines = this.normalizeLines(items);
    return AsyncLock.run("tavern-purchases", () => this.#executeLocked({ userId, actorId, tavernId, sceneId, lines }));
  }

  static async #executeLocked({ userId, actorId, tavernId, sceneId, lines }) {
    const user = game.users.get(String(userId ?? ""));
    const actor = game.actors.get(String(actorId ?? ""));

    if (!user) throw new Error("Пользователь не найден.");
    if (!user.active) throw new Error("Пользователь больше не подключен к миру.");
    if (!actor) throw new Error("Актер не найден.");
    if (!actor.testUserPermission(user, "OWNER")) throw new Error(`${user.name} не владеет актером ${actor.name}.`);

    let tavern = TavernState.resolveTrustedTavern({ tavernId, sceneId });
    let total = 0;
    const purchaseLines = [];
    const cleanlinessEntries = [];

    for (const line of lines) {
      const entry = TavernState.findEntry(tavern, line.category, line.entryId);
      if (!entry) throw new Error("Позиция таверны не найдена или меню уже изменилось.");

      const unitPrice = TavernPricing.effectiveEntryPrice(entry, tavern, { category: line.category });
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

    CurrencyAdapter.assertCanAfford(actor, total);
    const walletSnapshot = CurrencyAdapter.snapshot(actor);
    const storageSnapshot = TavernState.snapshotTavernStorage(tavern.id);

    let updatedTavern;
    try {
      await CurrencyAdapter.spend(actor, total);
      updatedTavern = await TavernState.persistPurchaseTavern(tavern);
    } catch (error) {
      const rollbackErrors = [];
      try {
        await TavernState.restoreTavernStorageSnapshot(storageSnapshot);
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
        throw new Error(`${error.message ?? error}. Откат выполнен не полностью; ГМу нужно проверить ${rollbackErrors.join(" и ")}.`);
      }
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
}
