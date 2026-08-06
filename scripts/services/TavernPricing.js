import { QUALITY_MODIFIERS, TERRAIN_MODIFIERS } from "../data/index.js";
import { TavernMigrations } from "./TavernMigrations.js";
import { CalendariaAdapter } from "./CalendariaAdapter.js";
import { MODULE_ID } from "../constants.js";

const REGION_CATEGORY_PRICE_MODIFIERS = {
  izuaver: {
    food: 2.35,
    room: 0.35,
    lodging: 0.35
  },
  flechenrand: {
    food: 1.25
  },
  dichtbeir: {
    food: 0.85,
    room: 0.8,
    lodging: 0.8
  }
};

const DEFAULT_SEASONAL_MULTIPLIERS = {
  inSeason: 0.8,
  outOfSeason: 1.35
};

export class TavernPricing {
  static registerSettings() {
    game.settings.register(MODULE_ID, "seasonalPricingEnabled", {
      name: "Сезонные цены в тавернах",
      hint: "Если включено и у блюда/напитка прописаны сезонные данные, цена меняется по текущему сезону Calendaria.",
      scope: "world",
      config: true,
      type: Boolean,
      default: true
    });
  }

  static normalizeMultiplier(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 1;
    return Math.min(5, Math.max(0.1, number));
  }

  static pricePair(min, max, quality, terrain, priceMultiplier, context = {}) {
    const raw = this.#int(min, max);
    const qualityPrice = QUALITY_MODIFIERS[quality]?.price ?? 1;
    const terrainPrice = TERRAIN_MODIFIERS[terrain]?.price ?? 1;
    const regionPrice = this.regionCategoryMultiplier(context.region, context.type);
    const basePrice = Math.max(1, Math.round(raw * qualityPrice * terrainPrice * regionPrice));
    const price = Math.max(1, Math.round(basePrice * this.normalizeMultiplier(priceMultiplier)));
    return { basePrice, price };
  }

  static effectiveEntryPrice(entry, tavern = null, context = {}) {
    const base = Math.max(1, Math.trunc(Number(entry?.price ?? entry?.basePrice ?? 1) || 1));
    const seasonal = this.seasonalMultiplier(entry, tavern, context);
    return Math.max(1, Math.round(base * seasonal));
  }

  static seasonalMultiplier(entry, _tavern = null, _context = {}) {
    if (!this.#setting("seasonalPricingEnabled", true)) return 1;
    const seasonal = entry?.seasonal ?? entry?.seasonality ?? null;
    if (!seasonal || typeof seasonal !== "object") return 1;

    const seasonKey = CalendariaAdapter.currentSeasonKey();
    const seasonLabel = CalendariaAdapter.currentSeason();
    if (!seasonKey && !seasonLabel) return 1;

    const inSeasonMultiplier = Number(seasonal.inSeason ?? seasonal.inSeasonMultiplier ?? DEFAULT_SEASONAL_MULTIPLIERS.inSeason);
    const outOfSeasonMultiplier = Number(seasonal.outOfSeason ?? seasonal.outOfSeasonMultiplier ?? DEFAULT_SEASONAL_MULTIPLIERS.outOfSeason);
    const seasons = this.#seasonList(seasonal.seasons ?? seasonal.inSeason ?? seasonal.inSeasonNames);
    const offSeasons = this.#seasonList(seasonal.offSeasons ?? seasonal.outSeasons ?? seasonal.expensiveSeasons);

    const currentCandidates = [seasonKey, seasonLabel].filter(Boolean).map((value) => String(value).toLocaleLowerCase("ru-RU"));

    if (seasons.length && seasons.some((season) => currentCandidates.includes(season))) {
      return Number.isFinite(inSeasonMultiplier) ? inSeasonMultiplier : DEFAULT_SEASONAL_MULTIPLIERS.inSeason;
    }

    if (offSeasons.length && offSeasons.some((season) => currentCandidates.includes(season))) {
      return Number.isFinite(outOfSeasonMultiplier) ? outOfSeasonMultiplier : DEFAULT_SEASONAL_MULTIPLIERS.outOfSeason;
    }

    if (seasons.length) return Number.isFinite(outOfSeasonMultiplier) ? outOfSeasonMultiplier : DEFAULT_SEASONAL_MULTIPLIERS.outOfSeason;
    return 1;
  }

  static regionCategoryMultiplier(region, type) {
    const table = REGION_CATEGORY_PRICE_MODIFIERS[region];
    if (!table) return 1;
    return table[type] ?? 1;
  }

  static applyMultiplier(tavern, multiplier) {
    const clone = TavernMigrations.migrate(tavern);
    if (!clone) return null;

    const normalized = this.normalizeMultiplier(multiplier);
    clone.priceMultiplier = normalized;

    for (const list of Object.values(clone.inventory ?? {})) {
      for (const entry of list ?? []) {
        const base = Math.max(1, Number(entry.basePrice ?? entry.price ?? 1));
        entry.basePrice = base;
        entry.price = Math.max(1, Math.round(base * normalized));
      }
    }

    return clone;
  }

  static #seasonList(value) {
    const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[;,]/) : [];
    return list
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
      .flatMap((item) => {
        const normalized = CalendariaAdapter.normalizeSeason(item);
        return [normalized.key, normalized.label].filter(Boolean).map((part) => String(part).toLocaleLowerCase("ru-RU"));
      });
  }

  static #setting(key, fallback) {
    try {
      return game.settings.get(MODULE_ID, key);
    } catch (_error) {
      return fallback;
    }
  }

  static #int(min, max) {
    const low = Math.trunc(Number(min) || 1);
    const high = Math.max(low, Math.trunc(Number(max) || low));
    return Math.floor(low + Math.random() * (high - low + 1));
  }
}
