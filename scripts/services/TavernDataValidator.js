import { MODULE_ID } from "../constants.js";
import {
  COMMON_DRINK_TABLE,
  COMMON_FOOD_TABLE,
  DRINK_TABLE,
  FOOD_TABLE,
  NAME_TABLE,
  REGIONAL_DRINK_TABLE,
  REGIONAL_FOOD_TABLE,
  ROOM_TABLE,
  SERVICE_TABLE,
  TAVERN_INCIDENT_TABLE,
  TAVERN_MOOD_TABLE,
  TAVERN_REGULAR_TABLE,
  TAVERN_RUMOR_TABLE,
  TAVERN_OPTIONS
} from "../data/index.js";

const NO_BEER_REGIONS = new Set(["novandia", "sangren"]);
const VALID_CLEANLINESS_STATES = new Set(["Помытый", "Хорошенько помытый", "Я в раю"]);

export class TavernDataValidator {
  static validate({ log = true } = {}) {
    const report = { errors: [], warnings: [] };

    this.#validateNames(report);
    this.#validateEntries(report, COMMON_FOOD_TABLE, { expectedType: "food", tableName: "COMMON_FOOD_TABLE", requireRegions: false });
    this.#validateEntries(report, REGIONAL_FOOD_TABLE, { expectedType: "food", tableName: "REGIONAL_FOOD_TABLE", requireRegions: true });
    this.#validateEntries(report, COMMON_DRINK_TABLE, { expectedType: "drink", tableName: "COMMON_DRINK_TABLE", requireRegions: false });
    this.#validateEntries(report, REGIONAL_DRINK_TABLE, { expectedType: "drink", tableName: "REGIONAL_DRINK_TABLE", requireRegions: true });
    this.#validateEntries(report, SERVICE_TABLE, { expectedType: "service", tableName: "SERVICE_TABLE", requireRegions: false });
    this.#validateRooms(report);
    this.#validateDuplicateNames(report, FOOD_TABLE, "FOOD_TABLE");
    this.#validateDuplicateNames(report, DRINK_TABLE, "DRINK_TABLE");
    this.#validateDuplicateNames(report, SERVICE_TABLE, "SERVICE_TABLE");
    this.#validateDuplicateNames(report, ROOM_TABLE, "ROOM_TABLE");
    this.#validateNoBeerRegions(report);
    this.#validateCleanliness(report);
    this.#validateMoodTable(report);
    this.#validateLifeTable(report, TAVERN_RUMOR_TABLE, "TAVERN_RUMOR_TABLE", { titleField: "title", textFields: ["text", "gmTruth"] });
    this.#validateLifeTable(report, TAVERN_REGULAR_TABLE, "TAVERN_REGULAR_TABLE", { titleField: "name", textFields: ["description", "goal", "secret"] });
    this.#validateLifeTable(report, TAVERN_INCIDENT_TABLE, "TAVERN_INCIDENT_TABLE", { titleField: "title", textFields: ["text", "gmText"] });

    if (log) this.#log(report);
    return report;
  }

