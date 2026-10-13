import { MODULE_ID } from "../constants.js";
import { TavernMigrations } from "./TavernMigrations.js";
import { TavernAvailabilityService } from "./TavernAvailabilityService.js";
import { TavernAtmosphereService } from "./TavernAtmosphereService.js";
import { TavernPrivateStore } from "./TavernPrivateStore.js";
import { AsyncLock } from "./AsyncLock.js";
import { CalendariaAdapter } from "./CalendariaAdapter.js";

export class TavernState {
  static #transactions = new WeakSet();

  // Explicit tokens allow nested operations without making the queue reentrant for unrelated calls.
  static async transaction(task, transaction = null) {
    if (transaction && this.#transactions.has(transaction)) return task(transaction);
    return AsyncLock.run("tavern-state", async () => {
      const token = {};
      this.#transactions.add(token);
      try { return await task(token); }
      finally { this.#transactions.delete(token); }
    });
  }

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
      ? { ...stored, current: storedCurrent, saved: storedSaved }
      : { ...stored, current: legacyCurrent, saved: legacySaved };

    await this.#writePrivateState(state);
    await this.#mirrorPublicState(state.current);
    if (legacySaved.length) await game.settings.set(MODULE_ID, "savedTaverns", []);
    return true;
  }

  static getCurrent() {
    if (TavernPrivateStore.active && game.user?.isGM) {
      return TavernMigrations.migrate(TavernPrivateStore.current);
    }
    return TavernMigrations.migrate(game.settings.get(MODULE_ID, "currentTavern"));
  }

  static async setCurrent(tavern, { touch = true, transaction = null } = {}) {
    return this.transaction(() => this.#commitTavern(tavern, { activate: true, touch }), transaction);
  }

  static async clearCurrent({ transaction = null } = {}) {
    return this.transaction(async () => {
      if (!game.user.isGM) throw new Error("Only a GM can clear the active tavern.");
      this.#assertPrivateStoreWritable();
      const state = TavernPrivateStore.state;
      state.current = null;
      await this.#writePrivateState(state);
      await this.#mirrorPublicState(null);
    }, transaction);
  }

  static getSaved() {
    if (!game.user?.isGM || !TavernPrivateStore.active) return [];
    return TavernMigrations.migrateMany(TavernPrivateStore.saved);
  }

  static async setSavedMany(taverns, { transaction = null } = {}) {
    return this.transaction(async () => {
      if (!game.user.isGM) throw new Error("Only a GM can update saved taverns.");
      this.#assertPrivateStoreWritable();
      const migrated = TavernMigrations.migrateMany(taverns ?? []);
      migrated.sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"));
      const state = TavernPrivateStore.state;
      for (const tavern of migrated) {
        this.#assertRevision(tavern, state);
        tavern.storageRevision = this.#latestRevision(tavern.id, state) + 1;
      }
      state.saved = foundry.utils.deepClone(migrated);
      const active = migrated.find((tavern) => tavern.id === state.current?.id);
      if (active) state.current = foundry.utils.deepClone(active);
      await this.#writePrivateState(state);
      if (active) await this.#mirrorPublicState(active);
      return migrated;
    }, transaction);
  }

  static async saveTavern(tavern, { transaction = null } = {}) {
    return this.transaction(() => this.#commitTavern(tavern, { save: true }), transaction);
  }

  static async deleteSaved(id, { transaction = null } = {}) {
    return this.transaction(async () => {
      if (!game.user.isGM) throw new Error("Only a GM can delete saved taverns.");
      const state = TavernPrivateStore.state;
      state.saved = state.saved.filter((entry) => entry.id !== id);
      await this.#writePrivateState(state);
    }, transaction);
  }

  static getSavedById(id) {
    if (!game.user?.isGM || !TavernPrivateStore.active) return null;
    return TavernMigrations.migrate(TavernPrivateStore.savedById(id));
  }

  static getPurchase(id) {
    return game.user?.isGM ? TavernPrivateStore.purchaseById(id) : null;
  }

  static async recordPurchase(id, record, { transaction = null } = {}) {
    return this.transaction(async () => {
        const state = TavernPrivateStore.state;
        state.purchases[id] = foundry.utils.deepClone(record);
        await this.#writePrivateState(state);
    }, transaction);
  }

  static pendingPurchases() {
    if (!game.user?.isGM) return [];
    return TavernPrivateStore.pendingPurchases();
  }

  static async resolvePendingPurchase(id, outcome) {
    return this.transaction(async (transaction) => {
      this.#assertPrivateStoreWritable();
      const record = this.getPurchase(id);
      if (record?.status !== "pending") throw new Error("Незавершённая покупка не найдена.");
      if (!["completed", "cancelled"].includes(outcome)) throw new Error("Укажи completed или cancelled после сверки кошелька и запасов.");
      await this.recordPurchase(id, { ...record, status: outcome === "completed" ? "completed" : "failed",
        message: "Покупка отменена ГМом после проверки. Собери и оплати корзину заново.",
        resolvedBy: game.user.id, resolvedAt: Date.now() }, { transaction });
      return { id, outcome };
    });
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

  static async restoreTavernStorageSnapshot(snapshot, { transaction = null } = {}) {
    return this.transaction(async () => {
      if (!game.user.isGM) throw new Error("Only a GM can restore tavern state.");
      const id = String(snapshot?.tavernId ?? "").trim();
      if (!id) throw new Error("Снимок таверны поврежден.");

      const state = TavernPrivateStore.state;
      if (snapshot.currentMatched) {
        state.current = foundry.utils.deepClone(snapshot.current);
      } else if (state.current?.id === id) {
        state.current = null;
      }

      const saved = state.saved.filter((entry) => entry.id !== id);
      if (snapshot.savedMatched && snapshot.saved) saved.push(foundry.utils.deepClone(snapshot.saved));
      saved.sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"));
      state.saved = saved;
      await this.#writePrivateState(state);
      await this.#mirrorPublicState(state.current);
    }, transaction);
  }

  static async persistPurchaseTavern(tavern, { transaction = null, receipt = null } = {}) {
    return this.transaction(async () => {
      if (!game.user.isGM) throw new Error("Only a GM can persist tavern purchases.");
      if (!tavern?.id) throw new Error("У таверны отсутствует идентификатор.");

      if (this.getCurrent()?.id !== tavern.id && !this.getSavedById(tavern.id)) {
        throw new Error("Таверна не сохранена в доверенном состоянии ГМа. Сначала сохрани или активируй её.");
      }
      return this.#commitTavern(tavern, { receipt });
    }, transaction);
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

      const date = CalendariaAdapter.currentDateInfo();
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
        createdAt: Date.now(),
        calendarDayOrdinal: date.ordinal,
        calendarClockId: date.clockId
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

  static advanceLodgingDayInData(tavern, days = 1, { ordinal = null, clockId = null } = {}) {
    const migrated = TavernMigrations.migrate(tavern);
    const bookings = Array.isArray(migrated.lodgingBookings) ? migrated.lodgingBookings : [];
    const remaining = [];
    const expired = [];

    for (const booking of bookings) {
      const next = foundry.utils.deepClone(booking);
      let elapsed = Math.max(0, Math.trunc(days));
      if (ordinal !== null) {
        if (next.calendarClockId === clockId && next.calendarDayOrdinal != null) {
          elapsed = Math.min(elapsed, Math.max(0, ordinal - next.calendarDayOrdinal));
          next.calendarDayOrdinal = Math.max(ordinal, next.calendarDayOrdinal);
        } else next.calendarDayOrdinal = ordinal;
        next.calendarClockId = clockId;
      }
      next.remainingDays = Math.max(0, Math.trunc(Number(next.remainingDays ?? 0) || 0) - elapsed);

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
    if (!game.user?.isGM) throw new Error("Только ГМ может изменять состояние таверн.");
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
    try {
      const publicView = tavern ? TavernAtmosphereService.publicView(tavern) : null;
      await game.settings.set(MODULE_ID, "currentTavern", publicView ? foundry.utils.deepClone(publicView) : null);
    } catch (error) {
      // The private journal is already committed. A failed public mirror must never refund a purchase.
      console.warn(`${MODULE_ID} | Public tavern snapshot could not be updated`, error);
      ui.notifications.warn("Таверна сохранена, но публичное меню не обновилось. Открой его игрокам ещё раз.");
    }
  }

  static #latestRevision(id, state) {
    return Math.max(0, Number(state.current?.id === id ? state.current.storageRevision ?? 0 : 0),
      Number(state.saved.find((entry) => entry.id === id)?.storageRevision ?? 0));
  }

  static #assertRevision(tavern, state) {
    if (state.current?.id !== tavern.id && !state.saved.some((entry) => entry.id === tavern.id)) return;
    if (Number(tavern.storageRevision ?? 0) !== this.#latestRevision(tavern.id, state)) {
      throw new Error("Таверна уже изменена (покупка, новый день или другое окно ГМа). Загрузи свежую версию и повтори правку.");
    }
  }

  static async #commitTavern(tavern, { activate = false, save = false, touch = true, receipt = null } = {}) {
    this.#assertPrivateStoreWritable();
    const clone = TavernMigrations.migrate(tavern);
    if (!clone) throw new Error("Таверна не выбрана.");
    clone.id ||= foundry.utils.randomID(16);
    const state = TavernPrivateStore.state;
    this.#assertRevision(clone, state);
    clone.storageRevision = this.#latestRevision(clone.id, state) + 1;
    if (touch) clone.updatedAt = Date.now();
    const index = state.saved.findIndex((entry) => entry.id === clone.id);
    if (save || index >= 0) {
      clone.savedAt = Date.now();
      if (index >= 0) state.saved[index] = foundry.utils.deepClone(clone);
      else state.saved.push(foundry.utils.deepClone(clone));
      state.saved.sort((a, b) => String(a.name).localeCompare(String(b.name), "ru"));
    }
    const active = activate || state.current?.id === clone.id;
    if (active) state.current = foundry.utils.deepClone(clone);
    if (receipt) state.purchases[receipt.id] = foundry.utils.deepClone(receipt.record);
    await this.#writePrivateState(state);
    if (active) await this.#mirrorPublicState(clone);
    return clone;
  }
}
