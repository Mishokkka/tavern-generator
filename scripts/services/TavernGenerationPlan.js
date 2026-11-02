import { QUALITY_MODIFIERS, SIZE_MODIFIERS, TERRAIN_MODIFIERS } from "../data/index.js";
import { TavernPricing } from "./TavernPricing.js";

/** Explain the actual generation rules without rolling or modifying a tavern. */
export class TavernGenerationPlan {
  static describe(params = {}) {
    const quality = QUALITY_MODIFIERS[params.quality] ?? QUALITY_MODIFIERS.modest;
    const size = SIZE_MODIFIERS[params.size] ?? SIZE_MODIFIERS.medium;
    const terrain = TERRAIN_MODIFIERS[params.terrain] ?? TERRAIN_MODIFIERS.road;
    const target = Math.max(4, size.menu + quality.menu);
    const food = Math.max(2, Math.round(target * 0.68));
    const multiplier = TavernPricing.normalizeMultiplier(params.priceMultiplier ?? 1);
    const waterMultiplier = TavernPricing.resourceMultiplier(params.region, { kind: "water" });
    const percent = Math.round(multiplier * 100);
    const factor = (value) => Number(value.toFixed(2)).toLocaleString("ru-RU");
    return {
      menu: `До ${food} блюд и ${Math.max(1, target - food)} напитков`,
      lodging: `До ${Math.max(1, size.rooms + quality.rooms)} вариантов ночлега`,
      services: `Бытовая основа и до ${{ tiny: 1, small: 2, medium: 3, large: 4 }[params.size] ?? 3} дополнительных услуг`
        + (["road", "port", "mountain", "wilderness"].includes(params.terrain ?? "road") ? " · пайки и вода в дорогу" : ""),
      prices: `Качество ×${factor(quality.price)} · местность ×${factor(terrain.price)} · наценка ×${factor(multiplier)}`
        + (waterMultiplier > 1 ? ` · шаг воды в дорогу ×${factor(waterMultiplier)}` : ""),
      markup: percent === 100 ? "100% — без дополнительной наценки." : `${percent}% — цены ×${factor(multiplier)} после поправок качества и местности.`,
      stock: "Размер и качество задают объём запасов; местность — начальную занятость ночлега."
    };
  }
}
