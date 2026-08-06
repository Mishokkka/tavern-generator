import { TEMPLATES } from "../constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

let activeCartApp = null;

export class TavernCartApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "fbl-tavern-cart",
    classes: ["fbl-tavern", "fbl-tavern-cart"],
    tag: "section",
    window: {
      title: "Корзина таверны",
      icon: "fa-solid fa-basket-shopping",
      resizable: true
    },
    position: {
      width: 520,
      height: 520
    }
  };

  static PARTS = {
    main: { template: TEMPLATES.cart }
  };

  static openFor(owner) {
    if (!activeCartApp) activeCartApp = new this(owner);
    activeCartApp.owner = owner;
    activeCartApp.render(true);
    return activeCartApp;
  }

  static refreshOpen() {
    if (activeCartApp?.rendered) activeCartApp.render();
  }

  constructor(owner, options = {}) {
    super(options);
    this.owner = owner;
  }

  async _prepareContext(_options) {
    return this.owner?.cartContext?.() ?? { items: [], hasItems: false, totalLabel: "0 ММ" };
  }

  async _onRender(_context, _options) {
    for (const button of this.element.querySelectorAll("[data-action='remove-cart-item']")) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        this.owner?.removeCartItem?.(event.currentTarget.dataset.key);
      });
    }

    for (const button of this.element.querySelectorAll("[data-action='adjust-cart-item']")) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        this.owner?.adjustCartItem?.(event.currentTarget.dataset.key, Number(event.currentTarget.dataset.delta));
      });
    }

    this.element.querySelector("[data-action='clear-cart']")?.addEventListener("click", (event) => {
      event.preventDefault();
      this.owner?.clearCart?.();
    });

    this.element.querySelector("[data-action='checkout-cart']")?.addEventListener("click", async (event) => {
      event.preventDefault();
      if (this.owner?.checkoutPending) return;
      event.currentTarget.disabled = true;
      await this.owner?.checkoutCart?.();
      if (!this.owner?.checkoutPending && event.currentTarget.isConnected) event.currentTarget.disabled = false;
    });
  }
}
