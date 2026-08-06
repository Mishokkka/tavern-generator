import { MODULE_ID } from "../constants.js";
import { TavernMigrations } from "./TavernMigrations.js";
import { TavernAvailabilityService } from "./TavernAvailabilityService.js";
import { TavernAtmosphereService } from "./TavernAtmosphereService.js";
import { TavernPrivateStore } from "./TavernPrivateStore.js";

export class TavernState {
  static registerSettings() {
    game.settings.register(MODULE_ID, "currentTavern", {
      name: "Current Tavern",
      scope: "world",
      config: false,
      type: Object,
      default: null
    });

    game.settings.register(MODULE_ID, "savedTaverns", {
      name: "Saved Taverns",
      scope: "world",
      config: false,
      type: Object,
      default: []
    });

    game.settings.register(MODULE_ID, "privateStateJournalId", {
      name: "Private Tavern State Journal",
      scope: "world",
      config: false,
      type: String,
      default: ""
    });

    game.settings.register(MODULE_ID, "currencyMode", {
      name: "Currency Mode",
      hint: "auto tries to update the Forbidden Lands wallet. flags stores money in module flags if no known FBL path is found.",
      scope: "world",
      config: true,
      type: String,
      choices: {
        auto: "Auto-detect FBL actor currency",
        flags: "Module flag wallet fallback"
      },
      default: "auto"
    });

    game.settings.register(MODULE_ID, "lastDailyRefreshKey", {
      name: "Last Tavern Daily Refresh Key",
      scope: "world",
      config: false,
      type: String,
      default: ""
    });
  }

  static async initialize() {
    const active = await TavernPrivateStore.initialize();
    if (!active) {
      if (game.user?.isGM) throw new Error("Закрытое хранилище таверн недоступно.");
      return false;
    }

    const stored = TavernPrivateStore.state;
    const storedCurrent = TavernMigrations.migrate(stored.current);
    const storedSaved = TavernMigrations.migrateMany(stored.saved);
    const legacyCurrent = TavernMigrations.migrate(game.settings.get(MODULE_ID, "currentTavern"));
    const legacySavedRaw = game.settings.get(MODULE_ID, "savedTaverns");
    const legacySaved = TavernMigrations.migrateMany(Array.isArray(legacySavedRaw) ? legacySavedRaw : []);

    const hasPrivateData = Boolean(storedCurrent || storedSaved.length);
    const state = hasPrivateData
      ? { current: storedCurrent, saved: storedSaved }
      : { current: legacyCurrent, saved: legacySaved };

    await this.#writePrivateState(state);
    await this.#mirrorPublicState(state.current);
    if (legacySaved.length) await game.settings.set(MODULE_ID, "savedTaverns", []);
    return true;
  }

  static getCurrent() {
    if (TavernPrivateStore.active && game.user?.isGM) {
      return TavernMigrations.migrate(TavernPrivateStore.state.current);
    }
    return TavernMigrations.migrate(game.settings.get(MODULE_ID, "currentTavern"));
  }

  static async setCurrent(tavern, { touch = true } = {}) {
    if (!game.user.isGM) throw new Error("Only a GM can set the active tavern.");
    this.#assertPrivateStoreWritable();
    const migrated = TavernMigrations.migrate(tavern);
    if (touch || !Number.isFinite(Number(migrated.updatedAt))) migrated.updatedAt = Date.now();
    const state = TavernPrivateStore.state;
    state.current = foundry.utils.deepClone(migrated);
    await this.#writePrivateState(state);
    await this.#mirrorPublicState(migrated);
    return migrated;
  }

  static async clearCurrent() {
    if (!game.user.isGM) throw new Error("Only a GM can clear the active tavern.");
    this.#assertPrivateStoreWritable();
    const state = TavernPrivateStore.state;
    state.current = null;
    await this.#writePrivateState(state);
    await game.settings.set(MODULE_ID, "currentTavern", null);
  }

