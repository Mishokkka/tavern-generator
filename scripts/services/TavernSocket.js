import { MODULE_ID, SOCKET_NAME } from "../constants.js";
import { TavernState } from "./TavernState.js";
import { TavernGenerator } from "./TavernGenerator.js";
import { TavernPlayerApp } from "../apps/TavernPlayerApp.js";
import { PurchaseSoundService } from "./PurchaseSoundService.js";
import { TavernPurchaseService } from "./TavernPurchaseService.js";
import { TavernAtmosphereService } from "./TavernAtmosphereService.js";

const RESULT_CACHE_TTL = 5 * 60 * 1000;

export class TavernSocket {
  static #registered = false;
  static #routes = new Map();
  static #processedRequests = new Map();
  static #inFlightRequests = new Map();

  static register() {
    if (this.#registered) return;
    this.#registered = true;
    game.socket.on(SOCKET_NAME, (payload) => this.#onMessage(payload));
  }

  static on(type, handler) {
    const key = String(type ?? "").trim();
    if (!key || typeof handler !== "function") throw new Error("Некорректный socket route.");
    this.#routes.set(key, handler);
  }

  static emit(payload) {
    game.socket.emit(SOCKET_NAME, payload);
  }

  static openForPlayers() {
    this.emit({ type: "open-player", sender: game.user.id, tavernData: TavernAtmosphereService.publicView(TavernState.getCurrent()) });
  }

  static refreshAll(tavernData = null) {
    const publicData = tavernData ? TavernAtmosphereService.publicView(tavernData) : null;
    if (game.user?.isGM && tavernData && publicData) {
      void this.#syncLinkedSceneSnapshot(tavernData, publicData).catch((error) => {
        console.warn(`${MODULE_ID} | Could not synchronize linked scene tavern snapshot`, error);
      });
    }
    this.refreshLocal(publicData);
    this.emit({ type: "refresh", sender: game.user.id, tavernData: publicData });
  }

  static refreshLocal(tavernData = null) {
    if (tavernData) TavernPlayerApp.receiveTavernUpdate(tavernData);
    TavernPlayerApp.renderOpenInstances();
    Hooks.callAll(`${MODULE_ID}.refresh`, { sender: game.user.id, tavernData });
  }

  static async #syncLinkedSceneSnapshot(tavern, publicData) {
    const sceneId = tavern?.scene?.id ?? null;
    const scene = sceneId ? game.scenes?.get?.(sceneId) : null;
    if (!scene?.setFlag) return false;

