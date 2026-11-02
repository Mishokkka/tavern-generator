import {
  DRINK_TABLE,
  FOOD_TABLE,
  QUALITY_MODIFIERS,
  ROOM_TABLE,
  SERVICE_TABLE,
  SIZE_MODIFIERS,
  TERRAIN_MODIFIERS
} from "../data/index.js";
import { TavernStockService } from "./TavernStockService.js";
import { TavernMigrations } from "./TavernMigrations.js";
import { TavernPricing } from "./TavernPricing.js";
import { TavernMenuProfile } from "./TavernMenuProfile.js";
import { TavernOfferingModel } from "./TavernOfferingModel.js";
import { TavernViewModel } from "./TavernViewModel.js";

const NO_BEER_REGIONS = new Set(["novandia", "sangren"]);
const IMPORT_MARKET_REGION = "izuaver";

export class TavernInventory {
  static generate({ region, quality, size, terrain, priceMultiplier }) {
    const { food, drinks } = this.#generateMenu({ region, quality, size, terrain, priceMultiplier });
    const lodging = this.#generateRooms({ region, quality, size, terrain, priceMultiplier });
    return {
      food,
      drinks,
      lodging,
      services: this.#generateServices({ region, quality, size, terrain, priceMultiplier, lodging })
    };
  }

  static planFor(tavern) {
    const context = TavernOfferingModel.context(tavern);
    const food = this.#menuPool({ ...tavern, type: "food", existing: [] });
    const required = ["meal", "tableDrink", "lodging", "wash"];
    if (context.animals) required.push("animalBoarding", "animalFeed");
    if (context.travelSupplies) required.push("foodSupply", "waterSupply");
    if (food.some(item => item.local && TavernOfferingModel.has(item, "meal"))) required.push("localMeal");
    if (TavernOfferingModel.families(food).size >= 2) required.push("foodVariety");
    return { version: TavernOfferingModel.VERSION, facilities: { animals: context.animals }, required };
  }

