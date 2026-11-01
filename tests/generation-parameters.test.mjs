import "./test-env.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { FOOD_TABLE, DRINK_TABLE, ROOM_TABLE, SERVICE_TABLE, TAVERN_OPTIONS } from "../scripts/data/index.js";
import { TavernInventory } from "../scripts/services/TavernInventory.js";
import { TavernGenerator } from "../scripts/services/TavernGenerator.js";
import { TavernPricing } from "../scripts/services/TavernPricing.js";
import { TavernStockService } from "../scripts/services/TavernStockService.js";
import { TavernNames } from "../scripts/services/TavernNames.js";
import { TavernMenuProfile } from "../scripts/services/TavernMenuProfile.js";

function seeded(seed, task) {
  const original = Math.random;
  let state = seed;
  Math.random = () => {
    let value = state += 0x6D2B79F5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  try { return task(); } finally { Math.random = original; }
}
const params = { region: "common", quality: "modest", size: "medium", terrain: "town", priceMultiplier: 1 };
const comparable = (inventory) => Object.fromEntries(Object.entries(inventory).map(([key, entries]) => [key,
  entries.map(({ id, price, ...entry }) => entry).sort((a, b) => a.name.localeCompare(b.name))
]));

test("custom names work during generation, with whitespace normalization and a 120-character limit", () => {
  assert.equal(TavernGenerator.generate({ ...params, name: "  У   старого моста  " }).name, "У старого моста");
  assert.equal(TavernGenerator.generate({ ...params, name: "Т".repeat(150) }).name.length, 120);
  for (const name of [undefined, "", " \t ", null, {}]) {
    assert.ok(TavernGenerator.generate({ ...params, name }).name.trim());
  }
  assert.equal(TavernNames.normalizeCustomName(10), "");
});

test("giving a name does not change the generated inventory", () => {
  const random = seeded(123, () => TavernGenerator.generate(params));
  const custom = seeded(123, () => TavernGenerator.generate({ ...params, name: "Своя таверна" }));
  assert.deepEqual(comparable(random.inventory), comparable(custom.inventory));
});

test("quality has the expected price scale on the same catalogue item", () => {
  const prices = Object.keys(TAVERN_OPTIONS.qualities).map(quality => TavernPricing.pricePair(100, 100, quality, "town", 1).price);
  assert.deepEqual(prices, [60, 90, 135, 210]);
});

test("terrain price differences follow supply and settlement costs", () => {
  const prices = Object.fromEntries(Object.keys(TAVERN_OPTIONS.terrains).map(terrain => [terrain, TavernPricing.pricePair(100, 100, "modest", terrain, 1).price]));
  assert.deepEqual(prices, { city: 108, town: 90, road: 99, village: 77, port: 113, mountain: 122, wilderness: 135 });
});

test("markup changes prices without changing menu choices, stocks, lodging or service availability", () => {
  for (const quality of Object.keys(TAVERN_OPTIONS.qualities)) {
    const base = seeded(567, () => TavernInventory.generate({ ...params, quality }));
    for (const multiplier of [0.1, 0.5, 1.5, 5]) {
      const marked = seeded(567, () => TavernInventory.generate({ ...params, quality, priceMultiplier: multiplier }));
      assert.deepEqual(comparable(marked), comparable(base));
      for (const entries of Object.values(marked)) for (const entry of entries) {
        assert.equal(entry.price, Math.max(1, Math.round(entry.basePrice * multiplier)));
      }
    }
  }
});

test("all non-country parameter combinations honor catalogue filters and valid price/capacity bounds", () => {
  const tables = { food: FOOD_TABLE, drinks: DRINK_TABLE, lodging: ROOM_TABLE, services: SERVICE_TABLE };
  for (const quality of Object.keys(TAVERN_OPTIONS.qualities)) for (const size of Object.keys(TAVERN_OPTIONS.sizes)) for (const terrain of Object.keys(TAVERN_OPTIONS.terrains)) {
    const inventory = seeded(901, () => TavernInventory.generate({ ...params, quality, size, terrain, priceMultiplier: 1.75 }));
    for (const [category, entries] of Object.entries(inventory)) for (const entry of entries) {
      const source = tables[category].find(source => source.name === entry.name);
      const label = `${quality}/${size}/${terrain}/${entry.name}`;
      assert.ok(source, label);
      assert.ok(!source.quality || source.quality.includes(quality), label);
      assert.ok(!source.terrains || source.terrains.includes(terrain), label);
      assert.equal(entry.price, Math.max(1, Math.round(entry.basePrice * 1.75)), label);
      if (!entry.unlimited) {
        assert.ok(Number.isInteger(entry.stock) && entry.stock >= 0, label);
        assert.ok(entry.stock <= entry.maxStock, label);
      }
    }
  }
});

test("quality changes food and drink composition while preserving explicit eligibility", () => {
  for (const [table, category, type] of [[FOOD_TABLE, "food", "food"], [DRINK_TABLE, "drinks", "drink"]]) {
    const old = [...table];
    try {
      table.splice(0, table.length,
        { name: "Простая позиция", type, min: 1, max: 2, weight: 1 },
        { name: "Дорогая позиция", type, min: 20, max: 30, weight: 1 },
        { name: "Запрещённая позиция", type, min: 20, max: 30, weight: 1000, quality: ["good"] }
      );
      const counts = { poor: 0, fine: 0 };
      for (const quality of Object.keys(counts)) for (let seed = 1; seed <= 512; seed++) {
        const tavern = { ...params, id: "profile-test", name: "Test", quality, inventory: { food: [], drinks: [], lodging: [], services: [] } };
        const next = seeded(seed, () => TavernInventory.addRandomEntry(tavern, category));
        const item = next.inventory[category][0];
        assert.notEqual(item.name, "Запрещённая позиция");
        if (item.name === "Дорогая позиция") counts[quality]++;
      }
      assert.ok(counts.poor < 128, `${category}: too many premium items in poor taverns (${counts.poor})`);
      assert.ok(counts.fine > 384, `${category}: too few premium items in fine taverns (${counts.fine})`);
    } finally { table.splice(0, table.length, ...old); }
  }
});

test("menu tiers use neutral catalogue prices and support explicit catalogue overrides", () => {
  assert.equal(TavernMenuProfile.tier({ type: "food", min: 2, max: 4 }), "basic");
  assert.equal(TavernMenuProfile.tier({ type: "food", min: 6, max: 10 }), "standard");
  assert.equal(TavernMenuProfile.tier({ type: "drink", min: 6, max: 10 }), "premium");
  assert.equal(TavernMenuProfile.tier({ type: "food", min: 2, max: 4, menuTier: "premium" }), "premium");
});

test("size changes capacity and quantity without adding a price multiplier", () => {
  const original = [...ROOM_TABLE];
  try {
    ROOM_TABLE.splice(0, ROOM_TABLE.length, { name: "Контрольная комната", min: 100, max: 100, totalMin: 10, totalMax: 10 });
    const rooms = Object.keys(TAVERN_OPTIONS.sizes).map(size => seeded(456, () => TavernInventory.generate({ ...params, size })).lodging[0]);
    assert.deepEqual(rooms.map(room => room.total), [3, 6, 10, 18]);
    assert.deepEqual(rooms.map(room => room.price), [90, 90, 90, 90]);
    const menus = Object.keys(TAVERN_OPTIONS.sizes).map(size => seeded(456, () => TavernInventory.generate({ ...params, size })));
    assert.deepEqual(menus.map(menu => menu.food.length + menu.drinks.length), [5, 7, 9, 13]);
    assert.deepEqual(menus.map(menu => menu.services.filter(entry => !entry.resource).length), [1, 2, 3, 4]);
  } finally { ROOM_TABLE.splice(0, ROOM_TABLE.length, ...original); }
});

test("initial room occupation follows terrain and affordability without exceeding capacity", () => {
  const original = [...ROOM_TABLE];
  try {
    ROOM_TABLE.splice(0, ROOM_TABLE.length, { name: "Контрольная комната", min: 10, max: 10, totalMin: 100, totalMax: 100 });
    const room = (quality, terrain) => seeded(456, () => TavernInventory.addRandomEntry({
      ...params, id: "occupation-test", name: "Test", quality, terrain,
      inventory: { food: [], drinks: [], lodging: [], services: [] }
    }, "lodging")).inventory.lodging[0];
    assert.ok(room("modest", "port").occupied > room("modest", "wilderness").occupied);
    assert.ok(room("poor", "town").occupied > room("fine", "town").occupied);
    for (const quality of Object.keys(TAVERN_OPTIONS.qualities)) for (const terrain of Object.keys(TAVERN_OPTIONS.terrains)) {
      const result = room(quality, terrain);
      assert.equal(result.stock + result.occupied, result.total);
      assert.ok(result.occupied >= 0 && result.occupied <= result.total);
    }
  } finally { ROOM_TABLE.splice(0, ROOM_TABLE.length, ...original); }
});

test("stock ranges grow with size and quality independently of markup", () => {
  for (const type of ["food", "drink", "service"]) {
    const entry = { type, name: "Контрольная позиция" };
    const ranges = Object.keys(TAVERN_OPTIONS.sizes).map(size => TavernStockService.range(entry, { ...params, size }));
    for (let index = 1; index < ranges.length; index++) {
      assert.ok(ranges[index].min >= ranges[index - 1].min);
      assert.ok(ranges[index].max > ranges[index - 1].max);
    }
    const poor = TavernStockService.range(entry, { ...params, quality: "poor" });
    const fine = TavernStockService.range(entry, { ...params, quality: "fine" });
    assert.ok(fine.min > poor.min && fine.max > poor.max);
    assert.deepEqual(TavernStockService.range(entry, { ...params, priceMultiplier: 5 }), TavernStockService.range(entry, params));
  }
});

test("changing the markup twice recalculates from base prices instead of compounding", () => {
  const base = TavernGenerator.generate(params);
  const twice = TavernPricing.applyMultiplier(TavernPricing.applyMultiplier(base, 2), 1.5);
  const once = TavernPricing.applyMultiplier(base, 1.5);
  assert.deepEqual(twice.inventory, once.inventory);
});
