import { TAVERN_OPTIONS } from "../data/index.js";
import { TAVERN_SCHEMA_VERSION } from "./TavernMigrations.js";
import { MoneyFormatter } from "./MoneyFormatter.js";
import { TavernPricing } from "./TavernPricing.js";
import { TavernNames } from "./TavernNames.js";
import { TavernInventory } from "./TavernInventory.js";
import { TavernViewModel } from "./TavernViewModel.js";
import { TavernEditor } from "./TavernEditor.js";
import { TavernAtmosphereService } from "./TavernAtmosphereService.js";

export class TavernGenerator {
  static generate(params = {}) {
    const region = params.region ?? "common";
    const quality = params.quality ?? "modest";
    const size = params.size ?? "medium";
    const terrain = params.terrain ?? "road";
    const priceMultiplier = TavernPricing.normalizeMultiplier(params.priceMultiplier ?? 1);
    const inventory = TavernInventory.generate({ region, quality, size, terrain, priceMultiplier });

    const tavern = {
      schemaVersion: TAVERN_SCHEMA_VERSION,
      id: foundry.utils.randomID(16),
      name: TavernNames.generate(region, terrain),
      region,
      quality,
      size,
      terrain,
      priceMultiplier,
      labels: {
        region: TAVERN_OPTIONS.regions[region] ?? region,
        quality: TAVERN_OPTIONS.qualities[quality] ?? quality,
        size: TAVERN_OPTIONS.sizes[size] ?? size,
        terrain: TAVERN_OPTIONS.terrains[terrain] ?? terrain
      },
      generatedAt: Date.now(),
      inventory,
      publicSummary: "Доступные позиции указаны ниже."
    };

    const livingTavern = TavernAtmosphereService.ensure(tavern);
    livingTavern.summary = TavernViewModel.summary(livingTavern);
    return livingTavern;
  }

  static decoratePrices(tavern) {
    return TavernViewModel.decorate(tavern);
  }

  static applyPriceMultiplier(tavern, multiplier) {
    const clone = TavernPricing.applyMultiplier(tavern, multiplier);
    if (!clone) return null;
    clone.summary = TavernViewModel.summary(clone);
    return clone;
  }

  static removeEntry(tavern, category, entryId) {
    return TavernEditor.removeEntry(tavern, category, entryId);
  }

  static addRandomEntry(tavern, category) {
    return TavernEditor.addRandomEntry(tavern, category);
  }

  static updateLodgingEntry(tavern, entryId, patch) {
    return TavernEditor.updateLodgingEntry(tavern, entryId, patch);
  }

  static upsertEntry(tavern, category, entryId, patch) {
    return TavernEditor.upsertEntry(tavern, category, entryId, patch);
  }

  static togglePinned(tavern, category, entryId) {
    return TavernEditor.togglePinned(tavern, category, entryId);
  }

  static restockAll(tavern) {
    return TavernEditor.restockAll(tavern);
  }

  static formatPrice(value) {
    return MoneyFormatter.format(value);
  }

  static formatPriceHtml(value) {
    return MoneyFormatter.formatHtml(value);
  }

  static formatPriceParts(value) {
    return MoneyFormatter.partsFromCopper(value);
  }

  static formatCoinParts(coins = {}) {
    return MoneyFormatter.partsFromCoins(coins);
  }
}