  /** Explicit adoption: add missing offers, never reroll or replenish existing data. */
  static ensureOfferings(tavern) {
    const clone = TavernMigrations.migrate(tavern);
    if (!clone) return null;
    for (const [category, type] of [["food", "food"], ["drinks", "drink"], ["lodging", "room"], ["services", "service"]]) {
      clone.inventory[category] = clone.inventory[category].map(entry => TavernOfferingModel.annotate(entry, type));
    }
    clone.offeringPlan = this.planFor(clone);
    for (const role of ["lodging", "localMeal", "meal", "foodVariety", "tableDrink", "wash", "animalBoarding", "animalFeed", "foodSupply", "waterSupply"]) {
      if (!clone.offeringPlan.required.includes(role) || TavernOfferingModel.coverage(clone)[role]) continue;
      if (role === "lodging") {
        const entry = this.#generateRoomItem({ ...clone, existing: clone.inventory.lodging });
        if (entry) clone.inventory.lodging.push(entry);
        clone.offeringPlan = this.planFor(clone);
        continue;
      }
      const category = ["meal", "localMeal", "foodVariety"].includes(role) ? "food" : role === "tableDrink" ? "drinks" : "services";
      const type = category === "drinks" ? "drink" : category === "food" ? "food" : "service";
      const existing = clone.inventory[category];
      const pool = type === "service" ? SERVICE_TABLE.filter(item => this.#matches(item, clone) && !existing.some(entry => entry.name === item.name))
        : this.#menuPool({ ...clone, type, existing });
      const families = TavernOfferingModel.families(clone.inventory.food);
      const candidates = pool.filter(item => role === "localMeal" ? item.local && TavernOfferingModel.has(item, "meal")
        : role === "foodVariety" ? !families.has(TavernOfferingModel.profile(item, type).family)
        : TavernOfferingModel.has(item, role));
      const preferred = role === "wash" ? candidates.filter(item => TavernOfferingModel.profile(item, "service").basic) : candidates;
      const item = this.#weightedUnique(preferred.length ? preferred : candidates, 1, type === "service" ? null : clone.quality)[0];
      if (item) existing.push({ ...this.#pricedEntry(item, clone), offeringCore: true });
    }
    clone.summary = TavernViewModel.summary(clone);
    return clone;
  }

  static completeAnimalOffers(tavern) {
    const clone = TavernMigrations.migrate(tavern);
    if (!clone || !TavernOfferingModel.context(clone).animals) return clone;
    for (const role of ["animalBoarding", "animalFeed"]) {
      if (TavernOfferingModel.coverage(clone)[role]) continue;
      const candidates = SERVICE_TABLE.filter(item => this.#matches(item, clone) && TavernOfferingModel.has(item, role)
        && !clone.inventory.services.some(entry => entry.name === item.name));
      const basic = candidates.filter(item => TavernOfferingModel.profile(item, "service").basic);
      const item = this.#weightedUnique(basic.length ? basic : candidates, 1)[0];
      if (item) clone.inventory.services.push({ ...this.#pricedEntry(item, clone), offeringCore: true });
    }
    if (clone.offeringPlan) clone.offeringPlan = this.planFor(clone);
    clone.summary = TavernViewModel.summary(clone);
    return clone;
  }

  /** Select a valid replacement before touching IDs, stock or the original list. */
  static rotateMenuEntry(tavern, category, entryId) {
    const clone = TavernMigrations.migrate(tavern);
    const key = TavernMigrations.categoryToInventoryKey(category);
    if (!clone || !["food", "drinks"].includes(key)) return clone;
    const index = clone.inventory[key].findIndex(entry => entry.id === entryId && !entry.pinned);
    if (index < 0) return clone;
    const type = key === "food" ? "food" : "drink", victim = clone.inventory[key][index];
    const existing = clone.inventory[key].filter(entry => entry.id !== entryId);
    const candidates = this.#menuPool({ ...clone, type, existing }).filter(item => item.name !== victim.name).filter(item => {
      const next = { ...clone, inventory: { ...clone.inventory, [key]: [...existing, TavernOfferingModel.annotate({ ...item, type }, type)] } };
      return TavernOfferingModel.preservesMenu(clone, next);
    });
    const local = candidates.filter(item => item.local), common = candidates.filter(item => !item.local);
    const localChance = (TERRAIN_MODIFIERS[clone.terrain] ?? TERRAIN_MODIFIERS.road).localChance;
    const pool = local.length && (!common.length || Math.random() < localChance) ? local : common.length ? common : candidates;
    const item = this.#weightedUnique(pool, 1, clone.quality)[0];
    if (!item) return clone;
    clone.inventory[key][index] = { ...this.#pricedEntry(item, clone), offeringCore: Boolean(victim.offeringCore) };
    clone.summary = TavernViewModel.summary(clone);
    return clone;
  }

  static addProvisions(tavern) {
    const clone = TavernMigrations.migrate(tavern);
    if (!clone) return null;
    for (const item of SERVICE_TABLE.filter((entry) => entry.resource)) {
      if (clone.inventory.services.some((entry) => entry.resource?.kind === item.resource.kind)) continue;
      clone.inventory.services.push(this.#pricedEntry(item, clone));
    }
    clone.summary = TavernViewModel.summary(clone);
    return clone;
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
    else if (key === "services") {
      const covered = TavernOfferingModel.coverage(clone);
      const wantedRole = TavernOfferingModel.required(clone).find(role => !covered[role] && ["wash", "foodSupply", "waterSupply"].includes(role));
      entry = this.#generateServiceItem({ ...params, existing: clone.inventory.services ?? [], wantedRole });
    }
    else if (key === "lodging") entry = this.#generateRoomItem({ ...params, existing: clone.inventory.lodging ?? [] });

    if (!entry || !key) return clone;
    clone.inventory[key] = [...(clone.inventory[key] ?? []), entry];
    if (["lodging", "services"].includes(key)) {
      const profile = TavernOfferingModel.profile(entry);
      if (profile.animals || profile.roles.some(role => ["animalBoarding", "animalFeed"].includes(role))) return this.completeAnimalOffers(clone);
    }
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

  static #menuPool({ region, quality, terrain, type, existing = [], target = 1 }) {
    const table = type === "food" ? FOOD_TABLE : DRINK_TABLE;
    const existingNames = new Set((existing ?? []).map((entry) => entry.name));
    if (region === IMPORT_MARKET_REGION) {
      const strict = table.filter(item => !existingNames.has(item.name) && this.#matchesImportedEntry(item, { type, region, quality, terrain, ignoreTerrain: false }));
      const fallback = strict.length < target ? table.filter(item => !existingNames.has(item.name) && this.#matchesImportedEntry(item, { type, region, quality, terrain, ignoreTerrain: true })) : [];
      return this.#uniqueByName([...strict, ...fallback]).map(item => ({ ...item, local: false }));
    }
    return this.#uniqueByName(table.filter(item => !existingNames.has(item.name) && this.#matches(item, { region, quality, terrain })));
  }

  static #generateMenuItems(params) {
    const { region, quality, size, terrain, type, target, existing = [] } = params;
    const pool = this.#menuPool(params), picked = [];
    const take = (candidates, count = 1) => {
      const remaining = candidates.filter(item => !picked.some(entry => entry.name === item.name));
      picked.push(...this.#weightedUnique(remaining, Math.min(count, target - picked.length), quality));
    };
    if (region === IMPORT_MARKET_REGION) {
      const strict = pool.filter(item => this.#matchesImportedEntry(item, { type, region, quality, terrain, ignoreTerrain: false }));
      if (strict.length < target) take(strict, strict.length);
    }
    if (type === "food") {
      const localMeals = pool.filter(item => item.local && TavernOfferingModel.has(item, "meal"));
      if (localMeals.length && !existing.some(item => item.local && TavernOfferingModel.has(item, "meal"))) take(localMeals);
      if (![...existing, ...picked].some(item => TavernOfferingModel.has(item, "meal"))) take(pool.filter(item => TavernOfferingModel.has(item, "meal")));
      const families = TavernOfferingModel.families([...existing, ...picked]);
      if (existing.length + target >= 3 && families.size < 2) {
        const different = pool.filter(item => !families.has(TavernOfferingModel.profile(item, "food").family));
        const common = different.filter(item => !item.local);
        take(common.length ? common : different);
      }
    } else if (!existing.some(item => TavernOfferingModel.has(item, "tableDrink"))) {
      const everyday = pool.filter(item => TavernOfferingModel.has(item, "tableDrink"));
      const local = everyday.filter(item => item.local);
      take(local.length ? local : everyday);
    }
    const local = pool.filter(item => item.local), common = pool.filter(item => !item.local);
    const terrainMod = TERRAIN_MODIFIERS[terrain] ?? TERRAIN_MODIFIERS.road;
    const localChance = type === "food" ? terrainMod.localChance ?? 0.6 : Math.max(0.25, (terrainMod.localChance ?? 0.6) - 0.15);
    if (region !== IMPORT_MARKET_REGION && local.length && Math.random() < localChance) {
      const maxLocal = Math.min((SIZE_MODIFIERS[size] ?? SIZE_MODIFIERS.medium).localMax, local.length, Math.max(1, target - 1));
      const wanted = this.#int(1, maxLocal);
      take(local, Math.max(0, wanted - picked.filter(item => item.local).length));
    }
    take(common, target - picked.length);
    take(pool, target - picked.length);
    return picked.map(item => this.#pricedEntry(item, params));
  }

  static #generateMenuItem({ region, quality, size, terrain, priceMultiplier, type, existing }) {
    return this.#generateMenuItems({ region, quality, size, terrain, priceMultiplier, type, target: 1, existing })[0] ?? null;
  }

  static #generateRooms({ region, quality, size, terrain, priceMultiplier }) {
    const qualityMod = QUALITY_MODIFIERS[quality] ?? QUALITY_MODIFIERS.modest;
    const sizeMod = SIZE_MODIFIERS[size] ?? SIZE_MODIFIERS.medium;
    const target = Math.max(1, Math.min(ROOM_TABLE.length, sizeMod.rooms + qualityMod.rooms));
    const candidates = ROOM_TABLE.filter((room) => this.#matches(room, { region, quality, terrain }));
    const picked = this.#pickWithRegionalFirst(candidates, target);
    return picked.map((room) => this.#roomEntry(room, { region, quality, size, terrain, priceMultiplier })).sort((a, b) => a.price - b.price);
  }

  static #generateRoomItem({ region, quality, size, terrain, priceMultiplier, existing }) {
    const existingNames = new Set((existing ?? []).map((entry) => entry.name));
    const candidates = ROOM_TABLE.filter((room) => !existingNames.has(room.name) && this.#matches(room, { region, quality, terrain }));
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
        unlimited: true,
        offering: TavernOfferingModel.profile(room, "room"),
        pinned: false
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
      unlimited: false,
      offering: TavernOfferingModel.profile(room, "room"),
      pinned: false
    };
  }

  static #generateServices({ region, quality, size, terrain, priceMultiplier, lodging }) {
    const params = { region, quality, size, terrain, priceMultiplier };
    const context = TavernOfferingModel.context({ ...params, inventory: { lodging } });
    const max = size === "large" ? 4 : size === "medium" ? 3 : size === "small" ? 2 : 1;
    const picked = [];
    for (const role of ["wash", ...(context.animals ? ["animalBoarding", "animalFeed"] : [])]) {
      const entry = this.#generateServiceItem({ ...params, existing: picked, wantedRole: role });
      if (entry) picked.push({ ...entry, offeringCore: true });
    }
    for (let i = 0; i < max; i++) {
      const entry = this.#generateServiceItem({ ...params, existing: picked, extrasOnly: true, preferRegional: i === 0, animals: context.animals });
      if (entry) picked.push(entry);
    }

    const chance = Math.min(0.95, ({ tiny: 0.35, small: 0.55, medium: 0.75, large: 0.9 })[size] + (["road", "port"].includes(terrain) ? 0.1 : 0));
    for (const item of SERVICE_TABLE.filter((entry) => entry.resource)) {
      if (context.travelSupplies || Math.random() < chance) picked.push({ ...this.#pricedEntry(item, params), offeringCore: context.travelSupplies });
    }
    return picked;
  }

  static #generateServiceItem({ region, quality, size, terrain, priceMultiplier, existing, wantedRole = null, extrasOnly = false, preferRegional = false, animals = true }) {
    const existingNames = new Set((existing ?? []).map((entry) => entry.name));
    let candidates = SERVICE_TABLE.filter(item => !existingNames.has(item.name) && this.#matches(item, { quality, terrain, region }));
    if (wantedRole) {
      candidates = candidates.filter(item => TavernOfferingModel.has(item, wantedRole));
      const basic = candidates.filter(item => TavernOfferingModel.profile(item, "service").basic);
      if (basic.length) candidates = basic;
    } else candidates = candidates.filter(item => !item.resource && (!extrasOnly || (!TavernOfferingModel.profile(item, "service").basic
      && (animals || !TavernOfferingModel.profile(item, "service").animals))));
    const item = (preferRegional ? this.#pickWithRegionalFirst(candidates, 1) : this.#weightedUnique(candidates, 1))[0];
    return item ? this.#pricedEntry(item, { region, quality, terrain, priceMultiplier, size }) : null;
  }

  static #pickWithRegionalFirst(candidates, target) {
    const regional = candidates.filter((item) => item.regions?.length && !item.regions.includes("common"));
    const picked = this.#weightedUnique(regional, Math.min(1, target));
    const remaining = candidates.filter((item) => !picked.some((chosen) => chosen.name === item.name));
    return [...picked, ...this.#weightedUnique(remaining, target - picked.length)];
  }

  static #pricedEntry(item, { region, quality, size, terrain, priceMultiplier }) {
    const { basePrice, price } = TavernPricing.pricePair(item.min, item.max, quality, terrain, priceMultiplier, { region, type: item.type, resource: item.resource });
    const rolled = TavernStockService.roll(item, { size, quality, region });
    const stock = item.unlimited ? null : rolled.stock;

    return {
      id: foundry.utils.randomID(12),
      name: item.name,
      type: item.type,
      desc: item.desc,
      local: Boolean(item.local),
      quality: Array.isArray(item.quality) ? foundry.utils.deepClone(item.quality) : null,
      basePrice,
      price,
      stock,
      maxStock: item.unlimited ? null : stock,
      unlimited: Boolean(item.unlimited),
      stockModel: rolled.stockModel,
      stockProfile: rolled.stockProfile,
      resource: item.resource ? foundry.utils.deepClone(item.resource) : null,
      cleanliness: item.cleanliness ? foundry.utils.deepClone(item.cleanliness) : null,
      seasonal: item.seasonal ? foundry.utils.deepClone(item.seasonal) : null,
      offering: TavernOfferingModel.profile(item, item.type),
      pinned: false
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

  static #weightedUnique(items, count, menuQuality = null) {
    const pool = this.#uniqueByName(items);
    const picked = [];
    const weight = (item) => menuQuality ? TavernMenuProfile.weight(item, menuQuality) : (item.weight ?? 1);

    while (pool.length && picked.length < count) {
      const total = pool.reduce((sum, item) => sum + weight(item), 0);
      let roll = Math.random() * total;
      const index = pool.findIndex((item) => {
        roll -= weight(item);
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