    await scene.setFlag(MODULE_ID, "tavernData", publicData);
    const link = scene.getFlag?.(MODULE_ID, "shopButton") ?? scene.flags?.[MODULE_ID]?.shopButton;
    if (link) {
      const nextLink = foundry.utils.deepClone(link);
      nextLink.tavernId = tavern.id;
      nextLink.tavernName = tavern.name;
      nextLink.tavernData = publicData;
      nextLink.updatedAt = Date.now();
      await scene.setFlag(MODULE_ID, "shopButton", nextLink);
    }
    return true;
  }

  static async requestPurchase({ actorId, category, entryId, quantity = 1, days = 1, tavernId = null, sceneId = null, requestId = foundry.utils.randomID(20) }) {
    const payload = {
      type: "purchase-request",
      requestId,
      sender: game.user.id,
      actorId,
      category,
      entryId,
      quantity,
      days,
      tavernId,
      sceneId
    };

    if (this.isResponsibleGM()) await this.#handlePurchase(payload);
    else if (!this.#hasActiveGM()) {
      ui.notifications.warn("Нет активного ГМа, который может обработать покупку.");
      return null;
    } else this.emit(payload);
    return requestId;
  }

  static async requestCartPurchase({ actorId, items = [], tavernId = null, sceneId = null, requestId = foundry.utils.randomID(20) }) {
    const payload = {
      type: "cart-purchase-request",
      requestId,
      sender: game.user.id,
      actorId,
      items,
      tavernId,
      sceneId
    };

    if (this.isResponsibleGM()) await this.#handleCartPurchase(payload);
    else if (!this.#hasActiveGM()) {
      ui.notifications.warn("Нет активного ГМа, который может обработать оплату корзины.");
      return null;
    } else this.emit(payload);
    return requestId;
  }

  static isResponsibleGM() {
    if (!game.user.isGM) return false;
    const activeGMs = game.users.filter((user) => user.active && user.isGM).sort((a, b) => a.id.localeCompare(b.id));
    return activeGMs[0]?.id === game.user.id;
  }

  static #hasActiveGM() {
    return game.users.some((user) => user.active && user.isGM);
  }

  static async #onMessage(payload) {
    const type = String(payload?.type ?? "").trim();
    if (!type) return;

    if (type === "open-player") {
      if (!game.user.isGM) TavernPlayerApp.openSingleton(payload.tavernData ? { tavern: payload.tavernData } : {});
      return;
    }

    if (type === "refresh") {
      if (payload.sender !== game.user.id) this.refreshLocal(payload.tavernData ?? null);
      return;
    }

    if (type === "purchase-result") {
      if (payload.userId !== game.user.id) return;
      if (payload.tavernData) TavernPlayerApp.receiveTavernUpdate(payload.tavernData);
      TavernPlayerApp.receivePurchaseResult(payload);

      if (payload.ok) {
        PurchaseSoundService.playForCategory(payload.category).catch((error) => console.debug(`${MODULE_ID} | Purchase sound failed`, error));
        ui.notifications.info(payload.message);
      } else {
        ui.notifications.warn(payload.message);
      }
      TavernPlayerApp.renderOpenInstances();
      return;
    }

    if (type === "purchase-request") {
      if (this.isResponsibleGM()) await this.#handlePurchase(payload);
      return;
    }

    if (type === "cart-purchase-request") {
      if (this.isResponsibleGM()) await this.#handleCartPurchase(payload);
      return;
    }

    const route = this.#routes.get(type);
    if (route) await route(payload);
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
    const cacheKey = this.#requestKey(payload?.sender, requestId);
    const cached = this.#getCachedResult(cacheKey);
    if (cached) {
      this.#emitPurchaseResult(cached);
      return cached;
    }

    const inFlight = this.#inFlightRequests.get(cacheKey);
    if (inFlight) {
      const result = await inFlight;
      this.#emitPurchaseResult(result);
      return result;
    }

    const task = this.#processPurchaseLines(payload, items, { cart, requestId, cacheKey });
    this.#inFlightRequests.set(cacheKey, task);
    try {
      return await task;
    } finally {
      if (this.#inFlightRequests.get(cacheKey) === task) this.#inFlightRequests.delete(cacheKey);
    }
  }

  static async #processPurchaseLines(payload, items, { cart, requestId, cacheKey }) {
    try {
      const purchase = await TavernPurchaseService.execute({
        userId: payload.sender,
        actorId: payload.actorId,
        tavernId: payload.tavernId,
        sceneId: payload.sceneId,
        items
      });

      await this.#createPurchaseChat(purchase, { cart }).catch((error) => {
        console.warn(`${MODULE_ID} | Purchase committed, but chat receipt failed`, error);
      });

      const firstLine = purchase.lines[0];
      const result = {
        type: "purchase-result",
        requestId,
        userId: payload.sender,
        ok: true,
        cart,
        category: firstLine?.category ?? "food",
        message: cart
          ? `Корзина оплачена. Списано: ${TavernGenerator.formatPrice(purchase.total)}.`
          : firstLine?.lodging
            ? `${firstLine.entryName}: ${firstLine.quantity} мест(а) на ${firstLine.days} дн. Списано: ${TavernGenerator.formatPrice(purchase.total)}.`
            : `${firstLine?.entryName ?? "Покупка"} × ${firstLine?.quantity ?? 1}. Списано: ${TavernGenerator.formatPrice(purchase.total)}.`,
        tavernData: TavernAtmosphereService.publicView(purchase.tavern)
      };

      this.#rememberResult(cacheKey, result);
      this.#emitPurchaseResult(result);
      this.refreshAll(purchase.tavern);
      return result;
    } catch (error) {
      console.error(`${MODULE_ID} | Purchase failed`, error);
      const result = {
        type: "purchase-result",
        requestId,
        userId: payload.sender,
        ok: false,
        cart,
        message: error.message ?? String(error)
      };
      this.#rememberResult(cacheKey, result);
      this.#emitPurchaseResult(result);
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

  static #emitPurchaseResult(payload) {
    if (payload.userId === game.user.id) {
      this.#onMessage(payload);
      return;
    }
    this.emit(payload);
  }

  static #rememberResult(cacheKey, result) {
    const now = Date.now();
    this.#processedRequests.set(cacheKey, { at: now, result: foundry.utils.deepClone(result) });
    for (const [key, record] of this.#processedRequests) {
      if (now - record.at > RESULT_CACHE_TTL) this.#processedRequests.delete(key);
    }
  }

  static #getCachedResult(cacheKey) {
    const record = this.#processedRequests.get(cacheKey);
    if (!record) return null;
    if (Date.now() - record.at > RESULT_CACHE_TTL) {
      this.#processedRequests.delete(cacheKey);
      return null;
    }
    return foundry.utils.deepClone(record.result);
  }


  static #requestKey(userId, requestId) {
    return `${String(userId ?? "unknown")}:${String(requestId ?? "")}`;
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
