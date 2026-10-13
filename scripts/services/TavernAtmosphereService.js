import {
  TAVERN_INCIDENT_TABLE,
  TAVERN_MOOD_TABLE,
  TAVERN_REGULAR_TABLE,
  TAVERN_RUMOR_TABLE
} from "../data/index.js";
import { TavernMigrations } from "./TavernMigrations.js";
import { TavernAvailabilityService } from "./TavernAvailabilityService.js";

const RUMOR_COUNTS = { tiny: 2, small: 3, medium: 4, large: 5 };
const REGULAR_COUNTS = { tiny: 1, small: 2, medium: 3, large: 4 };

export class TavernAtmosphereService {
  static ensure(tavern) {
    let clone = TavernMigrations.migrate(tavern);
    if (!clone) return null;
    clone.atmosphereSeed ||= foundry.utils.randomID(24);
    if (clone.atmosphere?.mood && Array.isArray(clone.atmosphere.rumors) && Array.isArray(clone.atmosphere.regulars)) {
      return clone;
    }

    // A scene/player copy may contain a frozen public availability snapshot but no
    // private atmosphere. Once the GM restores the tavern, that snapshot is stale.
    clone = TavernAvailabilityService.clearEmbeddedAvailability(clone);
    clone.atmosphere = this.#build(clone, { revision: Number(clone.atmosphere?.revision ?? 0) });
    return clone;
  }

  static regenerate(tavern) {
    const clone = this.ensure(tavern);
    if (!clone) return null;
    const revision = Number(clone.atmosphere?.revision ?? 0) + 1;
    clone.atmosphere = this.#build(clone, { revision });
    return clone;
  }

