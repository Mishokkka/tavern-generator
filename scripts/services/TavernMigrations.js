export const TAVERN_SCHEMA_VERSION = 4;

const INVENTORY_KEYS = ["food", "drinks", "lodging", "services"];

export class TavernMigrations {
  static migrate(tavern) {
    if (!tavern) return null;

    const clone = foundry.utils.deepClone(tavern);
    clone.schemaVersion = Number(clone.schemaVersion ?? 1);

    if (clone.schemaVersion < 2 || !clone.inventory) this.#toV2(clone);
    else clone.inventory = this.#normalizeInventory(clone.inventory, clone);

    if (clone.schemaVersion < 3) this.#toV3(clone);
    else this.#normalizeV3(clone);

    if (clone.schemaVersion < 4) this.#toV4(clone);
    else this.#normalizeV4(clone);

    clone.schemaVersion = TAVERN_SCHEMA_VERSION;
    clone.publicSummary ??= "Доступные позиции указаны ниже.";

    // The current schema stores inventory only under tavern.inventory.
    // Decorated view models may still expose top-level food/drinks/lodging/services for templates.
    delete clone.menu;
    delete clone.lodging;
    delete clone.services;
    delete clone.food;
    delete clone.drinks;

    return clone;
  }

  static migrateMany(taverns) {
    if (!Array.isArray(taverns)) return [];
    return taverns.map((tavern) => this.migrate(tavern)).filter(Boolean);
  }

  static inventory(tavern) {
    return this.migrate(tavern)?.inventory ?? this.#emptyInventory();
  }

  static categoryToInventoryKey(category) {
    if (category === "food") return "food";
    if (category === "drink" || category === "drinks") return "drinks";
    if (category === "lodging" || category === "rooms") return "lodging";
    if (category === "service" || category === "services") return "services";
    return null;
  }

  static categorySearchKeys(category) {
    const key = this.categoryToInventoryKey(category);
    if (key) return [key];
    if (category === "menu") return ["food", "drinks"];
    return [];
  }

