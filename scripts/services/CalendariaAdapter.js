import { MODULE_ID } from "../constants.js";

const SEASON_KEYWORDS = {
  zarost: ["зарость", "тепло", "зной", "spring", "summer"],
  uhudno: ["ухудно", "дожд", "хлад", "autumn", "winter", "fall"]
};

export class CalendariaAdapter {
  static isAvailable() {
    return Boolean(game.modules?.get("calendaria")?.active || globalThis.CALENDARIA || globalThis.Calendaria || game.calendaria);
  }

  static currentDateInfo(source = null) {
    const payloadInfo = this.#dateInfoFromPayload(source);
    if (payloadInfo) return payloadInfo;

    const apiInfo = this.#dateInfoFromApi();
    if (apiInfo) return apiInfo;

    const worldDay = Math.floor(Number(game.time?.worldTime ?? 0) / 86400);
    return {
      key: `world:${worldDay}`,
      ordinal: worldDay,
      clockId: "world",
      day: worldDay,
      month: null,
      year: null,
      season: null,
      seasonKey: null,
      source: "worldTime"
    };
  }

  static currentDayKey(source = null) {
    return this.currentDateInfo(source).key;
  }

  static currentSeason(source = null) {
    return this.currentDateInfo(source).season;
  }

  static currentSeasonKey(source = null) {
    return this.currentDateInfo(source).seasonKey;
  }

  static registerDayHooks(callback) {
    const hookNames = [
      "calendaria.dayChanged",
      "calendaria.dayChange",
      "calendaria.newDay",
      "calendaria.dateChanged",
      "calendaria.timeChanged",
      "calendaria.calendarChanged",
      "Calendaria.DayChanged",
      "Calendaria.DateChanged"
    ];

    for (const hookName of hookNames) {
      Hooks.on(hookName, (...args) => callback({ hookName, args }));
    }
  }

  static normalizeSeason(value) {
    const text = String(value ?? "").trim();
    if (!text) return { label: null, key: null };
    const lower = text.toLocaleLowerCase("ru-RU");

    for (const [key, words] of Object.entries(SEASON_KEYWORDS)) {
      if (words.some((word) => lower.includes(word))) return { label: text, key };
    }

    return { label: text, key: lower };
  }

  static #dateInfoFromPayload(source) {
    const args = Array.isArray(source?.args) ? source.args : Array.isArray(source) ? source : [source].filter(Boolean);
    for (const arg of args) {
      if (arg?.current) {
        const calendar = arg.calendar ?? globalThis.CALENDARIA?.managers?.CalendarManager?.getActiveCalendar?.();
        const info = this.#calendariaInfo(arg.current, calendar, { components: true });
        if (info) {
          info.previousOrdinal = this.#calendariaInfo(arg.previous, calendar, { components: true })?.ordinal ?? null;
          return info;
        }
      }
      const info = this.#dateInfoFromObject(arg, "hook");
      if (info) return info;
    }
    return null;
  }

  static #dateInfoFromApi() {
    try {
      const api = globalThis.CALENDARIA?.api;
      const date = api?.getCurrentDateTime?.();
      const calendar = globalThis.CALENDARIA?.managers?.CalendarManager?.getActiveCalendar?.();
      const info = this.#calendariaInfo(date, calendar);
      if (info) return info;
    } catch (error) {
      console.debug(`${MODULE_ID} | Calendaria API probe failed`, error);
    }
    const candidates = [
      () => game.calendaria?.api?.getCurrentDate?.(),
      () => game.calendaria?.api?.currentDate?.(),
      () => game.calendaria?.getCurrentDate?.(),
      () => game.calendaria?.calendar?.currentDate,
      () => globalThis.Calendaria?.api?.getCurrentDate?.(),
      () => globalThis.Calendaria?.getCurrentDate?.()
    ];

    for (const candidate of candidates) {
      try {
        const value = candidate();
        const info = this.#dateInfoFromObject(value, "calendaria");
        if (info) return info;
      } catch (error) {
        console.debug(`${MODULE_ID} | Calendaria date probe failed`, error);
      }
    }

    return null;
  }

  static #dateInfoFromObject(value, source) {
    if (!value || typeof value !== "object") return null;

    const day = this.#firstNumber(value, ["day", "date", "dayOfMonth", "dayNumber", "currentDay"]);
    const month = this.#firstNumber(value, ["month", "monthIndex", "monthNumber", "currentMonth"]);
    const year = this.#firstNumber(value, ["year", "currentYear"]);
    const seasonRaw = this.#firstString(value, ["season", "seasonName", "currentSeason", "seasonLabel"])
      ?? this.#firstString(value?.date, ["season", "seasonName"])
      ?? this.#firstString(value?.calendar, ["season", "seasonName"]);
    const season = this.normalizeSeason(seasonRaw);

    const explicitKey = this.#firstString(value, ["dateKey", "key"]);
    const timestamp = this.#firstNumber(value, ["timestamp", "time", "worldTime"]);
    const key = explicitKey
      ?? (year !== null || month !== null || day !== null ? `${source}:${year ?? "?"}-${month ?? "?"}-${day ?? "?"}` : null)
      ?? (timestamp !== null ? `${source}:t${Math.floor(timestamp / 86400)}` : null);

    if (!key && !season.label) return null;

    return {
      key: key ?? `${source}:season:${season.label}`,
      ordinal: Math.floor(Number(game.time?.worldTime ?? 0) / 86400),
      clockId: "world",
      day,
      month,
      year,
      season: season.label,
      seasonKey: season.key,
      source
    };
  }

  static #firstNumber(object, keys) {
    for (const key of keys) {
      const value = object?.[key];
      if (value == null || value === "" || typeof value === "object") continue;
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
    return null;
  }

  static #calendariaInfo(value, calendar, { components = false } = {}) {
    if (!value || value.year == null || value.month == null || (components ? value.dayOfMonth : value.day) == null || !Number.isFinite(Number(value.year))) return null;
    const year = Number(value.year);
    const month = Number(value.month) + (components ? 1 : 0);
    const day = components ? Number(value.dayOfMonth) + 1 : Number(value.day);
    if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
    const daySeconds = Math.max(1, Number(calendar?.days?.hoursPerDay ?? 24)
      * Number(calendar?.days?.minutesPerHour ?? 60) * Number(calendar?.days?.secondsPerMinute ?? 60));
    let time = Number(game.time?.worldTime ?? 0);
    if (calendar?.componentsToTime) {
      time = calendar.componentsToTime({ year: year - Number(calendar.years?.yearZero ?? 0), month: month - 1, dayOfMonth: day - 1, hour: 0, minute: 0, second: 0 });
    }
    const seasonValue = (components ? calendar?.seasonsArray?.[value.season] : null)
      ?? globalThis.CALENDARIA?.api?.getCurrentSeason?.() ?? value.season;
    const season = this.normalizeSeason(typeof seasonValue === "object" ? seasonValue?.name ?? seasonValue?.label : typeof seasonValue === "string" ? seasonValue : null);
    const clockId = `calendaria:${calendar?.id ?? calendar?._id ?? "active"}`;
    return { key: `${clockId}:${year}-${month}-${day}`, ordinal: Math.floor(time / daySeconds), clockId,
      day, month, year, season: season.label, seasonKey: season.key, source: "calendaria" };
  }

  static #firstString(object, keys) {
    for (const key of keys) {
      const value = object?.[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (value && typeof value === "object") {
        const nested = value.name ?? value.label ?? value.title;
        if (typeof nested === "string" && nested.trim()) return nested.trim();
      }
    }
    return null;
  }
}
