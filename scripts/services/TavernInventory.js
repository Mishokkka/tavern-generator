import {
  DRINK_TABLE,
  FOOD_TABLE,
  QUALITY_MODIFIERS,
  ROOM_TABLE,
  SERVICE_TABLE,
  SIZE_MODIFIERS,
  TERRAIN_MODIFIERS
} from "../data/index.js";
import { TavernMigrations } from "./TavernMigrations.js";
import { TavernPricing } from "./TavernPricing.js";

const NO_BEER_REGIONS = new Set(["novandia", "sangren"]);
const IMPORT_MARKET_REGION = "izuaver";

export class TavernInventory {
  static generate({ region, quality, size, terrain, priceMultiplier }) {
    const { food, drinks } = this.#generateMenu({ region, quality, size, terrain, priceMultiplier });

    return {
      food,
      drinks,
      lodging: this.#generateRooms({ region, quality, size, terrain, priceMultiplier }),
      services: this.#generateServices({ region, quality, size, terrain, priceMultiplier })
    };
  }

  static addRandomEntry(tavern, category) {
    const clone = TavernMigrations.migrate(tavern);
    if (!clone) return null;

    const params = {
      region: clone.region ?? "common",
      quality: clone.quality ?? "modest",
      size: clone.size ?? "medium",
      terrain: clone.terrain ?? "road",
      priceMultiplier: clone.priceMultiplier ?? 1
    };

    const key = TavernMigrations.categoryToInventoryKey(category);
    let entry = null;

    if (key === "food") entry = this.#generateMenuItem({ ...params, type: "food", existing: clone.inventory.food ?? [] });
    else if (key === "drinks") entry = this.#generateMenuItem({ ...params, type: "drink", existing: clone.inventory.drinks ?? [] });
    else if (key === "services") entry = this.#generateServiceItem({ ...params, existing: clone.inventory.services ?? [] });
    else if (key === "lodging") entry = this.#generateRoomItem({ ...params, existing: clone.inventory.lodging ?? [] });

    if (!entry || !key) return clone;
    clone.inventory[key] = [...(clone.inventory[key] ?? []), entry];
    return clone;
  }

  static #generateMenu({ region, quality, size, terrain, priceMultiplier }) {
    const qualityMod = QUALITY_MODIFIERS[quality] ?? QUALITY_MODIFIERS.modest;
    const sizeMod = SIZE_MODIFIERS[size] ?? SIZE_MODIFIERS.medium;
    const target = Math.max(4, sizeMod.menu + qualityMod.menu);
    const foodTarget = Math.max(2, Math.round(target * 0.68));
    const drinkTarget = Math.max(1, target - foodTarget);

    const food = this.#generateMenuItems({ region, quality, size, terrain, priceMultiplier, type: "food", target: foodTarget, existing: [] });
    const drinks = this.#generateMenuItems({ region, quality, size, terrain, priceMultiplier, type: "drink", target: drinkTarget, existing: [] });