  static #toV2(tavern) {
    tavern.inventory = this.#normalizeInventory(tavern.inventory ?? {}, tavern);
  }

  static #toV3(tavern) {
    this.#normalizeV3(tavern);
  }

  static #toV4(tavern) {
    this.#normalizeV4(tavern);
  }

  static #normalizeV4(tavern) {
    if (!tavern.atmosphere || typeof tavern.atmosphere !== "object") return;
    const atmosphere = tavern.atmosphere;
    atmosphere.revision = Math.max(0, Math.trunc(Number(atmosphere.revision ?? 0) || 0));
    atmosphere.updatedAt = Number(atmosphere.updatedAt ?? Date.now()) || Date.now();
    atmosphere.crowd = Math.max(0, Math.min(100, Math.trunc(Number(atmosphere.crowd ?? atmosphere.mood?.crowd ?? 50) || 50)));
    atmosphere.crowdLabel = String(atmosphere.crowdLabel ?? "");
    atmosphere.rumors = this.#normalizeLifeEntries(atmosphere.rumors);
    atmosphere.regulars = this.#normalizeLifeEntries(atmosphere.regulars);
    atmosphere.incident = this.#normalizeLifeEntry(atmosphere.incident, { revealed: false });
    atmosphere.availabilityUsage = this.#normalizeAvailabilityUsage(atmosphere.availabilityUsage);
  }

  static #normalizeAvailabilityUsage(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const output = {};
    for (const [key, amount] of Object.entries(value)) {
      const safeKey = String(key ?? "").trim();
      if (!safeKey) continue;
      output[safeKey] = Math.max(0, Math.trunc(Number(amount) || 0));
    }
    return output;
  }

  static #normalizeV3(tavern) {
    tavern.lodgingBookings = Array.isArray(tavern.lodgingBookings) ? tavern.lodgingBookings.map((booking) => this.#normalizeBooking(booking)).filter(Boolean) : [];
    tavern.refreshState = tavern.refreshState && typeof tavern.refreshState === "object" ? tavern.refreshState : {};

    for (const key of INVENTORY_KEYS) {
      for (const entry of tavern.inventory?.[key] ?? []) this.#normalizeEntryV3(entry, key);
    }
  }

  static #normalizeInventory(inventory, legacyTavern = {}) {
    const legacyMenu = Array.isArray(legacyTavern.menu) ? legacyTavern.menu : [];
    const legacyFood = Array.isArray(legacyTavern.food) ? legacyTavern.food : legacyMenu.filter((entry) => entry.type === "food");
    const legacyDrinks = Array.isArray(legacyTavern.drinks) ? legacyTavern.drinks : legacyMenu.filter((entry) => entry.type === "drink");

    const normalized = {
      food: this.#asArray(inventory.food, legacyFood).map((entry) => this.#normalizeEntry(entry, "food")),
      drinks: this.#asArray(inventory.drinks ?? inventory.drink, legacyDrinks).map((entry) => this.#normalizeEntry(entry, "drink")),
      lodging: this.#asArray(inventory.lodging, legacyTavern.lodging).map((entry) => this.#normalizeEntry(entry, "room")),
      services: this.#asArray(inventory.services ?? inventory.service, legacyTavern.services).map((entry) => this.#normalizeEntry(entry, "service"))
    };

    for (const key of INVENTORY_KEYS) normalized[key] = normalized[key].filter(Boolean);
    return normalized;
  }

  static #normalizeEntry(entry, fallbackType) {
    if (!entry || typeof entry !== "object") return null;
    const clone = foundry.utils.deepClone(entry);
    clone.id ||= foundry.utils.randomID(12);
    clone.type ||= fallbackType;
    clone.name ||= "Без названия";
    clone.basePrice = Math.max(1, Math.trunc(Number(clone.basePrice ?? clone.price ?? 1) || 1));
    clone.price = Math.max(1, Math.trunc(Number(clone.price ?? clone.basePrice) || clone.basePrice));
    clone.unlimited = Boolean(clone.unlimited);

    if (clone.unlimited) {
      clone.stock = null;
      if (clone.type === "room") {
        clone.total = null;
        clone.occupied = 0;
      }
      this.#normalizeEntryV3(clone, this.#keyFromType(clone.type));
      return clone;
    }

    clone.stock = Math.max(0, Math.trunc(Number(clone.stock ?? 0) || 0));
    if (clone.type === "room") {
      clone.total = Math.max(clone.stock, Math.trunc(Number(clone.total ?? clone.stock) || clone.stock));
      clone.occupied = Math.max(0, Math.trunc(Number(clone.occupied ?? Math.max(0, clone.total - clone.stock)) || 0));
    }

    this.#normalizeEntryV3(clone, this.#keyFromType(clone.type));
    return clone;
  }

  static #normalizeEntryV3(entry, inventoryKey) {
    if (!entry) return;
    entry.pinned = Boolean(entry.pinned);
    if (entry.unlimited) {
      entry.maxStock = null;
      return;
    }

    if (entry.type === "room" || inventoryKey === "lodging") {
      entry.total = Math.max(0, Math.trunc(Number(entry.total ?? entry.stock ?? 0) || 0));
      entry.stock = Math.max(0, Math.min(entry.total, Math.trunc(Number(entry.stock ?? entry.total) || 0)));
      entry.occupied = Math.max(0, Math.min(entry.total, Math.trunc(Number(entry.occupied ?? Math.max(0, entry.total - entry.stock)) || 0)));
      entry.maxStock = entry.total;
      return;
    }

    entry.stock = Math.max(0, Math.trunc(Number(entry.stock ?? 0) || 0));
    entry.maxStock = Math.max(entry.stock, Math.trunc(Number(entry.maxStock ?? entry.stock ?? 1) || 1));
  }

  static #normalizeLifeEntries(entries) {
    return Array.isArray(entries) ? entries.map((entry) => this.#normalizeLifeEntry(entry)).filter(Boolean) : [];
  }

  static #normalizeLifeEntry(entry, defaults = {}) {
    if (!entry || typeof entry !== "object") return null;
    const clone = foundry.utils.deepClone(entry);
    clone.id ||= foundry.utils.randomID(12);
    clone.sourceKey ||= clone.id;
    clone.title = String(clone.title ?? clone.name ?? "Без названия");
    clone.text = String(clone.text ?? clone.description ?? "");
    clone.description = String(clone.description ?? clone.text ?? "");
    clone.gmText = String(clone.gmText ?? clone.secret ?? "");
    clone.goal = String(clone.goal ?? "");
    clone.tags = Array.isArray(clone.tags) ? clone.tags.map(String) : [];
    clone.pinned = Boolean(clone.pinned);
    if (Object.hasOwn(defaults, "revealed")) clone.revealed = Boolean(clone.revealed ?? defaults.revealed);
    return clone;
  }

  static #normalizeBooking(booking) {
    if (!booking || typeof booking !== "object") return null;
    const clone = foundry.utils.deepClone(booking);
    clone.id ||= foundry.utils.randomID(12);
    clone.tavernId ||= null;
    clone.actorId ||= null;
    clone.userId ||= null;
    clone.entryId ||= null;
    clone.entryName ||= "Ночлег";
    clone.quantity = Math.max(1, Math.trunc(Number(clone.quantity) || 1));
    clone.remainingDays = Math.max(0, Math.trunc(Number(clone.remainingDays ?? clone.days ?? 1) || 0));
    clone.totalDays = Math.max(clone.remainingDays, Math.trunc(Number(clone.totalDays ?? clone.days ?? clone.remainingDays) || clone.remainingDays));
    clone.createdAt ||= Date.now();
    return clone.entryId && clone.remainingDays > 0 ? clone : null;
  }

  static #keyFromType(type) {
    if (type === "food") return "food";
    if (type === "drink") return "drinks";
    if (type === "room") return "lodging";
    if (type === "service") return "services";
    return null;
  }

  static #asArray(value, fallback = []) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(fallback)) return fallback;
    return [];
  }

  static #emptyInventory() {
    return { food: [], drinks: [], lodging: [], services: [] };
  }
}
