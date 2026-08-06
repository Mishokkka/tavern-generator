import { MODULE_ID, SOCKET_NAME } from "../constants.js";
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
      hint: "Если включено, модуль пытается реагировать на смену дня Calendaria. Есть запасной API game.fblTaverns.advanceTavernDay().",
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

    const key = CalendariaAdapter.currentDayKey(payload);
    if (!key) return null;
    if (TavernState.getLastDailyRefreshKey() === key) return null;

    const result = await this.advanceDay({ dayKey: key, reason: payload?.hookName ?? "manual-or-calendaria" });
    await TavernState.setLastDailyRefreshKey(key);
    return result;
  }

  static async advanceDay({ dayKey = null, reason = "manual" } = {}) {
    if (!game.user?.isGM) throw new Error("Только ГМ может обновлять таверны по новому дню.");

    const saved = TavernState.getSaved();
    const current = TavernState.getCurrent();
    const updatedSaved = [];
    const changedIds = new Set();
    let expiredTotal = 0;

    for (const tavern of saved) {
      const result = this.refreshTavernForNewDay(tavern, { dayKey, reason });
      updatedSaved.push(result.tavern);
      if (result.changed) changedIds.add(result.tavern.id);
      expiredTotal += result.expired?.length ?? 0;
    }

    if (updatedSaved.length) await TavernState.setSavedMany(updatedSaved);

    let updatedCurrent = null;
    if (current) {
      const savedVersion = updatedSaved.find((tavern) => tavern.id === current.id);
      if (savedVersion) updatedCurrent = savedVersion;
      else updatedCurrent = this.refreshTavernForNewDay(current, { dayKey, reason }).tavern;
      await TavernState.setCurrent(updatedCurrent);
      changedIds.add(updatedCurrent.id);
    }

    const tavernData = updatedCurrent ?? null;
    TavernSocket.refreshAll(tavernData);

    return {
      changed: changedIds.size,
      expired: expiredTotal,
      current: updatedCurrent
    };
  }

  static async advanceTavern(tavern, { dayKey = null, reason = "manual", broadcast = true } = {}) {
    if (!game.user?.isGM) throw new Error("Только ГМ может начинать новый день в таверне.");
    if (!tavern?.id) throw new Error("Таверна не выбрана.");

    const tavernId = String(tavern.id);
    const wasCurrent = TavernState.getCurrent()?.id === tavernId;
    const wasSaved = Boolean(TavernState.getSavedById(tavernId));
    const result = this.refreshTavernForNewDay(tavern, { dayKey, reason });

    let updated = await TavernState.saveTavern(result.tavern);
    if (wasCurrent) updated = await TavernState.setCurrent(updated);
    if (broadcast) TavernSocket.refreshAll(updated);

    return {
      ...result,
      tavern: updated,
      wasCurrent,
      wasSaved
    };
  }

  static refreshTavernForNewDay(tavern, { dayKey = null, reason = "manual" } = {}) {
    let clone = TavernMigrations.migrate(tavern);
    if (!clone) return { tavern: clone, changed: false, expired: [] };

    const before = JSON.stringify(clone);
    const lodging = TavernState.advanceLodgingDayInData(clone);
    clone = lodging.tavern;

    if (this.#setting("dailyInventoryRefreshEnabled", true)) {
      this.#refreshStocks(clone);
      this.#refreshRoomOccupancy(clone);
    }

    if (this.#setting("dailyMenuRotationEnabled", true)) clone = this.#rotateMenu(clone);
    if (this.#setting("dailyAtmosphereRefreshEnabled", true)) clone = TavernAtmosphereService.advanceDay(clone);

    clone.refreshState ??= {};
    clone.refreshState.lastDayKey = dayKey;
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
        const max = Math.max(1, Number(entry.maxStock ?? entry.stock ?? 1));
        const low = key === "services" ? 0.45 : 0.7;
        const high = key === "services" ? 1.05 : 1.35;
        entry.stock = Math.max(0, Math.round(max * this.#float(low, high)));
        entry.maxStock = max;
      }
    }
  }

  static #refreshRoomOccupancy(tavern) {
    for (const room of tavern.inventory?.lodging ?? []) {
      if (room.unlimited) continue;
      const total = Math.max(0, Number(room.total ?? room.maxStock ?? room.stock ?? 0));
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