  static getSaved() {
    if (!game.user?.isGM || !TavernPrivateStore.active) return [];
    return TavernMigrations.migrateMany(TavernPrivateStore.state.saved);
  }

  static async setSavedMany(taverns) {
    if (!game.user.isGM) throw new Error("Only a GM can update saved taverns.");
    this.#assertPrivateStoreWritable();
    const migrated = TavernMigrations.migrateMany(taverns ?? []);
    migrated.sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"));
    const state = TavernPrivateStore.state;
    state.saved = foundry.utils.deepClone(migrated);
    await this.#writePrivateState(state);
    return migrated;
  }

  static async saveTavern(tavern) {
    if (!game.user.isGM) throw new Error("Only a GM can save taverns.");
    if (!tavern) throw new Error("Таверна не выбрана.");

    const saved = this.getSaved();
    const clone = TavernMigrations.migrate(tavern);
    clone.savedAt = Date.now();
    clone.updatedAt = clone.savedAt;
    clone.id ||= foundry.utils.randomID(16);

    const index = saved.findIndex((entry) => entry.id === clone.id);
    if (index >= 0) saved[index] = clone;
    else saved.push(clone);

    saved.sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"));
    await this.setSavedMany(saved);
    return clone;
  }

  static async deleteSaved(id) {
    if (!game.user.isGM) throw new Error("Only a GM can delete saved taverns.");
    const saved = this.getSaved().filter((entry) => entry.id !== id);
    await this.setSavedMany(saved);
  }

  static getSavedById(id) {
    return this.getSaved().find((entry) => entry.id === id) ?? null;
  }

  static resolveExactTavern({ tavernId = null, sceneId = null, fallback = null, requirePrivate = false } = {}) {
    const requestedId = String(tavernId ?? fallback?.id ?? "").trim();
    if (!requestedId) return fallback ? TavernMigrations.migrate(fallback) : null;

    try {
      const resolved = this.resolveTrustedTavern({ tavernId: requestedId, sceneId });
      if (resolved?.id === requestedId && (!requirePrivate || resolved.atmosphere)) return resolved;
    } catch (_error) {
      // Fall through to a same-id fallback. A mismatched fallback is never accepted.
    }

    const migratedFallback = TavernMigrations.migrate(fallback);
    if (migratedFallback?.id !== requestedId) return null;
    if (requirePrivate && !migratedFallback.atmosphere) return null;
    return migratedFallback;
  }

  static resolveTrustedTavern({ tavernId = null, sceneId = null } = {}) {
    const requestedId = String(tavernId ?? "").trim();
    const requestedSceneId = String(sceneId ?? "").trim();
    const current = this.getCurrent();

    if (requestedId && current?.id === requestedId) return foundry.utils.deepClone(current);

    if (requestedId) {
      const saved = this.getSavedById(requestedId);
      if (saved) return foundry.utils.deepClone(saved);
    }

    if (requestedSceneId) {
      const scene = game.scenes?.get(requestedSceneId);
      const linkedId = String(
        scene?.getFlag?.(MODULE_ID, "shopButton")?.tavernId
        ?? scene?.getFlag?.(MODULE_ID, "tavernPublicView")?.id
        ?? scene?.getFlag?.(MODULE_ID, "tavernData")?.id
        ?? ""
      ).trim();
      const trustedId = requestedId || linkedId;
      if (trustedId) {
        if (current?.id === trustedId) return foundry.utils.deepClone(current);
        const saved = this.getSavedById(trustedId);
        if (saved) return foundry.utils.deepClone(saved);
      }
    }

    if (!requestedId && current) return foundry.utils.deepClone(current);
    throw new Error("Таверна не найдена в доверенном состоянии ГМа. Обнови окно меню.");
  }

  static snapshotTavernStorage(tavernId) {
    const id = String(tavernId ?? "").trim();
    const current = this.getCurrent();
    const saved = this.getSavedById(id);
    return {
      tavernId: id,
      currentMatched: current?.id === id,
      current: current?.id === id ? foundry.utils.deepClone(current) : null,
      savedMatched: Boolean(saved),
      saved: saved ? foundry.utils.deepClone(saved) : null
    };
  }

