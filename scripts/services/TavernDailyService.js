import { MODULE_ID } from "../constants.js";
import { TavernState } from "./TavernState.js";
import { TavernGenerator } from "./TavernGenerator.js";
import { TavernMigrations } from "./TavernMigrations.js";
import { TavernEditor } from "./TavernEditor.js";
import { CalendariaAdapter } from "./CalendariaAdapter.js";
import { TavernSocket } from "./TavernSocket.js";
import { TavernAtmosphereService } from "./TavernAtmosphereService.js";

const REFRESHABLE_KEYS = ["food", "drinks", "services"];

export class TavernDailyService {
  static registerSettings() {
    game.settings.register(MODULE_ID, "calendariaIntegrationEnabled", {
      name: "Calendaria: обновление таверн по дням",
      hint: "Если включено, модуль реагирует на смену дня Calendaria. Без Calendaria автоматического триггера нет: используй кнопку «Новый день» или API game.fblTaverns.advanceTavernDay().",
      scope: "world",
      config: true,
      type: Boolean,
      default: true
    });

    game.settings.register(MODULE_ID, "dailyInventoryRefreshEnabled", {
      name: "Ежедневное обновление запасов таверн",
      hint: "При смене дня обновляет количество еды, напитков, услуг и часть занятости комнат.",
      scope: "world",
      config: true,
      type: Boolean,
      default: true
    });

    game.settings.register(MODULE_ID, "dailyMenuRotationEnabled", {
      name: "Ежедневная смена части меню",
      hint: "При смене дня иногда убирает одно блюдо/напиток и добавляет случайную новую позицию.",
      scope: "world",
      config: true,
      type: Boolean,
      default: true
    });

    game.settings.register(MODULE_ID, "dailyAtmosphereRefreshEnabled", {
      name: "Ежедневное обновление жизни таверн",
      hint: "При смене дня обновляет настроение, слухи, завсегдатаев и происшествие. Закрепленные слухи и завсегдатаи сохраняются.",
      scope: "world",
      config: true,
      type: Boolean,
      default: true
    });
  }

  static registerHooks() {
    CalendariaAdapter.registerDayHooks((payload) => this.handlePossibleDayChange(payload));
  }

