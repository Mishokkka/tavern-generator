import { MODULE_ID } from "../constants.js";
import { TavernState } from "./TavernState.js";
import { TavernGenerator } from "./TavernGenerator.js";
import { TavernPlayerApp } from "../apps/TavernPlayerApp.js";
import { PurchaseSoundService } from "./PurchaseSoundService.js";
import { TavernPurchaseService } from "./TavernPurchaseService.js";
import { TavernAtmosphereService } from "./TavernAtmosphereService.js";
import { TavernSocketRelay } from "./TavernSocketRelay.js";

export class TavernSocket {
  static #registered = false;
  static #available = false;
  static #registrationError = null;
  static #routes = new Map();
  static #inFlightRequests = new Map();

  static async register() {
    if (this.#registered) return this.#available;
    this.#registered = true;

    try {
      this.#available = TavernSocketRelay.register((payload, sender) => this.#onMessage(payload, sender));
      if (!this.#available) throw new Error("Канал module socket недоступен.");
      this.#registrationError = null;
    } catch (error) {
      this.#available = false;
      this.#registrationError = error;
      console.error(`${MODULE_ID} | Module socket is unavailable`, error);
    }

    return this.#available;
  }

  static get available() {
    return this.#available;
  }

  static on(type, handler) {
    const key = String(type ?? "").trim();
    if (!key || typeof handler !== "function") throw new Error("Некорректный socket route.");
    this.#routes.set(key, handler);
  }

  static async emit(payload, options = {}) {
    if (!this.#available) {
      throw this.#registrationError ?? new Error("Канал синхронизации таверны недоступен на этом клиенте.");
    }
    return TavernSocketRelay.emit(payload, options);
  }

  static async emitToUser(payload, userId) {
    const targetUserId = String(userId ?? "").trim();
    if (!targetUserId) throw new Error("Получатель сообщения таверны не указан.");
    return this.emit(payload, { targetUserId });
  }

  static openForPlayers() {
    if (!game.user?.isGM) return;
    if (!this.#available) return ui.notifications.warn("Канал синхронизации таверны недоступен. Перезагрузи страницу и проверь права пользователя Foundry.");
    void this.#safeEmit({
      type: "open-player",
      tavernData: TavernAtmosphereService.publicView(TavernState.getCurrent())
    });
  }

  static refreshAll(tavernData = null) {
    const publicData = tavernData ? TavernAtmosphereService.publicView(tavernData) : null;
    if (game.user?.isGM && tavernData && publicData) {
      void this.#syncLinkedSceneSnapshot(tavernData, publicData).catch((error) => {
        console.warn(`${MODULE_ID} | Could not synchronize linked scene tavern snapshot`, error);
      });
    }
    this.refreshLocal(publicData);
    if (game.user?.isGM && this.#available) void this.#safeEmit({ type: "refresh", tavernData: publicData });
  }

  static refreshLocal(tavernData = null) {
    TavernPlayerApp.receiveTavernUpdate(tavernData);
    TavernPlayerApp.renderOpenInstances();
    Hooks.callAll(`${MODULE_ID}.refresh`, { sender: game.user.id, tavernData });
  }

  static async #syncLinkedSceneSnapshot(tavern, publicData) {
    const sceneId = tavern?.scene?.id ?? null;
    const scene = sceneId ? game.scenes?.get?.(sceneId) : null;
    if (!scene) return false;

    const link = scene.getFlag?.(MODULE_ID, "shopButton") ?? scene.flags?.[MODULE_ID]?.shopButton;
    const update = {
      [`flags.${MODULE_ID}.tavernPublicView`]: publicData,
      [`flags.${MODULE_ID}.-=tavernData`]: null
    };
    if (link) {
      const nextLink = {
        ...foundry.utils.deepClone(link),
        tavernId: tavern.id,
        tavernName: tavern.name,
        tavernPublicView: publicData,
        updatedAt: Date.now()
      };
      delete nextLink.tavernData;
      update[`flags.${MODULE_ID}.shopButton`] = nextLink;
    }