  static async restoreTavernStorageSnapshot(snapshot) {
    if (!game.user.isGM) throw new Error("Only a GM can restore tavern state.");
    const id = String(snapshot?.tavernId ?? "").trim();
    if (!id) throw new Error("Снимок таверны поврежден.");

    const current = this.getCurrent();
    if (snapshot.currentMatched) {
      await this.setCurrent(foundry.utils.deepClone(snapshot.current), { touch: false });
    } else if (current?.id === id) {
      await this.clearCurrent();
    }

    const saved = this.getSaved().filter((entry) => entry.id !== id);
    if (snapshot.savedMatched && snapshot.saved) saved.push(foundry.utils.deepClone(snapshot.saved));
    saved.sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"));
    await this.setSavedMany(saved);
  }

  static async persistPurchaseTavern(tavern) {
    if (!game.user.isGM) throw new Error("Only a GM can persist tavern purchases.");
    if (!tavern?.id) throw new Error("У таверны отсутствует идентификатор.");

    let updated = TavernMigrations.migrate(tavern);
    const current = this.getCurrent();
    const saved = this.getSavedById(updated.id);

    if (saved) updated = await this.saveTavern(updated);
    if (current?.id === updated.id) updated = await this.setCurrent(updated, { touch: !saved });
    if (current?.id !== updated.id && !saved) {
      throw new Error("Таверна не сохранена в доверенном состоянии ГМа. Сначала сохрани или активируй её.");
    }
    return updated;
  }

  static getLastDailyRefreshKey() {
    return String(game.settings.get(MODULE_ID, "lastDailyRefreshKey") ?? "");
  }

  static async setLastDailyRefreshKey(key) {
    if (!game.user.isGM) throw new Error("Only a GM can update tavern daily refresh state.");
    await game.settings.set(MODULE_ID, "lastDailyRefreshKey", String(key ?? ""));
  }

  static findEntry(tavern, category, entryId) {
    const migrated = TavernMigrations.migrate(tavern);
    return this.#findEntryRecord(migrated, category, entryId)?.entry ?? null;
  }

  static async decrementStock(category, entryId, amount = 1) {
    const result = this.decrementStockInData(this.getCurrent(), category, entryId, amount);
    await this.setCurrent(result.tavern);
    return result;
  }

  static decrementStockInData(tavern, category, entryId, amount = 1) {
    const migrated = TavernMigrations.migrate(tavern);
    const record = this.#findEntryRecord(migrated, category, entryId);
    if (!record?.entry) throw new Error("Позиция таверны не найдена.");
    const count = Math.max(1, Math.trunc(Number(amount) || 1));
    if (!record.entry.unlimited) {
      const stock = Math.max(0, Math.trunc(Number(record.entry.stock) || 0));
      if (stock < count) throw new Error(`${record.entry.name}: недостаточно запаса.`);
      record.entry.stock = stock - count;
      if (record.key === "lodging") {
        record.entry.occupied = Math.min(
          Number(record.entry.total ?? record.entry.occupied ?? 0),
          Math.max(0, Number(record.entry.occupied ?? 0)) + count
        );
      }
    }
    return { tavern: migrated, entry: record.entry };
  }

