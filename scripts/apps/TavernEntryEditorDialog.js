import { TEMPLATES } from "../constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const CATEGORY_LABELS = {
  food: "Блюдо",
  drinks: "Напиток",
  lodging: "Ночлег",
  rooms: "Ночлег",
  services: "Услуга"
};

export class TavernEntryEditorDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "fbl-tavern-entry-editor",
    classes: ["fbl-tavern", "fbl-tavern-entry-editor"],
    tag: "form",
    window: {
      title: "Позиция таверны",
      icon: "fa-solid fa-pen-to-square",
      resizable: true
    },
    position: { width: 520, height: 590 }
  };

  static PARTS = { main: { template: TEMPLATES.entryEditor } };

  static prompt(options = {}) {
    return new Promise((resolve) => new this(options, resolve).render(true));
  }

  constructor(options = {}, resolve = null) {
    super(options);
    this.category = String(options.category ?? "food");
    this.entry = foundry.utils.deepClone(options.entry ?? {});
    this.resolve = resolve;
    this.resolved = false;
  }

  async _prepareContext() {
    const lodging = this.category === "lodging" || this.category === "rooms";
    const unlimited = Boolean(this.entry.unlimited);
    return {
      category: this.category,
      categoryLabel: CATEGORY_LABELS[this.category] ?? "Позиция",
      editing: Boolean(this.entry.id),
      lodging,
      entry: {
        name: this.entry.name ?? "",
        desc: this.entry.desc ?? "",
        basePrice: Math.max(1, Math.trunc(Number(this.entry.basePrice ?? this.entry.price ?? 1) || 1)),
        stock: unlimited ? 0 : Math.max(0, Math.trunc(Number(this.entry.stock ?? 1) || 0)),
        maxStock: unlimited ? 0 : Math.max(0, Math.trunc(Number(this.entry.maxStock ?? this.entry.stock ?? 1) || 0)),
        total: unlimited ? 0 : Math.max(0, Math.trunc(Number(this.entry.total ?? this.entry.maxStock ?? this.entry.stock ?? 1) || 0)),
        unlimited,
        local: Boolean(this.entry.local),
        pinned: Boolean(this.entry.pinned)
      }
    };
  }

  async _onRender() {
    this.element.addEventListener("submit", (event) => this.#onSubmit(event));
    this.element.querySelector("[data-action='cancel']")?.addEventListener("click", (event) => {
      event.preventDefault();
      this.#finish(null);
    });

    const unlimited = this.element.querySelector("input[name='unlimited']");
    unlimited?.addEventListener("change", () => this.#syncUnlimited());
    this.#syncUnlimited();
  }

  async close(options = {}) {
    if (!this.resolved) this.#finish(null, { close: false });
    return super.close(options);
  }

  #onSubmit(event) {
    event.preventDefault();
    const form = new FormData(this.element);
    const name = String(form.get("name") ?? "").trim();
    if (!name) return ui.notifications.warn("У позиции должно быть название.");

    const lodging = this.category === "lodging" || this.category === "rooms";
    const unlimited = form.get("unlimited") === "on";
    const stock = Math.max(0, Math.trunc(Number(form.get("stock")) || 0));
    const total = lodging ? Math.max(stock, Math.trunc(Number(form.get("total")) || 0)) : null;

    this.#finish({
      name,
      desc: String(form.get("desc") ?? "").trim(),
      basePrice: Math.max(1, Math.trunc(Number(form.get("basePrice")) || 1)),
      stock,
      maxStock: Math.max(stock, Math.trunc(Number(form.get("maxStock")) || 0)),
      total,
      unlimited,
      local: form.get("local") === "on",
      pinned: form.get("pinned") === "on"
    });
  }

  #syncUnlimited() {
    const unlimited = Boolean(this.element.querySelector("input[name='unlimited']")?.checked);
    for (const input of this.element.querySelectorAll("[data-stock-field]")) input.disabled = unlimited;
  }

  #finish(value, { close = true } = {}) {
    if (this.resolved) return;
    this.resolved = true;
    this.resolve?.(value);
    if (close) this.close();
  }
}