    return {
      food: food.sort((a, b) => Number(b.local) - Number(a.local) || a.price - b.price || a.name.localeCompare(b.name, "ru")),
      drinks: drinks.sort((a, b) => Number(b.local) - Number(a.local) || a.price - b.price || a.name.localeCompare(b.name, "ru"))
    };
  }

  static #generateMenuItems({ region, quality, size, terrain, priceMultiplier, type, target, existing }) {
    const table = type === "food" ? FOOD_TABLE : DRINK_TABLE;
    const sizeMod = SIZE_MODIFIERS[size] ?? SIZE_MODIFIERS.medium;
    const terrainMod = TERRAIN_MODIFIERS[terrain] ?? TERRAIN_MODIFIERS.road;
    const existingNames = new Set((existing ?? []).map((entry) => entry.name));

    if (region === IMPORT_MARKET_REGION) {
      return this.#generateImportedMenuItems({ table, type, region, quality, terrain, priceMultiplier, target, existingNames, sizeMod });
    }

    const localCandidates = table.filter((item) => item.local && !existingNames.has(item.name) && this.#matches(item, { region, quality, terrain }));
    const commonCandidates = table.filter((item) => !item.local && !existingNames.has(item.name) && this.#matches(item, { region, quality, terrain }));

    let localCount = 0;
    const localChance = type === "food" ? terrainMod.localChance ?? 0.6 : Math.max(0.25, (terrainMod.localChance ?? 0.6) - 0.15);
    if (localCandidates.length && Math.random() < localChance) {
      const maxLocal = Math.min(sizeMod.localMax ?? 3, localCandidates.length, Math.max(1, target - 1));
      localCount = this.#int(1, maxLocal);
    }

    const pickedLocal = this.#weightedUnique(localCandidates, localCount);
    for (const item of pickedLocal) existingNames.add(item.name);

    const pickedCommon = this.#weightedUnique(commonCandidates.filter((item) => !existingNames.has(item.name)), target - pickedLocal.length);
    const picked = [...pickedLocal, ...pickedCommon];

    if (picked.length < target) {
      const fallback = table.filter((item) => !picked.some((chosen) => chosen.name === item.name) && !existingNames.has(item.name) && this.#matches(item, { region, quality, terrain }));
      picked.push(...this.#weightedUnique(fallback, target - picked.length));
    }

    return picked.map((item) => this.#pricedEntry(item, { region, quality, terrain, priceMultiplier, stockBase: this.#int(1, sizeMod.mealStock) }));
  }

  static #generateImportedMenuItems({ table, type, region, quality, terrain, priceMultiplier, target, existingNames, sizeMod }) {
    const strictCandidates = this.#uniqueByName(table.filter((item) => !existingNames.has(item.name) && this.#matchesImportedEntry(item, { type, region, quality, terrain, ignoreTerrain: false })));
    const picked = this.#weightedUnique(strictCandidates, target);

    if (picked.length < target) {
      const fallback = this.#uniqueByName(table.filter((item) => !picked.some((chosen) => chosen.name === item.name) && !existingNames.has(item.name) && this.#matchesImportedEntry(item, { type, region, quality, terrain, ignoreTerrain: true })));
      picked.push(...this.#weightedUnique(fallback, target - picked.length));
    }

    return picked.map((item) => this.#pricedEntry({ ...item, local: false }, { region, quality, terrain, priceMultiplier, stockBase: this.#int(1, sizeMod.mealStock) }));
  }

  static #generateMenuItem({ region, quality, size, terrain, priceMultiplier, type, existing }) {
    return this.#generateMenuItems({ region, quality, size, terrain, priceMultiplier, type, target: 1, existing })[0] ?? null;
  }

  static #generateRooms({ region, quality, size, terrain, priceMultiplier }) {
    const qualityMod = QUALITY_MODIFIERS[quality] ?? QUALITY_MODIFIERS.modest;
    const sizeMod = SIZE_MODIFIERS[size] ?? SIZE_MODIFIERS.medium;
    const target = Math.max(1, Math.min(ROOM_TABLE.length, sizeMod.rooms + qualityMod.rooms));
    const candidates = ROOM_TABLE.filter((room) => !room.quality || room.quality.includes(quality)).map((room) => ({ ...room, weight: 1 }));
    const picked = this.#weightedUnique(candidates, target);
    return picked.map((room) => this.#roomEntry(room, { region, quality, size, terrain, priceMultiplier })).sort((a, b) => a.price - b.price);
  }

  static #generateRoomItem({ region, quality, size, terrain, priceMultiplier, existing }) {
    const existingNames = new Set((existing ?? []).map((entry) => entry.name));
    const candidates = ROOM_TABLE.filter((room) => !existingNames.has(room.name) && (!room.quality || room.quality.includes(quality))).map((room) => ({ ...room, weight: 1 }));
    const room = this.#weightedUnique(candidates, 1)[0];
    return room ? this.#roomEntry(room, { region, quality, size, terrain, priceMultiplier }) : null;
  }

  static #roomEntry(room, { region, quality, size, terrain, priceMultiplier }) {
    const sizeMod = SIZE_MODIFIERS[size] ?? SIZE_MODIFIERS.medium;
    const terrainMod = TERRAIN_MODIFIERS[terrain] ?? TERRAIN_MODIFIERS.road;
    const { basePrice, price } = TavernPricing.pricePair(room.min, room.max, quality, terrain, priceMultiplier, { region, type: "room" });

    if (room.unlimited) {
      return {
        id: foundry.utils.randomID(12),
        name: room.name,
        type: "room",
        desc: room.desc,
        basePrice,
        price,
        stock: null,
        maxStock: null,
        total: null,
        occupied: 0,
        unlimited: true
      };
    }

    const baseTotal = this.#int(room.totalMin, room.totalMax);
    const total = Math.max(1, Math.round(baseTotal * (sizeMod.roomStock / 10)));
    const occupiedChance = Math.min(0.95, Math.max(0.05, terrainMod.occupied * ((QUALITY_MODIFIERS[quality] ?? QUALITY_MODIFIERS.modest).occupied ?? 1)));
    const occupied = Math.min(total, Math.round(total * this.#float(occupiedChance * 0.35, occupiedChance)));

    return {
      id: foundry.utils.randomID(12),
      name: room.name,
      type: "room",
      desc: room.desc,
      basePrice,
      price,
      stock: Math.max(0, total - occupied),
      maxStock: total,
      total,
      occupied,
      unlimited: false
    };
  }

  static #generateServices({ region, quality, size, terrain, priceMultiplier }) {
    const max = size === "large" ? 4 : size === "medium" ? 3 : size === "small" ? 2 : 1;
    const picked = [];

    for (let i = 0; i < max; i++) {
      const entry = this.#generateServiceItem({ region, quality, terrain, priceMultiplier, existing: picked });
      if (entry) picked.push(entry);
    }

    return picked;
  }

  static #generateServiceItem({ region, quality, terrain, priceMultiplier, existing }) {
    const existingNames = new Set((existing ?? []).map((entry) => entry.name));
    const candidates = SERVICE_TABLE.filter((item) => !existingNames.has(item.name) && this.#matches(item, { quality, terrain, region }));
    const item = this.#weightedUnique(candidates, 1)[0];
    return item ? this.#pricedEntry(item, { region, quality, terrain, priceMultiplier, stockBase: this.#int(1, 5) }) : null;
  }

  static #pricedEntry(item, { region, quality, terrain, priceMultiplier, stockBase }) {
    const { basePrice, price } = TavernPricing.pricePair(item.min, item.max, quality, terrain, priceMultiplier, { region, type: item.type });
    const stock = item.unlimited ? null : Math.max(1, Math.round(stockBase * ((QUALITY_MODIFIERS[quality] ?? QUALITY_MODIFIERS.modest).stock ?? 1)));

    return {
      id: foundry.utils.randomID(12),
      name: item.name,
      type: item.type,
      desc: item.desc,
      local: Boolean(item.local),
      basePrice,
      price,
      stock,
      maxStock: item.unlimited ? null : stock,
      unlimited: Boolean(item.unlimited),
      cleanliness: item.cleanliness ? foundry.utils.deepClone(item.cleanliness) : null
    };
  }

  static #matches(item, { region, quality, terrain }) {
    if (NO_BEER_REGIONS.has(region) && item.type === "drink" && this.#isBeer(item)) return false;
    if (item.excludeRegions?.includes(region)) return false;
    const regionOk = !item.regions || item.regions.includes(region) || item.regions.includes("common");
    const terrainOk = !item.terrains || item.terrains.includes(terrain);
    const qualityOk = !item.quality || item.quality.includes(quality);
    return regionOk && terrainOk && qualityOk;
  }



  static #matchesImportedEntry(item, { type, region, quality, terrain, ignoreTerrain }) {
    if (type === "drink" && NO_BEER_REGIONS.has(region) && this.#isBeer(item)) return false;
    if (item.excludeRegions?.includes(region)) return false;
    if (!Array.isArray(item.regions) || !item.regions.length) return false;
    if (item.regions.includes(region)) return false;
    if (!item.regions.some((itemRegion) => itemRegion !== "common")) return false;
    const terrainOk = ignoreTerrain || !item.terrains || item.terrains.includes(terrain);
    const qualityOk = !item.quality || item.quality.includes(quality);
    return terrainOk && qualityOk;
  }

  static #isBeer(item) {
    const text = `${item.name ?? ""} ${item.desc ?? ""}`.toLocaleLowerCase("ru-RU");
    return text.includes("пиво") || text.includes("пивн");
  }

  static #weightedUnique(items, count) {
    const pool = [...items];
    const picked = [];

    while (pool.length && picked.length < count) {
      const total = pool.reduce((sum, item) => sum + (item.weight ?? 1), 0);
      let roll = Math.random() * total;
      const index = pool.findIndex((item) => {
        roll -= item.weight ?? 1;
        return roll <= 0;
      });
      picked.push(...pool.splice(Math.max(0, index), 1));
    }

    return picked;
  }



  static #uniqueByName(items) {
    const seen = new Set();
    const unique = [];

    for (const item of items) {
      const key = String(item.name ?? "").trim().toLocaleLowerCase("ru-RU");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }

    return unique;
  }

  static #int(min, max) {
    const low = Math.trunc(Number(min) || 1);
    const high = Math.max(low, Math.trunc(Number(max) || low));
    return Math.floor(low + Math.random() * (high - low + 1));
  }

  static #float(min, max) {
    return min + Math.random() * (max - min);
  }
}
