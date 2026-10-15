import { TEMPLATES } from "../constants.js";
import { TavernGenerator } from "../services/TavernGenerator.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const CATEGORY_LABELS = {
  food: "Еда",
  drinks: "Напиток",
  lodging: "Ночлег",
  rooms: "Ночлег",
  services: "Услуга"
};

export class TavernQuantityDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "fbl-tavern-quantity-dialog",
    classes: ["fbl-tavern", "fbl-tavern-quantity-dialog"],
    tag: "form",
    window: {
      title: "Добавить в корзину",
      icon: "fa-solid fa-cart-plus",
      resizable: false
    },
    position: {
      width: 390,
      height: "auto"
    }
  };

  static PARTS = {
    main: { template: TEMPLATES.quantityDialog }
  };

  static prompt(options = {}) {
    return new Promise((resolve) => {
      new this(options, resolve).render(true);
    });
  }

  constructor(options = {}, resolve = null) {
    super(options);
    this.entry = options.entry ?? {};
    this.category = String(options.category ?? "");
    this.quantity = Math.max(1, Math.trunc(Number(options.quantity ?? 1) || 1));
    this.days = Math.max(1, Math.trunc(Number(options.days ?? 1) || 1));
    this.maxQuantity = Math.max(1, Math.trunc(Number(options.maxQuantity ?? 99) || 99));
    this.remainingLabel = String(options.remainingLabel ?? `осталось: ${this.maxQuantity}`);
    this.maxDays = Math.max(1, Math.trunc(Number(options.maxDays ?? 365) || 365));
    this.unitPrice = Math.max(1, Math.trunc(Number(options.unitPrice ?? this.entry.price ?? 1) || 1));
    this.resolve = resolve;
    this.resolved = false;
  }

  async _prepareContext(_options) {
    const lodging = this.category === "lodging" || this.category === "rooms";
    const total = this.#total();

    return {
      entry: this.entry,
      category: this.category,
      categoryLabel: CATEGORY_LABELS[this.category] ?? "Позиция",
      lodging,
      resource: Boolean(this.entry.resource),
      quantity: this.quantity,
      days: this.days,
      maxQuantity: this.maxQuantity,
      maxDays: this.maxDays,
      remainingLabel: this.remainingLabel,
      unitPriceLabel: TavernGenerator.formatPriceHtml(this.unitPrice),
      totalLabel: TavernGenerator.formatPriceHtml(total)
    };
  }

  async _onRender(_context, _options) {
    this.element.addEventListener("submit", (event) => this.#onSubmit(event));

    this.element.querySelector("[data-action='cancel']")?.addEventListener("click", (event) => {
      event.preventDefault();
      this.#finish(null);
    });

    for (const input of this.element.querySelectorAll("input[type='number']")) {
      input.addEventListener("input", () => this.#updateTotal());
      input.addEventListener("change", () => this.#updateTotal());
    }

    this.#updateTotal();

    this.setPosition?.({ height: "auto" });
  }

  async close(options = {}) {
    if (!this.resolved) this.#finish(null, { close: false });
    return super.close(options);
  }

  #onSubmit(event) {
    event.preventDefault();
    this.#finish({
      quantity: this.#readQuantity(),
      days: this.#readDays(),
      delivery: this.entry.resource ? this.element.querySelector("[name='delivery']")?.value ?? "resource" : undefined
    });
  }

  #finish(value, { close = true } = {}) {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve?.(value);
    if (close) this.close();
  }

  #readQuantity() {
    const input = this.element.querySelector("input[name='quantity']");
    const value = Math.trunc(Number(input?.value) || 1);
    return Math.max(1, Math.min(this.maxQuantity, value));
  }

  #readDays() {
    const input = this.element.querySelector("input[name='days']");
    if (!input) return 1;
    const value = Math.trunc(Number(input.value) || 1);
    return Math.max(1, Math.min(this.maxDays, value));
  }

  #total() {
    const lodging = this.category === "lodging" || this.category === "rooms";
    return this.unitPrice * this.quantity * (lodging ? this.days : 1);
  }

  #updateTotal() {
    this.quantity = this.#readQuantity();
    this.days = this.#readDays();
    const target = this.element.querySelector("[data-quantity-total]");
    if (target) target.innerHTML = TavernGenerator.formatPriceHtml(this.#total());
  }
}
