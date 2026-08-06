import { TavernMigrations } from "./TavernMigrations.js";
import { TavernInventory } from "./TavernInventory.js";
import { TavernPricing } from "./TavernPricing.js";
import { TavernViewModel } from "./TavernViewModel.js";

export class TavernEditor {
  static removeEntry(tavern, category, entryId) {
    const clone = TavernMigrations.migrate(tavern);
    if (!clone) return null;

    const keys = TavernMigrations.categorySearchKeys(category);
    for (const key of keys) clone.inventory[key] = (clone.inventory[key] ?? []).filter((entry) => entry.id !== entryId);

    clone.summary = TavernViewModel.summary(clone);
    return clone;
  }

  static addRandomEntry(tavern, category) {
    const clone = TavernInventory.addRandomEntry(tavern, category);
    if (!clone) return null;
    clone.summary = TavernViewModel.summary(clone);
    return clone;
  }

  static upsertEntry(tavern, category, entryId, patch = {}) {
    const clone = TavernMigrations.migrate(tavern);
    if (!clone) return null;

    const key = TavernMigrations.categoryToInventoryKey(category);
    if (!key) throw new Error("Неизвестная категория позиции.");

    const list = clone.inventory[key] ?? (clone.inventory[key] = []);
    const index = entryId ? list.findIndex((entry) => entry.id === entryId) : -1;
    const current = index >= 0 ? list[index] : {};
    const type = key === "drinks" ? "drink" : key === "lodging" ? "room" : key === "services" ? "service" : "food";
    const unlimited = Boolean(patch.unlimited);
    const basePrice = Math.max(1, Math.trunc(Number(patch.basePrice ?? current.basePrice ?? current.price ?? 1) || 1));
    const price = Math.max(1, Math.round(basePrice * TavernPricing.normalizeMultiplier(clone.priceMultiplier ?? 1)));

    const entry = {
      ...current,
      id: current.id ?? foundry.utils.randomID(12),
      type,
      name: String(patch.name ?? current.name ?? "Без названия").trim() || "Без названия",
      desc: String(patch.desc ?? current.desc ?? "").trim(),
      basePrice,
      price,
      unlimited,
      local: Boolean(patch.local ?? current.local),
      pinned: Boolean(patch.pinned ?? current.pinned)
    };

    if (unlimited) {
      entry.stock = null;
      entry.maxStock = null;
      if (key === "lodging") {
        entry.total = null;
        entry.occupied = 0;
      }
    } else if (key === "lodging") {
      const stock = Math.max(0, Math.trunc(Number(patch.stock ?? current.stock ?? 0) || 0));
      const total = Math.max(stock, Math.trunc(Number(patch.total ?? current.total ?? stock) || 0));
      entry.stock = stock;
      entry.total = total;
      entry.maxStock = total;
      entry.occupied = Math.max(0, total - stock);
    } else {
      const stock = Math.max(0, Math.trunc(Number(patch.stock ?? current.stock ?? 0) || 0));
      entry.stock = stock;
      entry.maxStock = Math.max(stock, Math.trunc(Number(current.maxStock ?? stock) || 0));
    }

    if (index >= 0) list[index] = entry;
    else list.push(entry);
    clone.summary = TavernViewModel.summary(clone);
    return clone;
  }

  static togglePinned(tavern, category, entryId) {
    const clone = TavernMigrations.migrate(tavern);
    const entry = this.findEntry(clone, category, entryId);
    if (!entry) return clone;
    entry.pinned = !entry.pinned;
    return clone;
  }

  static restockAll(tavern) {
    const clone = TavernMigrations.migrate(tavern);
    if (!clone) return null;

    for (const key of ["food", "drinks", "services"]) {
      for (const entry of clone.inventory?.[key] ?? []) {
        if (entry.unlimited) continue;
        entry.stock = Math.max(0, Math.trunc(Number(entry.maxStock ?? entry.stock ?? 0) || 0));
      }
    }
    return clone;
  }

  static updateLodgingEntry(tavern, entryId, patch) {
    const clone = TavernMigrations.migrate(tavern);
    if (!clone) return null;

    const room = (clone.inventory.lodging ?? []).find((entry) => entry.id === entryId);
    if (!room) return clone;

    if (Object.hasOwn(patch, "unlimited")) {
      room.unlimited = Boolean(patch.unlimited);
      if (room.unlimited) {
        room.stock = null;
        room.total = null;
        room.maxStock = null;
        room.occupied = 0;
      } else {
        room.total = Math.max(1, Number(room.total ?? 1));
        room.stock = Math.max(0, Math.min(Number(room.stock ?? room.total), room.total));
        room.maxStock = room.total;
        room.occupied = Math.max(0, room.total - room.stock);
      }
    }

    if (!room.unlimited) {
      if (Object.hasOwn(patch, "total")) room.total = Math.max(0, Math.trunc(Number(patch.total) || 0));
      if (Object.hasOwn(patch, "stock")) room.stock = Math.max(0, Math.trunc(Number(patch.stock) || 0));
      if (room.total < room.stock) room.total = room.stock;
      room.maxStock = room.total;
      room.occupied = Math.max(0, room.total - room.stock);
    }

    clone.summary = TavernViewModel.summary(clone);
    return clone;
  }

  static findEntry(tavern, category, entryId) {
    const key = TavernMigrations.categoryToInventoryKey(category);
    return (tavern?.inventory?.[key] ?? []).find((entry) => entry.id === entryId) ?? null;
  }
}
