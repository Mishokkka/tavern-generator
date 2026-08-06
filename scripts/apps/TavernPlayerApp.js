import { TEMPLATES } from "../constants.js";
import { TavernGenerator } from "../services/TavernGenerator.js";
import { TavernState } from "../services/TavernState.js";
import { CurrencyAdapter } from "../services/CurrencyAdapter.js";
import { TavernSocket } from "../services/TavernSocket.js";
import { TavernCartApp } from "./TavernCartApp.js";
import { TavernQuantityDialog } from "./TavernQuantityDialog.js";
import { TavernAtmosphereService } from "../services/TavernAtmosphereService.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

let singleton = null;

const CATEGORY_LABELS = {
  food: "Еда",
  drinks: "Напитки",
  lodging: "Ночлег",
  rooms: "Ночлег",
  services: "Услуги"
};

const CHECKOUT_TIMEOUT_MS = 20_000;

export class TavernPlayerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "fbl-tavern-player",
    classes: ["fbl-tavern", "fbl-tavern-player"],
    tag: "form",
    window: {
      title: "Таверна",
      icon: "fa-solid fa-beer-mug-empty",
      resizable: true
    },
    position: {
      width: 920,
      height: 760
    }
  };

  static PARTS = {
    main: { template: TEMPLATES.player }
  };

  constructor(options = {}) {
    super(options);
    this.selectedActorId = null;
    this.tavernOverride = options.tavern ? foundry.utils.deepClone(options.tavern) : null;
    this.cart = [];
    this.renderedTavern = null;
    this.checkoutPending = false;
    this.activeRequestId = null;
    this.checkoutTimer = null;
    this.checkoutSnapshots = new Map();
    this.searchQuery = "";
    this.searchExpanded = false;
  }

  static openSingleton(options = {}) {
    if (!singleton) singleton = new this(options);
    if (Object.prototype.hasOwnProperty.call(options, "tavern")) singleton.setTavern(options.tavern);
    singleton.render(true);
    return singleton;
  }

  static renderOpenInstances() {
    if (singleton?.rendered) singleton.render();
    TavernCartApp.refreshOpen();
  }

  static receiveTavernUpdate(tavern) {
    if (!singleton) return;
    if (!tavern?.id) {
      singleton.setTavern(null);
      singleton.#resetCheckout();
      singleton.checkoutSnapshots.clear();
      singleton.clearCart({ render: false, notify: false });
      if (singleton.rendered) singleton.render();
      TavernCartApp.refreshOpen();
      return;
    }

    const active = TavernState.getCurrent();
    const overrideMatches = singleton.tavernOverride?.id === tavern.id;
    const activeMatches = !singleton.tavernOverride && active?.id === tavern.id;

    if (!overrideMatches && !activeMatches) return;

    singleton.setTavern(tavern);
    if (singleton.rendered) singleton.render();
    TavernCartApp.refreshOpen();
  }

  static receivePurchaseResult(payload) {
    if (!payload) return false;
    if (!singleton) return true;

    const requestId = String(payload.requestId ?? "").trim();
    const snapshot = requestId ? singleton.checkoutSnapshots.get(requestId) ?? null : null;
    const isActive = Boolean(requestId && singleton.activeRequestId === requestId);
    if (singleton.activeRequestId && requestId && !isActive && !snapshot) return false;

    if (isActive || !singleton.activeRequestId) singleton.#resetCheckout();
    if (payload.ok && payload.cart && snapshot) singleton.#removePurchasedSnapshot(snapshot);
    if (requestId) singleton.checkoutSnapshots.delete(requestId);
    if (singleton.rendered) singleton.render();
    TavernCartApp.refreshOpen();
    return true;
  }

  setTavern(tavern) {
    this.tavernOverride = tavern ? foundry.utils.deepClone(tavern) : null;
  }

  async _onClose(options) {
    this.#resetCheckout();
    return super._onClose?.(options);
  }

  async _prepareContext(options) {
    const sourceTavern = this.tavernOverride ?? TavernState.getCurrent();
    const tavern = TavernGenerator.decoratePrices(TavernAtmosphereService.publicView(sourceTavern));
    this.renderedTavern = tavern ?? null;

    const actors = this.#ownedActors();
    const selectedActor = this.#selectedActor(actors);
    const wallet = selectedActor ? CurrencyAdapter.getWallet(selectedActor) : null;

    return {
      tavern,
      payer: selectedActor ? { id: selectedActor.id, name: selectedActor.name } : null,
      actors: actors.map((actor) => ({ id: actor.id, name: actor.name, selected: actor.id === selectedActor?.id })),
      showActorPicker: actors.length > 1,
      selectedActorId: selectedActor?.id ?? "",
      searchQuery: this.searchQuery,
      searchExpanded: this.searchExpanded,
      wallet: this.#walletContext(wallet, selectedActor),
      cart: { ...this.#cartSummary(), checkoutPending: this.checkoutPending },
      isGM: game.user.isGM
    };
  }

  async _onRender(context, options) {
    this.element.querySelector("[data-action='open-gm-life']")?.addEventListener("click", (event) => {
      event.preventDefault();
      if (!game.user.isGM) return;
      const tavern = this.#resolveGmTavern();
      if (!tavern) return ui.notifications.warn("Не удалось восстановить полные данные таверны для ГМа.");
      game.fblTaverns?.openGM?.({
        tavern,
        tavernId: tavern.id,
        sceneId: tavern.scene?.id ?? globalThis.canvas?.scene?.id ?? null,
        tab: "life"
      });
    });

    this.element.querySelector("[data-action='toggle-search']")?.addEventListener("click", (event) => {
      event.preventDefault();
      this.searchExpanded = !this.searchExpanded;
      const shell = this.element.querySelector(".tg-header-search");
      shell?.classList.toggle("is-open", this.searchExpanded);
      event.currentTarget.setAttribute("aria-expanded", this.searchExpanded ? "true" : "false");
      event.currentTarget.setAttribute("aria-label", this.searchExpanded ? "Скрыть поиск по меню" : "Раскрыть поиск по меню");
      if (this.searchExpanded) this.element.querySelector("[data-action='menu-search']")?.focus();
    });

    this.element.querySelector("[data-action='clear-search']")?.addEventListener("click", (event) => {
      event.preventDefault();
      this.searchQuery = "";
      const input = this.element.querySelector("[data-action='menu-search']");
      if (input) input.value = "";
      this.element.querySelector(".tg-header-search")?.classList.remove("has-query");
      this.#applySearchFilter();
      input?.focus();
    });

    this.element.querySelector("[data-action='open-cart']")?.addEventListener("click", (event) => {
      event.preventDefault();
      TavernCartApp.openFor(this);
    });

    this.element.querySelector("[data-action='select-actor']")?.addEventListener("change", (event) => {
      this.selectedActorId = event.currentTarget.value || null;
      this.render();
      TavernCartApp.refreshOpen();
    });

    const search = this.element.querySelector("[data-action='menu-search']");
    search?.addEventListener("input", (event) => {
      this.searchQuery = String(event.currentTarget.value ?? "");
      this.element.querySelector(".tg-header-search")?.classList.toggle("has-query", Boolean(this.searchQuery.trim()));
      this.#applySearchFilter();
    });

    for (const button of this.element.querySelectorAll("[data-action='add-cart']")) {
      button.addEventListener("click", (event) => this.#onAddToCart(event));
    }

    this.#applySearchFilter();
  }

  async #onAddToCart(event) {
    event.preventDefault();
    if (this.checkoutPending) return ui.notifications.warn("Дождись завершения текущей оплаты.");
    const button = event.currentTarget;
    const category = button.dataset.category;
    const entryId = button.dataset.entryId;
    const entry = this.#findRenderedEntry(category, entryId);
    if (!entry) return ui.notifications.warn("Позиция таверны не найдена.");

    const lodging = this.#isLodging(category);
    const stock = this.#stockStatus(entry, category);
    if (stock.remaining <= 0) {
      return ui.notifications.warn(`${entry.name}: доступное количество уже набрано в корзину или закончилось.`);
    }

    const result = await TavernQuantityDialog.prompt({
      entry,
      category,
      unitPrice: entry.price,
      maxQuantity: stock.remaining,
      maxDays: lodging ? 365 : 1,
      quantity: 1,
      days: 1,
      remainingLabel: stock.label
    });

    if (!result) return;
    this.#addCartItem({ category, entry, quantity: result.quantity, days: lodging ? result.days : 1 });
  }

  #addCartItem({ category, entry, quantity = 1, days = 1 }) {
    if (this.checkoutPending) return;
    const lodging = this.#isLodging(category);
    const safeQuantity = Math.max(1, Math.trunc(Number(quantity) || 1));
    const safeDays = Math.max(1, Math.trunc(Number(days) || 1));
    const key = this.#cartKey(category, entry.id, lodging ? safeDays : 1);
    const max = Math.max(1, Number(entry.maxPurchaseQuantity ?? 99));
    const existing = this.cart.find((item) => item.key === key);

    if (existing) {
      existing.quantity = Math.min(max, existing.quantity + safeQuantity);
      existing.unitPrice = entry.price;
      existing.name = entry.name;
      existing.maxQuantity = max;
    } else {
      this.cart.push({
        key,
        category,
        entryId: entry.id,
        name: entry.name,
        unitPrice: Math.max(1, Number(entry.price ?? 1)),
        quantity: Math.min(max, safeQuantity),
        days: lodging ? safeDays : 1,
        maxQuantity: max,
        lodging
      });
    }

    ui.notifications.info(`${entry.name}: добавлено в корзину.`);
    this.render();
    TavernCartApp.refreshOpen();
  }

  cartContext() {
    const selectedActor = this.#selectedActor(this.#ownedActors());
    const items = this.cart.map((item) => this.#cartItemContext(item));
    const total = items.reduce((sum, item) => sum + item.total, 0);

    return {
      items,
      hasItems: items.length > 0,
      total,
      totalLabel: TavernGenerator.formatPriceHtml(total),
      actorName: selectedActor?.name ?? "персонаж не выбран",
      checkoutPending: this.checkoutPending
    };
  }

  removeCartItem(key) {
    if (this.checkoutPending) return;
    this.cart = this.cart.filter((item) => item.key !== key);
    this.render();
    TavernCartApp.refreshOpen();
  }

  adjustCartItem(key, delta) {
    if (this.checkoutPending) return;
    const item = this.cart.find((entry) => entry.key === key);
    if (!item) return;

    const otherQuantity = this.cart
      .filter((entry) => entry !== item && entry.category === item.category && entry.entryId === item.entryId)
      .reduce((sum, entry) => sum + Math.max(1, Math.trunc(Number(entry.quantity) || 1)), 0);
    const aggregateMax = Math.max(0, Math.trunc(Number(item.maxQuantity ?? 99) || 0));
    const lineMax = Math.max(0, aggregateMax - otherQuantity);
    const next = Math.max(0, Math.min(lineMax, item.quantity + Math.trunc(Number(delta) || 0)));
    if (next <= 0) this.cart = this.cart.filter((entry) => entry !== item);
    else item.quantity = next;
    this.render();
    TavernCartApp.refreshOpen();
  }

  clearCart({ render = true, notify = true } = {}) {
    if (this.checkoutPending) return;
    this.cart = [];
    if (notify) ui.notifications.info("Корзина очищена.");
    if (render) {
      this.render();
      TavernCartApp.refreshOpen();
    }
  }

  async checkoutCart() {
    if (this.checkoutPending) return;
    if (!this.cart.length) return ui.notifications.warn("Корзина пуста.");

    const actor = this.#selectedActor(this.#ownedActors());
    const actorId = actor?.id ?? null;
    if (!actorId) return ui.notifications.warn("У пользователя нет привязанного персонажа для оплаты.");

    const tavern = this.tavernOverride ?? TavernState.getCurrent();
    const requestId = foundry.utils.randomID(20);
    const snapshot = this.cart.map((item) => foundry.utils.deepClone(item));
    this.checkoutSnapshots.set(requestId, snapshot);
    this.checkoutPending = true;
    this.activeRequestId = requestId;
    this.render();
    TavernCartApp.refreshOpen();

    try {
      const sent = await TavernSocket.requestCartPurchase({
        requestId,
        actorId,
        items: this.cart.map((item) => ({
          category: item.category,
          entryId: item.entryId,
          quantity: item.quantity,
          days: item.days
        })),
        tavernId: tavern?.id ?? null,
        sceneId: tavern?.scene?.id ?? globalThis.canvas?.scene?.id ?? null
      });
      if (!sent) {
        this.checkoutSnapshots.delete(requestId);
        this.#resetCheckout();
        this.render();
        TavernCartApp.refreshOpen();
      } else {
        this.#startCheckoutTimeout(requestId);
      }
    } catch (error) {
      this.checkoutSnapshots.delete(requestId);
      this.#resetCheckout();
      this.render();
      TavernCartApp.refreshOpen();
      throw error;
    }
  }


  #resolveGmTavern() {
    if (!game.user.isGM) return null;
    const candidate = this.tavernOverride ?? TavernState.getCurrent();
    const id = String(candidate?.id ?? "").trim();
    if (!id) return candidate ? foundry.utils.deepClone(candidate) : null;

    const current = TavernState.getCurrent();
    if (current?.id === id) return foundry.utils.deepClone(current);
    const saved = TavernState.getSavedById(id);
    if (saved) return foundry.utils.deepClone(saved);
    return candidate ? foundry.utils.deepClone(candidate) : null;
  }


  #stockStatus(entry, category) {
    if (entry?.unlimited) {
      const max = Math.max(0, Math.trunc(Number(entry?.maxPurchaseQuantity ?? 99) || 0));
      const inCart = this.#cartQuantityForEntry(category, entry.id);
      const remaining = Math.max(0, max - inCart);
      const unlimited = max >= 99;
      const label = unlimited
        ? "без ограничения"
        : inCart > 0 ? `${remaining} из ${max} (в корзине: ${inCart})` : `${remaining} из ${max}`;
      return { max, inCart, remaining, label };
    }

    const max = Math.max(0, Math.trunc(Number(entry?.maxPurchaseQuantity ?? entry?.stock ?? 0) || 0));
    const inCart = this.#cartQuantityForEntry(category, entry.id);
    const remaining = Math.max(0, max - inCart);
    const label = inCart > 0 ? `${remaining} из ${max} (в корзине: ${inCart})` : `${remaining} из ${max}`;
    return { max, inCart, remaining, label };
  }

  #cartQuantityForEntry(category, entryId) {
    return this.cart
      .filter((item) => item.category === category && item.entryId === entryId)
      .reduce((sum, item) => sum + Math.max(1, Math.trunc(Number(item.quantity) || 1)), 0);
  }

  #cartSummary() {
    const count = this.cart.reduce((sum, item) => sum + Math.max(1, Number(item.quantity ?? 1)), 0);
    const total = this.cart.reduce((sum, item) => sum + this.#cartItemTotal(item), 0);
    return {
      count,
      total,
      totalLabel: TavernGenerator.formatPriceHtml(total)
    };
  }

  #cartItemContext(item) {
    const total = this.#cartItemTotal(item);
    return {
      ...item,
      categoryLabel: CATEGORY_LABELS[item.category] ?? "Позиция",
      countLabel: item.lodging ? `${item.quantity} мест × ${item.days} дн.` : `× ${item.quantity}`,
      total,
      totalLabel: TavernGenerator.formatPriceHtml(total)
    };
  }

  #cartItemTotal(item) {
    return Math.max(1, Number(item.unitPrice ?? 1)) * Math.max(1, Number(item.quantity ?? 1)) * (item.lodging ? Math.max(1, Number(item.days ?? 1)) : 1);
  }

  #cartKey(category, entryId, days = 1) {
    return this.#isLodging(category) ? `${category}:${entryId}:${Math.max(1, Math.trunc(Number(days) || 1))}` : `${category}:${entryId}`;
  }


  #findRenderedEntry(category, entryId) {
    const tavern = this.renderedTavern ?? TavernGenerator.decoratePrices(this.tavernOverride ?? TavernState.getCurrent());
    const keys = this.#categoryKeys(category);
    for (const key of keys) {
      const list = tavern?.inventory?.[key] ?? tavern?.[key];
      if (!Array.isArray(list)) continue;
      const entry = list.find((item) => item.id === entryId);
      if (entry) return entry;
    }
    return null;
  }

  #categoryKeys(category) {
    switch (category) {
      case "food": return ["food"];
      case "drinks": return ["drinks"];
      case "lodging":
      case "rooms": return ["lodging", "rooms"];
      case "services": return ["services"];
      default: return [category];
    }
  }

  #isLodging(category) {
    return category === "lodging" || category === "rooms";
  }

  #applySearchFilter() {
    const query = this.searchQuery.trim().toLocaleLowerCase("ru-RU");
    for (const row of this.element?.querySelectorAll?.(".tg-shop-row") ?? []) {
      const haystack = `${row.textContent} ${row.dataset.searchText ?? ""}`.toLocaleLowerCase("ru-RU");
      row.hidden = Boolean(query && !haystack.includes(query));
    }

    for (const panel of this.element?.querySelectorAll?.(".tg-panel") ?? []) {
      const rows = [...panel.querySelectorAll(".tg-shop-row")];
      panel.classList.toggle("is-search-empty", Boolean(query && rows.length && rows.every((row) => row.hidden)));
    }
  }

  #walletContext(wallet, actor = null) {
    if (!wallet) {
      return {
        hasActor: false,
        sourceLabel: "нет",
        isFallback: true,
        coins: { gold: 0, silver: 0, copper: 0 },
        parts: TavernGenerator.formatCoinParts({ gold: 0, silver: 0, copper: 0 })
      };
    }

    return {
      hasActor: true,
      sourceLabel: actor?.name ? actor.name : (wallet.source === "actor" ? "лист персонажа" : "резервный кошелек модуля"),
      isFallback: wallet.source !== "actor",
      coins: wallet.coins,
      parts: TavernGenerator.formatCoinParts(wallet.coins)
    };
  }

  #ownedActors() {
    return game.actors.filter((actor) => actor.type === "character" && actor.isOwner).sort((a, b) => a.name.localeCompare(b.name));
  }

  #selectedActor(actors) {
    if (this.selectedActorId) return actors.find((actor) => actor.id === this.selectedActorId) ?? null;

    const userActor = game.user?.character;
    if (userActor && actors.some((actor) => actor.id === userActor.id)) return userActor;

    const controlledActor = globalThis.canvas?.tokens?.controlled?.[0]?.actor;
    if (controlledActor && actors.some((actor) => actor.id === controlledActor.id)) return controlledActor;

    return actors[0] ?? null;
  }

  #removePurchasedSnapshot(snapshot) {
    for (const purchased of snapshot ?? []) {
      const current = this.cart.find((item) => item.key === purchased.key);
      if (!current) continue;
      current.quantity = Math.max(0, Number(current.quantity ?? 0) - Math.max(1, Number(purchased.quantity ?? 1)));
      if (current.quantity <= 0) this.cart = this.cart.filter((item) => item !== current);
    }
  }

  #startCheckoutTimeout(requestId) {
    if (this.checkoutTimer) window.clearTimeout(this.checkoutTimer);
    this.checkoutTimer = window.setTimeout(() => {
      if (!this.checkoutPending || this.activeRequestId !== requestId) return;
      this.#resetCheckout();
      ui.notifications.warn("ГМ не ответил на запрос оплаты. Корзина снова доступна, попробуй ещё раз.");
      this.render();
      TavernCartApp.refreshOpen();
    }, CHECKOUT_TIMEOUT_MS);
  }

  #resetCheckout() {
    if (this.checkoutTimer) window.clearTimeout(this.checkoutTimer);
    this.checkoutTimer = null;
    this.checkoutPending = false;
    this.activeRequestId = null;
  }
}