  static advanceDay(tavern) {
    const clone = this.ensure(tavern);
    if (!clone) return null;
    const previous = clone.atmosphere;
    const revision = Number(previous?.revision ?? 0) + 1;
    clone.atmosphere = this.#build(clone, {
      revision,
      preservedRumors: (previous?.rumors ?? []).filter((entry) => entry.pinned),
      preservedRegulars: (previous?.regulars ?? []).filter((entry) => entry.pinned)
    });
    return clone;
  }

  static rerollEntry(tavern, section, entryId = null) {
    const clone = this.ensure(tavern);
    if (!clone) return null;
    const revision = Number(clone.atmosphere?.revision ?? 0) + 1;
    clone.atmosphere.revision = revision;
    clone.atmosphere.updatedAt = Date.now();
    const random = this.#randomFor(clone, revision, `${section}:${entryId ?? "all"}`);

    if (section === "mood") {
      const mood = this.#pickOne(TAVERN_MOOD_TABLE, clone, random);
      clone.atmosphere.mood = this.#moodEntry(mood, random);
      clone.atmosphere.crowd = clone.atmosphere.mood.crowd;
      clone.atmosphere.crowdLabel = this.#crowdLabel(clone.atmosphere.crowd);
      TavernAvailabilityService.resetUsage(clone);
      return clone;
    }

    if (section === "incident") {
      clone.atmosphere.incident = this.#contentEntry(this.#pickOne(TAVERN_INCIDENT_TABLE, clone, random), "incident", random, { revealed: false });
      return clone;
    }

    const key = section === "regulars" ? "regulars" : "rumors";
    const table = key === "regulars" ? TAVERN_REGULAR_TABLE : TAVERN_RUMOR_TABLE;
    const list = clone.atmosphere[key] ?? [];
    const index = entryId ? list.findIndex((entry) => entry.id === entryId) : -1;
    const excluded = new Set(list.filter((_entry, itemIndex) => itemIndex !== index).map((entry) => entry.sourceKey));
    const picked = this.#pickOne(table, clone, random, excluded);
    if (!picked) return clone;
    const replacement = this.#contentEntry(picked, key === "regulars" ? "regular" : "rumor", random);
    if (index >= 0) list[index] = replacement;
    else list.push(replacement);
    clone.atmosphere[key] = list;
    return clone;
  }

  static togglePinned(tavern, section, entryId) {
    const clone = this.ensure(tavern);
    const list = clone?.atmosphere?.[section];
    const entry = Array.isArray(list) ? list.find((item) => item.id === entryId) : null;
    if (entry) entry.pinned = !entry.pinned;
    return clone;
  }

  static revealIncident(tavern, revealed = true) {
    const clone = this.ensure(tavern);
    if (clone?.atmosphere?.incident) clone.atmosphere.incident.revealed = Boolean(revealed);
    return clone;
  }

  static findEntry(tavern, section, entryId = null) {
    const atmosphere = this.ensure(tavern)?.atmosphere;
    if (!atmosphere) return null;
    if (section === "mood") return atmosphere.mood ?? null;
    if (section === "incident") return atmosphere.incident ?? null;
    return (atmosphere[section] ?? []).find((entry) => entry.id === entryId) ?? null;
  }

  static publicView(tavern) {
    let clone = TavernMigrations.migrate(tavern);
    if (!clone) return null;

    // Игрок получает только итоговую доступность позиций, рассчитанную по текущей
    // заполненности на стороне ГМа. Сама атмосфера и её числовые параметры скрыты.
    const appliedAt = Number(clone.atmosphere?.availabilityAppliedAt ?? clone.updatedAt ?? clone.atmosphere?.updatedAt ?? 0) || 0;
    const atmosphereRevision = Number(clone.atmosphere?.revision ?? 0) || 0;
    clone = TavernAvailabilityService.embedPublicAvailability(clone);
    clone.publicAvailability = { appliedAt, atmosphereRevision };
    delete clone.atmosphere;
    delete clone.atmosphereSeed;
    return clone;
  }

  static #build(tavern, { revision = 0, preservedRumors = [], preservedRegulars = [] } = {}) {
    const random = this.#randomFor(tavern, revision, "build");
    const moodSource = this.#pickOne(TAVERN_MOOD_TABLE, tavern, random);
    const mood = this.#moodEntry(moodSource, random);
    const rumorCount = RUMOR_COUNTS[tavern.size] ?? RUMOR_COUNTS.medium;
    const regularCount = REGULAR_COUNTS[tavern.size] ?? REGULAR_COUNTS.medium;
    const rumors = this.#fillEntries(tavern, TAVERN_RUMOR_TABLE, preservedRumors, rumorCount, "rumor", random);
    const regulars = this.#fillEntries(tavern, TAVERN_REGULAR_TABLE, preservedRegulars, regularCount, "regular", random);
    const incidentSource = this.#pickOne(TAVERN_INCIDENT_TABLE, tavern, random);

    return {
      revision,
      updatedAt: Date.now(),
      mood,
      crowd: mood.crowd,
      crowdLabel: this.#crowdLabel(mood.crowd),
      rumors,
      regulars,
      incident: this.#contentEntry(incidentSource, "incident", random, { revealed: false }),
      availabilityUsage: {}
    };
  }

  static #fillEntries(tavern, table, preserved, target, kind, random) {
    const output = (preserved ?? []).slice(0, target).map((entry) => foundry.utils.deepClone(entry));
    const excluded = new Set(output.map((entry) => entry.sourceKey));

    while (output.length < target) {
      const source = this.#pickOne(table, tavern, random, excluded);
      if (!source) break;
      const entry = this.#contentEntry(source, kind, random);
      output.push(entry);
      excluded.add(entry.sourceKey);
    }
    return output;
  }

  static #moodEntry(source, random) {
    const crowdRange = source?.crowd ?? [30, 60];
    const crowd = this.#integer(random, crowdRange[0], crowdRange[1]);
    return {
      id: source?.id ?? "steady",
      label: source?.label ?? "Обычный вечер",
      text: source?.text ?? "В таверне идёт обычная вечерняя жизнь.",
      crowd
    };
  }

  static #contentEntry(source, kind, random, extra = {}) {
    if (!source) return null;
    const sourceKey = `${kind}:${source.title ?? source.name ?? source.id ?? "entry"}`;
    return {
      id: this.#stableId(kind, random),
      sourceKey,
      title: source.title ?? source.name ?? "Без названия",
      text: source.text ?? source.description ?? "",
      description: source.description ?? source.text ?? "",
      gmText: source.gmText ?? source.gmTruth ?? source.secret ?? "",
      goal: source.goal ?? "",
      truth: source.truth ?? null,
      severity: Number(source.severity ?? 0),
      tags: [...(source.tags ?? [])],
      pinned: false,
      roll: Math.floor(random() * 1000000),
      ...extra
    };
  }

  static #stableId(kind, random) {
    const value = Math.floor(random() * 0xffffffff).toString(36).padStart(7, "0");
    return `${kind}-${value}`;
  }

  static #pickOne(table, tavern, random, excluded = new Set()) {
    const matching = table.filter((item) => !excluded.has(`${this.#kindForTable(table)}:${item.title ?? item.name ?? item.id ?? "entry"}`) && this.#matches(item, tavern));
    const fallback = matching.length
      ? matching
      : table.filter((item) => {
        const key = `${this.#kindForTable(table)}:${item.title ?? item.name ?? item.id ?? "entry"}`;
        return !excluded.has(key) && this.#matches(item, { ...tavern, region: "common", terrain: null });
      });
    if (!fallback.length) return null;

    const total = fallback.reduce((sum, item) => sum + Math.max(0.01, Number(item.weight ?? 1)), 0);
    let roll = random() * total;
    for (const item of fallback) {
      roll -= Math.max(0.01, Number(item.weight ?? 1));
      if (roll <= 0) return item;
    }
    return fallback.at(-1);
  }

  static #kindForTable(table) {
    if (table === TAVERN_RUMOR_TABLE) return "rumor";
    if (table === TAVERN_REGULAR_TABLE) return "regular";
    if (table === TAVERN_INCIDENT_TABLE) return "incident";
    return "mood";
  }

  static #matches(item, tavern) {
    const regionOk = !item.regions?.length || item.regions.includes(tavern.region);
    const terrainOk = !item.terrains?.length || !tavern.terrain || item.terrains.includes(tavern.terrain);
    return regionOk && terrainOk;
  }

  static #crowdLabel(value) {
    if (value < 25) return "почти пусто";
    if (value < 50) return "есть свободные столы";
    if (value < 75) return "людно";
    if (value < 90) return "тесно";
    return "переполнено";
  }

  static #integer(random, min, max) {
    const low = Math.trunc(Number(min) || 0);
    const high = Math.max(low, Math.trunc(Number(max) || low));
    return Math.floor(low + random() * (high - low + 1));
  }

  static #randomFor(tavern, revision, salt) {
    const seed = this.#hash(`${tavern.atmosphereSeed}:${tavern.id ?? tavern.name ?? "tavern"}:${revision}:${salt}`);
    let state = seed >>> 0;
    return () => {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  static #hash(value) {
    let hash = 2166136261;
    for (const char of String(value)) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }
}