    if (typeof scene.update === "function") await scene.update(update);
    else {
      await scene.setFlag?.(MODULE_ID, "tavernPublicView", publicData);
      await scene.unsetFlag?.(MODULE_ID, "tavernData");
      if (update[`flags.${MODULE_ID}.shopButton`]) {
        await scene.setFlag?.(MODULE_ID, "shopButton", update[`flags.${MODULE_ID}.shopButton`]);
      }
    }
    return true;
  }

  static async requestPurchase({ actorId, category, entryId, quantity = 1, days = 1, tavernId = null, sceneId = null, requestId = foundry.utils.randomID(20) }) {
    const targetGM = this.responsibleGMId();
    if (!targetGM) {
      ui.notifications.warn("Нет активного ГМа, который может обработать покупку.");
      return null;
    }
    if (targetGM !== game.user.id && !this.#available) {
      ui.notifications.warn("Канал синхронизации таверны недоступен. Перезагрузи страницу и проверь права пользователя Foundry.");
      return null;
    }

    const payload = {
      type: "purchase-request",
      requestId,
      targetGM,
      actorId,
      category,
      entryId,
      quantity,
      days,
      tavernId,
      sceneId
    };

    if (targetGM === game.user.id) {
      payload.sender = game.user.id;
      await this.#handlePurchase(payload);
    } else {
      await this.emit(payload);
    }
    return requestId;
  }

  static async requestCartPurchase({ actorId, items = [], tavernId = null, sceneId = null, expectedTotal = null, requestId = foundry.utils.randomID(20) }) {
    const targetGM = this.responsibleGMId();
    if (!targetGM) {
      ui.notifications.warn("Нет активного ГМа, который может обработать оплату корзины.");
      return null;
    }
    if (targetGM !== game.user.id && !this.#available) {
      ui.notifications.warn("Канал синхронизации таверны недоступен. Перезагрузи страницу и проверь права пользователя Foundry.");
      return null;
    }

    const payload = {
      type: "cart-purchase-request",
      expectedTotal,
      requestId,
      targetGM,
      actorId,
      items,
      tavernId,
      sceneId
    };

    if (targetGM === game.user.id) {
      payload.sender = game.user.id;
      await this.#handleCartPurchase(payload);
    } else {
      await this.emit(payload);
    }
    return requestId;
  }

  static responsibleGMId() {
    const users = typeof game.users?.filter === "function"
      ? game.users.filter((user) => user.active && user.isGM)
      : [...(game.users ?? [])].filter((user) => user.active && user.isGM);
    return users.sort((a, b) => a.id.localeCompare(b.id))[0]?.id ?? null;
  }

  static isResponsibleGM() {
    return Boolean(game.user?.isGM && this.responsibleGMId() === game.user.id);
  }

  static async #onMessage(payload, sender) {
    const type = String(payload?.type ?? "").trim();
    if (!type || !sender?.id || payload?.sender !== sender.id) return;

    if (type === "open-player") {
      if (!sender.isGM || game.user.isGM) return;
      TavernPlayerApp.openSingleton({ tavern: payload.tavernData ?? null, followCurrent: true });
      return;
    }

    if (type === "refresh") {
      if (!sender.isGM || sender.id === game.user.id) return;
      this.refreshLocal(payload.tavernData ?? null);
      return;
    }

    if (type === "purchase-result") {
      if (!sender.isGM || payload.userId !== game.user.id) return;
      this.#deliverPurchaseResultLocally(payload);
      return;
    }

    if (type === "purchase-request") {
      if (!game.user.isGM || payload.targetGM !== game.user.id || !this.isResponsibleGM()) return;
      await this.#handlePurchase(payload);
      return;
    }

    if (type === "cart-purchase-request") {
      if (!game.user.isGM || payload.targetGM !== game.user.id || !this.isResponsibleGM()) return;
      await this.#handleCartPurchase(payload);
      return;
    }

    if (type === "tavern-link-request" && (!game.user.isGM || payload.targetGM !== game.user.id || !this.isResponsibleGM())) return;
    if (type === "tavern-link-result" && !sender.isGM) return;

    const route = this.#routes.get(type);
    if (route) await route(payload, sender);
  }

  static async #handlePurchase(payload) {
    return this.#handlePurchaseLines(payload, [{
      category: payload.category,
      entryId: payload.entryId,
      quantity: payload.quantity,
      days: payload.days
    }], { cart: false });
  }

  static async #handleCartPurchase(payload) {
    return this.#handlePurchaseLines(payload, payload.items, { cart: true });
  }

  static async #handlePurchaseLines(payload, items, { cart }) {
    const requestId = String(payload?.requestId ?? "").trim() || foundry.utils.randomID(20);
    const requestKey = this.#requestKey(payload?.sender, requestId);
    const inFlight = this.#inFlightRequests.get(requestKey);
    if (inFlight) {
      const result = await inFlight;
      await this.#safeEmitPurchaseResult(result);
      return result;
    }

    const task = this.#processPurchaseLines(payload, items, { cart, requestId });
    this.#inFlightRequests.set(requestKey, task);
    try {
      return await task;
    } finally {
      if (this.#inFlightRequests.get(requestKey) === task) this.#inFlightRequests.delete(requestKey);
    }
  }

  static async #processPurchaseLines(payload, items, { cart, requestId }) {
    try {
      const purchase = await TavernPurchaseService.execute({
        userId: payload.sender,
        actorId: payload.actorId,
        tavernId: payload.tavernId,
        sceneId: payload.sceneId,
        requestId,
        expectedTotal: payload.expectedTotal ?? null,
        items
      });

      if (!purchase.replayed) await this.#createPurchaseChat(purchase, { cart }).catch((error) => {
        console.warn(`${MODULE_ID} | Purchase committed, but chat receipt failed`, error);
      });

      const firstLine = purchase.lines[0];
      const soundLine = [...purchase.lines].sort((a, b) => Number(b.total ?? 0) - Number(a.total ?? 0))[0] ?? firstLine;
      const result = {
        type: "purchase-result",
        requestId,
        userId: payload.sender,
        ok: true,
        cart,
        category: soundLine?.category ?? "food",
        message: cart
          ? `Корзина оплачена. Списано: ${TavernGenerator.formatPrice(purchase.total)}.`
          : firstLine?.lodging
            ? `${firstLine.entryName}: ${firstLine.quantity} мест(а) на ${firstLine.days} дн. Списано: ${TavernGenerator.formatPrice(purchase.total)}.`
            : `${firstLine?.entryName ?? "Покупка"} × ${firstLine?.quantity ?? 1}. Списано: ${TavernGenerator.formatPrice(purchase.total)}.`,
        tavernData: TavernAtmosphereService.publicView(purchase.tavern)
      };

      try {
        if (purchase.tavern) this.refreshAll(purchase.tavern);
      } catch (error) {
        console.warn(`${MODULE_ID} | Purchase committed, but tavern refresh failed`, error);
      }
      await this.#safeEmitPurchaseResult(result);
      return result;
    } catch (error) {
      console.error(`${MODULE_ID} | Purchase failed`, error);
      let tavernData = null;
      try {
        tavernData = TavernAtmosphereService.publicView(TavernState.resolveTrustedTavern({
          tavernId: payload.tavernId,
          sceneId: payload.sceneId
        }));
      } catch (_resolveError) {
        tavernData = TavernAtmosphereService.publicView(TavernState.getCurrent());
      }

      const result = {
        type: "purchase-result",
        requestId,
        userId: payload.sender,
        ok: false,
        pending: error.code === "PURCHASE_PENDING",
        cart,
        message: error.message ?? String(error),
        tavernData
      };
      await this.#safeEmitPurchaseResult(result);
      return result;
    }
  }

  static async #createPurchaseChat(purchase, { cart }) {
    const actorName = this.#escapeHtml(purchase.actor.name);
    const cleanlinessMessage = purchase.cleanlinessMessages.length
      ? `<p>${purchase.cleanlinessMessages.map((message) => this.#escapeHtml(message)).join("<br>")}</p>`
      : "";

    if (!cart && purchase.lines.length === 1) {
      const line = purchase.lines[0];
      const entryName = this.#escapeHtml(line.entryName);
      const countText = line.lodging ? `${line.quantity} × ${line.days} дн.` : `× ${line.quantity}`;
      const bookingMessage = line.booking ? `<p>Ночлег забронирован на <strong>${line.days}</strong> дн., мест: <strong>${line.quantity}</strong>.</p>` : "";
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: purchase.actor }),
        content: `<p><strong>${actorName}</strong> покупает: ${entryName} ${countText}. Списано: <strong class="tg-chat-price">${TavernGenerator.formatPriceHtml(purchase.total)}</strong>.</p>${bookingMessage}${cleanlinessMessage}`
      });
      return;
    }

    const list = purchase.lines.map((line) => {
      const entryName = this.#escapeHtml(line.entryName);
      const countText = line.lodging ? `${line.quantity} × ${line.days} дн.` : `× ${line.quantity}`;
      return `<li>${entryName} ${countText} — <strong class="tg-chat-price">${TavernGenerator.formatPriceHtml(line.total)}</strong></li>`;
    }).join("");
    const bookingMessage = purchase.lines.some((line) => line.booking) ? "<p>Ночлег добавлен в брони таверны.</p>" : "";

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: purchase.actor }),
      content: `<p><strong>${actorName}</strong> оплачивает корзину таверны:</p><ul>${list}</ul><p>Всего списано: <strong class="tg-chat-price">${TavernGenerator.formatPriceHtml(purchase.total)}</strong>.</p>${bookingMessage}${cleanlinessMessage}`
    });
  }

  static async #emitPurchaseResult(payload) {
    if (payload.userId === game.user.id) {
      this.#deliverPurchaseResultLocally(payload);
      return;
    }
    await this.emitToUser(payload, payload.userId);
  }

  static async #safeEmitPurchaseResult(payload) {
    try {
      await this.#emitPurchaseResult(payload);
      return true;
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not deliver purchase result`, error);
      return false;
    }
  }

  static #deliverPurchaseResultLocally(payload) {
    const accepted = TavernPlayerApp.receivePurchaseResult(payload);
    if (accepted === false) return;
    if (payload.tavernData) TavernPlayerApp.receiveTavernUpdate(payload.tavernData);

    if (payload.ok) {
      void PurchaseSoundService.playForCategory(payload.category).catch((error) => {
        console.debug(`${MODULE_ID} | Purchase sound failed`, error);
      });
      ui.notifications.info(payload.message);
    } else {
      ui.notifications.warn(payload.message);
    }
    TavernPlayerApp.renderOpenInstances();
  }

  static #requestKey(userId, requestId) {
    return `${String(userId ?? "unknown")}:${String(requestId ?? "")}`;
  }

  static async #safeEmit(payload) {
    try {
      await this.emit(payload);
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not emit module socket message`, error);
    }
  }

  static #escapeHtml(value) {
    const text = String(value ?? "");
    if (typeof foundry.utils.escapeHTML === "function") return foundry.utils.escapeHTML(text);
    return text.replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[char]));
  }
}