  static async handlePossibleDayChange(payload = null) {
    if (!game.user?.isGM) return null;
    if (!this.#setting("calendariaIntegrationEnabled", true)) return null;
    if (!TavernSocket.isResponsibleGM()) return null;

    return TavernState.transaction(async (transaction) => {
      const dayInfo = CalendariaAdapter.currentDateInfo(payload);
      const key = dayInfo.key;
      if (!key) return null;
      if (TavernState.getLastDailyRefreshKey() === key) return null;

      const result = await this.advanceDay({ dayKey: key, dayInfo, reason: payload?.hookName ?? "manual-or-calendaria", transaction });
      await TavernState.setLastDailyRefreshKey(key);
      return result;
    });
  }

  static async advanceDay({ dayKey = null, dayInfo = null, reason = "manual", transaction = null } = {}) {
    return TavernState.transaction(async (token) => {
      if (!game.user?.isGM) throw new Error("Только ГМ может обновлять таверны по новому дню.");

      const saved = TavernState.getSaved();
      const current = TavernState.getCurrent();
      let updatedSaved = [];
      const changedIds = new Set();
      let expiredTotal = 0;

      for (const savedTavern of saved) {
        const tavern = current?.id === savedTavern.id ? current : savedTavern;
        const result = this.refreshTavernForNewDay(tavern, { dayKey, dayInfo, reason });
        updatedSaved.push(result.tavern);
        if (result.changed) changedIds.add(result.tavern.id);
        expiredTotal += result.expired?.length ?? 0;
      }

      if (changedIds.size) updatedSaved = await TavernState.setSavedMany(updatedSaved, { transaction: token });

      let updatedCurrent = null;
      if (current) {
        const savedVersion = updatedSaved.find((tavern) => tavern.id === current.id);
        if (savedVersion) updatedCurrent = savedVersion;
        else {
          const result = this.refreshTavernForNewDay(current, { dayKey, dayInfo, reason });
          updatedCurrent = result.tavern;
          expiredTotal += result.expired.length;
          if (result.changed) {
            updatedCurrent = await TavernState.setCurrent(updatedCurrent, { transaction: token });
            changedIds.add(updatedCurrent.id);
          }
        }
      }

      const tavernData = updatedCurrent ?? null;
      TavernSocket.refreshAll(tavernData);

      return {
        changed: changedIds.size,
        expired: expiredTotal,
        current: updatedCurrent
      };
    }, transaction);
  }

  static async advanceTavern(tavern, { dayKey = null, dayInfo = null, reason = "manual", broadcast = true, transaction = null } = {}) {
    return TavernState.transaction(async (token) => {
      if (!game.user?.isGM) throw new Error("Только ГМ может начинать новый день в таверне.");
      if (!tavern?.id) throw new Error("Таверна не выбрана.");

      const tavernId = String(tavern.id);
      const wasCurrent = TavernState.getCurrent()?.id === tavernId;
      const wasSaved = Boolean(TavernState.getSavedById(tavernId));
      // Read inside the transaction; a GM dialog may have been open during a purchase.
      const latest = wasCurrent ? TavernState.getCurrent() : TavernState.getSavedById(tavernId);
      const result = this.refreshTavernForNewDay(latest ?? tavern, { dayKey, dayInfo, reason });

      let updated = result.tavern;
      if (result.changed && wasSaved) updated = await TavernState.saveTavern(updated, { transaction: token });
      else if (result.changed && wasCurrent) updated = await TavernState.setCurrent(updated, { transaction: token });
      if (broadcast && result.changed && (wasCurrent || wasSaved)) TavernSocket.refreshAll(updated);

      return {
        ...result,
        tavern: updated,
        wasCurrent,
        wasSaved
      };
    }, transaction);
  }

  static refreshTavernForNewDay(tavern, { dayKey = null, dayInfo = null, reason = "manual" } = {}) {
    let clone = TavernMigrations.migrate(tavern);
    if (!clone) return { tavern: clone, changed: false, expired: [] };
    if (dayKey && clone.refreshState?.lastDayKey === dayKey) return { tavern: clone, changed: false, expired: [] };

    let days = 1;
    const oldWorldDay = /^world:(-?\d+)$/.exec(clone.refreshState?.lastDayKey ?? "");
    const newWorldDay = /^world:(-?\d+)$/.exec(dayKey ?? "");
    const ordinal = dayInfo?.ordinal ?? (newWorldDay ? Number(newWorldDay[1]) : null);
    const clockId = dayInfo?.clockId ?? (newWorldDay ? "world" : null);
    const previous = clone.refreshState?.lastDayOrdinal ?? (oldWorldDay ? Number(oldWorldDay[1]) : dayInfo?.previousOrdinal);
    if (ordinal !== null && previous != null) {
      const previousClock = clone.refreshState?.clockId ?? (oldWorldDay ? "world" : clockId);
      days = previousClock === clockId ? Math.max(0, Math.trunc(ordinal - previous)) : 0;
      if (!days && previousClock === clockId) return { tavern: clone, changed: false, expired: [] };
    }

    const before = JSON.stringify(clone);
    const lodging = TavernState.advanceLodgingDayInData(clone, days, { ordinal, clockId });
    clone = lodging.tavern;

    if (days && this.#setting("dailyInventoryRefreshEnabled", true)) {
      this.#refreshStocks(clone);
      this.#refreshRoomOccupancy(clone);
    }

    // Catch up bookings exactly; roll the final day's menu once even for a long time jump.
    if (days && this.#setting("dailyMenuRotationEnabled", true)) clone = this.#rotateMenu(clone);
    if (days && this.#setting("dailyAtmosphereRefreshEnabled", true)) clone = TavernAtmosphereService.advanceDay(clone);

    clone.refreshState ??= {};
    clone.refreshState.lastDayKey = dayKey;
    if (ordinal !== null) {
      clone.refreshState.lastDayOrdinal = ordinal;
      clone.refreshState.clockId = clockId;
    } else if (!dayInfo && (!dayKey || dayKey.startsWith("manual:"))) {
      // A manual/API advance consumes exactly one day and anchors future hooks
      // at today's calendar position. Moving the clock back must not lower its watermark.
      const currentDay = CalendariaAdapter.currentDateInfo();
      const previousClock = clone.refreshState.clockId ?? (oldWorldDay ? "world" : null);
      const previousOrdinal = clone.refreshState.lastDayOrdinal ?? (oldWorldDay ? Number(oldWorldDay[1]) : null);
      clone.refreshState.lastDayKey = dayKey ?? currentDay.key;
      if (currentDay.ordinal != null) {
        clone.refreshState.lastDayOrdinal = previousClock === currentDay.clockId && previousOrdinal != null
          ? Math.max(previousOrdinal, currentDay.ordinal) : currentDay.ordinal;
        clone.refreshState.clockId = currentDay.clockId;
      }
    }
    clone.refreshState.lastReason = reason;
    clone.refreshState.lastRefreshedAt = Date.now();
    clone.summary = TavernGenerator.decoratePrices(clone)?.summary ?? clone.summary;

    return {
      tavern: clone,
      changed: before !== JSON.stringify(clone),
      expired: lodging.expired ?? []
    };
  }

  static #refreshStocks(tavern) {
    for (const key of REFRESHABLE_KEYS) {
      for (const entry of tavern.inventory?.[key] ?? []) {
        if (entry.unlimited) continue;
        const rawMax = Number(entry.maxStock ?? entry.stock ?? 1);
        const max = Number.isFinite(rawMax) ? Math.max(0, Math.trunc(rawMax)) : 0;
        const low = key === "services" ? 0.45 : 0.7;
        const high = 1;
        entry.stock = Math.min(max, Math.max(0, Math.round(max * this.#float(low, high))));
        entry.maxStock = max;
      }
    }
  }

  static #refreshRoomOccupancy(tavern) {
    for (const room of tavern.inventory?.lodging ?? []) {
      if (room.unlimited) continue;
      const rawTotal = Number(room.total ?? room.maxStock ?? room.stock ?? 0);
      const total = Number.isFinite(rawTotal) ? Math.max(0, rawTotal) : 0;
      const playerBooked = TavernState.activeRoomBookingsForEntry(tavern, room.id);
      const currentOccupied = Math.max(playerBooked, Number(room.occupied ?? Math.max(0, total - Number(room.stock ?? 0))));
      const drift = this.#int(-2, 2);
      const nextOccupied = Math.max(playerBooked, Math.min(total, currentOccupied + drift));
      room.occupied = nextOccupied;
      room.stock = Math.max(0, total - nextOccupied);
      room.maxStock = total;
    }
  }

  static #rotateMenu(tavern) {
    let clone = tavern;

    for (const category of ["food", "drinks"]) {
      if (Math.random() > 0.35) continue;
      const key = category === "drinks" ? "drinks" : "food";
      const list = clone.inventory?.[key] ?? [];
      if (!list.length) continue;

      const removable = list.filter((entry) => !entry.pinned && (!entry.local || Math.random() < 0.35));
      const victim = removable[Math.floor(Math.random() * removable.length)];
      if (!victim) continue;

      clone = TavernEditor.removeEntry(clone, category, victim.id) ?? clone;
      clone = TavernEditor.addRandomEntry(clone, category) ?? clone;
    }

    return clone;
  }

  static #setting(key, fallback) {
    try {
      return game.settings.get(MODULE_ID, key);
    } catch (_error) {
      return fallback;
    }
  }

  static #int(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  static #float(min, max) {
    return min + Math.random() * (max - min);
  }
}