  static purchaseEntryInData(tavern, category, entryId, { quantity = 1, days = 1, actorId = null, userId = null, actorName = null } = {}) {
    const migrated = TavernMigrations.migrate(tavern);
    const record = this.#findEntryRecord(migrated, category, entryId);
    const entry = record?.entry;
    if (!entry) throw new Error("Позиция таверны не найдена.");

    const count = Math.max(1, Math.trunc(Number(quantity) || 1));
    const stayDays = Math.max(1, Math.trunc(Number(days) || 1));

    if (record.key === "lodging") {
      if (!entry.unlimited) {
        if ((entry.stock ?? 0) < count) throw new Error(`${entry.name}: нет нужного количества свободных мест.`);
        entry.stock -= count;
        entry.occupied = Math.min(entry.total ?? entry.occupied ?? 0, (entry.occupied ?? 0) + count);
      }

      const booking = {
        id: foundry.utils.randomID(12),
        tavernId: migrated.id ?? null,
        actorId,
        userId,
        actorName,
        entryId: entry.id,
        entryName: entry.name,
        quantity: count,
        totalDays: stayDays,
        remainingDays: stayDays,
        unlimited: Boolean(entry.unlimited),
        createdAt: Date.now()
      };

      migrated.lodgingBookings ??= [];
      migrated.lodgingBookings.push(booking);
      return { tavern: migrated, entry, booking };
    }

    const availability = TavernAvailabilityService.forEntry(migrated, record.key, entry);
    if (count > availability.maxPurchaseQuantity) {
      if (availability.maxPurchaseQuantity <= 0) throw new Error(`${entry.name}: сейчас недоступно из-за заполненности таверны.`);
      throw new Error(`${entry.name}: сейчас доступно только ${availability.maxPurchaseQuantity}.`);
    }

    if (!entry.unlimited) entry.stock -= count;
    TavernAvailabilityService.recordPurchase(migrated, record.key, entry, count);

    return { tavern: migrated, entry, booking: null };
  }

  static advanceLodgingDayInData(tavern) {
    const migrated = TavernMigrations.migrate(tavern);
    const bookings = Array.isArray(migrated.lodgingBookings) ? migrated.lodgingBookings : [];
    const remaining = [];
    const expired = [];

    for (const booking of bookings) {
      const next = foundry.utils.deepClone(booking);
      next.remainingDays = Math.max(0, Math.trunc(Number(next.remainingDays ?? 0) || 0) - 1);

      if (next.remainingDays > 0) {
        remaining.push(next);
        continue;
      }

      expired.push(next);
      if (next.unlimited) continue;

      const room = this.#findEntryRecord(migrated, "lodging", next.entryId)?.entry;
      if (!room || room.unlimited) continue;
      const quantity = Math.max(1, Math.trunc(Number(next.quantity) || 1));
      room.stock = Math.min(room.total ?? room.stock ?? 0, Math.max(0, Number(room.stock ?? 0)) + quantity);
      room.occupied = Math.max(0, Number(room.occupied ?? 0) - quantity);
    }

    migrated.lodgingBookings = remaining;
    return { tavern: migrated, expired };
  }

  static activeRoomBookingsForEntry(tavern, entryId) {
    const migrated = TavernMigrations.migrate(tavern);
    return (migrated?.lodgingBookings ?? [])
      .filter((booking) => booking.entryId === entryId && !booking.unlimited && Number(booking.remainingDays ?? 0) > 0)
      .reduce((sum, booking) => sum + Math.max(1, Math.trunc(Number(booking.quantity) || 1)), 0);
  }

  static #findEntryRecord(tavern, category, entryId) {
    const keys = TavernMigrations.categorySearchKeys(category);

    for (const key of keys) {
      const list = tavern?.inventory?.[key];
      if (!Array.isArray(list)) continue;
      const entry = list.find((item) => item.id === entryId);
      if (entry) return { key, entry, list };
    }

    return null;
  }

  static #assertPrivateStoreWritable() {
    if (!TavernPrivateStore.active) {
      throw new Error("Закрытое хранилище таверн недоступно. Изменения не сохранены.");
    }
  }

  static async #writePrivateState(state) {
    this.#assertPrivateStoreWritable();
    const written = await TavernPrivateStore.write(state);
    if (!written) {
      throw new Error("Закрытое хранилище таверн стало недоступно. Изменения не сохранены.");
    }
  }

  static async #mirrorPublicState(tavern) {
    const publicView = tavern ? TavernAtmosphereService.publicView(tavern) : null;
    await game.settings.set(MODULE_ID, "currentTavern", publicView ? foundry.utils.deepClone(publicView) : null);
  }
}