  static #validateNames(report) {
    const regionKeys = Object.keys(TAVERN_OPTIONS.regions ?? {});
    for (const region of regionKeys) {
      const table = NAME_TABLE[region];
      if (!table) {
        report.warnings.push(`NAME_TABLE: нет таблицы названий для региона '${region}'.`);
        continue;
      }
      if (!Array.isArray(table.patterns) || !table.patterns.length) report.errors.push(`NAME_TABLE.${region}: нет patterns.`);
      if (!Array.isArray(table.nouns) || !table.nouns.length) report.errors.push(`NAME_TABLE.${region}: нет nouns.`);
      if (!Array.isArray(table.adjectives) || !table.adjectives.length) report.errors.push(`NAME_TABLE.${region}: нет adjectives.`);
      if (table.fixedNames != null && !Array.isArray(table.fixedNames)) report.errors.push(`NAME_TABLE.${region}: fixedNames должен быть массивом.`);
      if (Array.isArray(table.fixedNames)) {
        for (const name of table.fixedNames) {
          if (!String(name ?? "").trim()) report.errors.push(`NAME_TABLE.${region}: пустое значение fixedNames.`);
        }
      }
    }
  }

  static #validateEntries(report, table, { expectedType, tableName, requireRegions }) {
    if (!Array.isArray(table)) {
      report.errors.push(`${tableName}: таблица не является массивом.`);
      return;
    }

    table.forEach((item, index) => {
      const label = `${tableName}[${index}] ${item?.name ?? "<без имени>"}`;
      if (!item || typeof item !== "object") return report.errors.push(`${label}: запись не является объектом.`);
      if (!String(item.name ?? "").trim()) report.errors.push(`${label}: нет name.`);
      if (item.type !== expectedType) report.errors.push(`${label}: type '${item.type}' вместо '${expectedType}'.`);
      if (!String(item.desc ?? "").trim()) report.warnings.push(`${label}: нет desc.`);
      this.#validatePriceRange(report, label, item);
      this.#validateReferenceList(report, label, item.terrains, TAVERN_OPTIONS.terrains, "terrains");
      this.#validateReferenceList(report, label, item.quality, TAVERN_OPTIONS.qualities, "quality");
      this.#validateReferenceList(report, label, item.excludeRegions, TAVERN_OPTIONS.regions, "excludeRegions");

      if (requireRegions && (!Array.isArray(item.regions) || !item.regions.length)) report.errors.push(`${label}: у региональной записи нет regions.`);
      this.#validateReferenceList(report, label, item.regions, TAVERN_OPTIONS.regions, "regions");

      const weight = Number(item.weight ?? 1);
      if (!Number.isFinite(weight) || weight <= 0) report.errors.push(`${label}: некорректный weight.`);
    });
  }

  static #validateRooms(report) {
    ROOM_TABLE.forEach((room, index) => {
      const label = `ROOM_TABLE[${index}] ${room?.name ?? "<без имени>"}`;
      if (!room || typeof room !== "object") {
        report.errors.push(`${label}: запись не является объектом.`);
        return;
      }
      if (!String(room.name ?? "").trim()) report.errors.push(`${label}: нет name.`);
      if (!String(room.desc ?? "").trim()) report.warnings.push(`${label}: нет desc.`);
      this.#validatePriceRange(report, label, room);
      this.#validateReferenceList(report, label, room.quality, TAVERN_OPTIONS.qualities, "quality");
      this.#validateReferenceList(report, label, room.regions, TAVERN_OPTIONS.regions, "regions");
      this.#validateReferenceList(report, label, room.excludeRegions, TAVERN_OPTIONS.regions, "excludeRegions");
      this.#validateReferenceList(report, label, room.terrains, TAVERN_OPTIONS.terrains, "terrains");
      this.#validateWeight(report, label, room);

      if (!room.unlimited) {
        const totalMin = Number(room.totalMin);
        const totalMax = Number(room.totalMax);
        if (!Number.isFinite(totalMin) || !Number.isFinite(totalMax) || totalMin < 0 || totalMax < totalMin) {
          report.errors.push(`${label}: некорректный диапазон totalMin/totalMax.`);
        }
      }
    });
  }

  static #validateDuplicateNames(report, table, tableName) {
    const seen = new Map();

    for (const item of table) {
      if (!item || typeof item !== "object") continue;
      // Reference-list validation reports malformed values; this pass must not throw on them.
      const regions = Array.isArray(item.regions) && item.regions.length && !item.regions.includes("common")
        ? item.regions
        : Object.keys(TAVERN_OPTIONS.regions);
      for (const region of regions) {
        if (Array.isArray(item.excludeRegions) && item.excludeRegions.includes(region)) continue;
        const key = `${item.type}|${region}|${this.#normalize(item.name)}`;
        const previous = seen.get(key);
        if (previous) {
          report.warnings.push(`${tableName}: дубль '${item.name}' для региона '${region}' (${previous.name} / ${item.name}).`);
        } else {
          seen.set(key, item);
        }
      }
    }
  }

  static #validateNoBeerRegions(report) {
    for (const item of DRINK_TABLE) {
      if (!this.#isBeer(item)) continue;
      const regions = Array.isArray(item.regions) && item.regions.length ? item.regions : Object.keys(TAVERN_OPTIONS.regions ?? {});
      for (const region of regions) {
        if (NO_BEER_REGIONS.has(region) && !item.excludeRegions?.includes(region)) {
          report.errors.push(`DRINK_TABLE: пиво доступно в запрещенном регионе '${region}': ${item.name}.`);
        }
      }
    }
  }

  static #validateCleanliness(report) {
    for (const item of SERVICE_TABLE) {
      if (!item || typeof item !== "object") continue;
      if (!item.cleanliness) continue;
      const level = Number(item.cleanliness.level);
      const state = item.cleanliness.state;
      if (!Number.isInteger(level) || level < 1 || level > 3) report.errors.push(`SERVICE_TABLE.${item.name}: cleanliness.level должен быть 1-3.`);
      if (!VALID_CLEANLINESS_STATES.has(state)) report.errors.push(`SERVICE_TABLE.${item.name}: неизвестное состояние помытости '${state}'.`);
    }
  }

  static #validateMoodTable(report) {
    const seen = new Set();
    for (const [index, item] of TAVERN_MOOD_TABLE.entries()) {
      const label = `TAVERN_MOOD_TABLE[${index}] ${item?.label ?? "<без названия>"}`;
      if (!item || typeof item !== "object") {
        report.errors.push(`${label}: запись не является объектом.`);
        continue;
      }
      if (!String(item?.id ?? "").trim()) report.errors.push(`${label}: нет id.`);
      if (!String(item?.label ?? "").trim()) report.errors.push(`${label}: нет label.`);
      if (!String(item?.text ?? "").trim()) report.errors.push(`${label}: нет text.`);
      if (seen.has(item.id)) report.errors.push(`${label}: дублирующий id '${item.id}'.`);
      seen.add(item.id);
      const crowd = item?.crowd;
      if (!Array.isArray(crowd) || crowd.length !== 2 || !crowd.every(Number.isFinite) || crowd[0] < 0 || crowd[1] > 100 || crowd[1] < crowd[0]) {
        report.errors.push(`${label}: crowd должен быть диапазоном 0-100.`);
      }
      this.#validateWeight(report, label, item);
    }
  }

  static #validateLifeTable(report, table, tableName, { titleField, textFields }) {
    const seen = new Set();
    for (const [index, item] of table.entries()) {
      if (!item || typeof item !== "object") {
        report.errors.push(`${tableName}[${index}]: запись не является объектом.`);
        continue;
      }
      const title = String(item?.[titleField] ?? "").trim();
      const label = `${tableName}[${index}] ${title || "<без названия>"}`;
      if (!title) report.errors.push(`${label}: нет ${titleField}.`);
      const normalized = this.#normalize(title);
      if (normalized && seen.has(normalized)) report.warnings.push(`${tableName}: повтор названия '${title}'.`);
      seen.add(normalized);
      for (const field of textFields) {
        if (!String(item?.[field] ?? "").trim()) report.warnings.push(`${label}: нет ${field}.`);
      }
      this.#validateReferenceList(report, label, item?.regions, TAVERN_OPTIONS.regions, "regions");
      this.#validateReferenceList(report, label, item?.terrains, TAVERN_OPTIONS.terrains, "terrains");
      this.#validateWeight(report, label, item);
    }
  }

  static #validateWeight(report, label, item) {
    const weight = Number(item?.weight ?? 1);
    if (!Number.isFinite(weight) || weight <= 0) report.errors.push(`${label}: некорректный weight.`);
  }

  static #validatePriceRange(report, label, item) {
    const min = Number(item.min);
    const max = Number(item.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) {
      report.errors.push(`${label}: некорректный диапазон цены min/max.`);
    }
  }

  static #validateReferenceList(report, label, value, dictionary, fieldName) {
    if (value == null) return;
    if (!Array.isArray(value)) return report.errors.push(`${label}: ${fieldName} должен быть массивом.`);

    for (const key of value) {
      if (!Object.hasOwn(dictionary ?? {}, key)) report.errors.push(`${label}: неизвестный ключ ${fieldName}: '${key}'.`);
    }
  }

  static #isBeer(item) {
    const text = `${item.name ?? ""} ${item.desc ?? ""}`.toLocaleLowerCase("ru-RU");
    return text.includes("пиво") || text.includes("пивн");
  }

  static #normalize(value) {
    return String(value ?? "").trim().toLocaleLowerCase("ru-RU");
  }

  static #log(report) {
    if (!report.errors.length && !report.warnings.length) {
      console.log(`${MODULE_ID} | Tavern data validation passed.`);
      return;
    }

    const method = report.errors.length ? "error" : "warn";
    console[method](`${MODULE_ID} | Tavern data validation: ${report.errors.length} errors, ${report.warnings.length} warnings.`, report);
  }
}
