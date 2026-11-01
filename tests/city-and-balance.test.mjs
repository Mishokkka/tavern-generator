import "./test-env.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { TavernLocation } from "../scripts/services/TavernLocation.js";
import { TavernGenerator } from "../scripts/services/TavernGenerator.js";
import { TavernMigrations } from "../scripts/services/TavernMigrations.js";
import { TavernInventory } from "../scripts/services/TavernInventory.js";
import { TavernPricing } from "../scripts/services/TavernPricing.js";
import { TavernStockService } from "../scripts/services/TavernStockService.js";
import { TavernMenuProfile } from "../scripts/services/TavernMenuProfile.js";
import { prepareTavernLibrary } from "../scripts/services/TavernLibraryView.js";
import { FOOD_TABLE, DRINK_TABLE, ROOM_TABLE, SERVICE_TABLE, TAVERN_OPTIONS } from "../scripts/data/index.js";

test("city metadata is optional, bounded and normalized on generation and legacy loading", () => {
  assert.equal(TavernGenerator.generate({ city: "  Белый\t Берег  " }).city, "Белый Берег");
  assert.equal(TavernGenerator.generate({ city: "Г".repeat(150) }).city.length, 120);
  assert.equal(TavernLocation.cityKey("  БЕРЁЗОВКА "), TavernLocation.cityKey("березовка"));
  for (const city of [undefined, null, {}, 123, " \t "]) {
    const generated = TavernGenerator.generate({ city });
    assert.equal(generated.city, "");
    delete generated.city;
    const migrated = TavernMigrations.migrate(generated);
    assert.equal(migrated.city, "");
    assert.deepEqual(migrated.inventory, generated.inventory);
  }
});

test("city metadata does not alter menu prices, stock or capacity", () => {
  const random = Math.random;
  Math.random = () => 0.25;
  try {
    const a = TavernGenerator.generate({ city: "Город А" });
    const b = TavernGenerator.generate({ city: "Город Б" });
    const entries = tavern => Object.values(tavern.inventory).flat().map(({ id, ...entry }) => entry);
    assert.deepEqual(entries(a), entries(b));
  } finally { Math.random = random; }
});

test("library groups equivalent city names within each region and searches by city", () => {
  const entries = [
    { id: "one", name: "Первый трактир", region: "novandia", city: "  Берёзовка ", updatedAt: 1 },
    { id: "two", name: "Второй трактир", region: "novandia", city: "березовка", updatedAt: 2 },
    { id: "foreign", name: "Другой регион", region: "sangren", city: "Берёзовка" },
    { id: "other", name: "Другой город", region: "novandia", city: "Ясный" },
    { id: "none", name: "Без города", region: "novandia" },
    { id: "prototype", name: "Любое название", region: "novandia", city: "__proto__" }
  ];
  const view = prepareTavernLibrary(entries);
  assert.equal(view.regionGroups.length, 2);
  const novand = view.regionGroups.find(r => r.label === "Нованд");
  const city = novand.cities.find(c => c.rows.some(r => r.id === "one"));
  assert.deepEqual(city.rows.map(r => r.id), ["two", "one"]);
  assert.equal(city.total, 2);
  assert.equal(novand.cities.at(-1).name, "Без города");
  assert.ok(novand.cities.some(c => c.name === "__proto__"));
  assert.deepEqual(prepareTavernLibrary(entries, { query: "березовка Нованд" }).rows.map(r => r.id), ["two", "one"]);
  assert.equal(prepareTavernLibrary(entries, { status: "active" }, "one").regionGroups[0].cities[0].total, 1);
});

test("city filter uses normalized identities, scopes options by region and distinguishes missing cities", () => {
  const entries = [
    { id: "one", name: "Первый", region: "novandia", city: "Берёзовка" },
    { id: "two", name: "Второй", region: "novandia", city: "березовка" },
    { id: "foreign", name: "Третий", region: "sangren", city: "Берёзовка" },
    { id: "empty", name: "Без города", region: "novandia" },
    { id: "literal", name: "Скобки", region: "novandia", city: '[""]' },
    { id: "south", name: "Южный", region: "sangren", city: "Южный" }
  ];
  const city = JSON.stringify(["березовка"]);
  const view = prepareTavernLibrary(entries, { city });
  assert.equal(view.matched, 3);
  assert.equal(view.regionGroups.length, 2);
  assert.equal(view.cityChoices.filter(c => c.selected).length, 1);
  const narrowed = prepareTavernLibrary(entries, { region: "novandia", city, query: "Второй" });
  assert.deepEqual(narrowed.rows.map(r => r.id), ["two"]);
  assert.equal(narrowed.cityChoices.length, 3); // Search does not discard other city choices.
  assert.ok(!narrowed.cityChoices.some(c => c.label === "Южный"));
  assert.deepEqual(prepareTavernLibrary(entries, { city: JSON.stringify([""]) }).rows.map(r => r.id), ["empty"]);
  assert.deepEqual(prepareTavernLibrary(entries, { city: JSON.stringify(['[""]']) }).rows.map(r => r.id), ["literal"]);
});

test("a city filter removed by deletion or a region change resets to the available list", () => {
  const entries = [{ id: "one", name: "Первый", region: "novandia", city: "Берёзовка" }];
  const result = prepareTavernLibrary(entries, { city: JSON.stringify(["Удалённый город"]), page: 999 });
  assert.equal(result.cityFilter, "");
  assert.equal(result.matched, 1);
  assert.equal(result.page, 1);
});

test("large city groups continue across bounded pages without duplication or interleaving", () => {
  const entries = Array.from({ length: 47 }, (_, i) => ({ id: `a-${i}`, name: `Таверна ${i}`, region: "novandia", city: "Белый Берег", updatedAt: i }));
  entries.push({ id: "b", name: "Заведение", region: "novandia", city: "Другой город" });
  const ids = [];
  for (let page = 1; page <= 3; page++) {
    const view = prepareTavernLibrary(entries, { page });
    assert.ok(view.rows.length <= 20);
    const first = view.regionGroups[0].cities[0];
    assert.equal(first.total, 47);
    assert.equal(first.continued, page > 1);
    assert.equal(first.name, "Белый Берег");
    ids.push(...view.rows.map(r => r.id));
  }
  assert.equal(new Set(ids).size, entries.length);
  assert.equal(ids.at(-1), "b");
});

test("a water resource step matches food pricing and gets only Naerder's supply premium", () => {
  const food = SERVICE_TABLE.find(e => e.resource?.kind === "food");
  const water = SERVICE_TABLE.find(e => e.resource?.kind === "water");
  assert.deepEqual([water.min, water.max], [food.min, food.max]);
  for (const region of Object.keys(TAVERN_OPTIONS.regions)) {
    const context = { region, type: "service", resource: water.resource };
    assert.equal(TavernPricing.pricePair(100, 100, "modest", "town", 1, context).price, region === "naerder" ? 360 : 90);
    assert.equal(TavernPricing.pricePair(100, 100, "modest", "town", 1, { ...context, resource: food.resource }).price, 90);
    assert.equal(TavernPricing.pricePair(100, 100, "modest", "town", 1, { region, type: "service" }).price, 90);
  }
});

test("generated provisions include the water premium once and markup does not compound it", () => {
  const random = Math.random;
  Math.random = () => 0;
  try {
    const tavern = TavernGenerator.generate({ region: "naerder", quality: "modest", terrain: "town", priceMultiplier: 1 });
    tavern.inventory.services = [];
    const supplied = TavernInventory.addProvisions(tavern);
    const water = supplied.inventory.services.find(e => e.resource?.kind === "water");
    const food = supplied.inventory.services.find(e => e.resource?.kind === "food");
    assert.equal(water.basePrice, 18); // 5 × 0.9 × 4, rounded after the supply modifier.
    assert.equal(food.basePrice, 5);
    const marked = TavernGenerator.applyPriceMultiplier(supplied, 2);
    assert.equal(marked.inventory.services.find(e => e.resource?.kind === "water").price, 36);
    const reset = TavernGenerator.applyPriceMultiplier(marked, 1);
    assert.equal(reset.inventory.services.find(e => e.resource?.kind === "water").price, 18);
    assert.deepEqual(water.resource, { kind: "water", steps: 1 });
  } finally { Math.random = random; }
});

test("catalogue recipes, serving units and physical capacity agree with their roles", () => {
  const drink = name => DRINK_TABLE.find(e => e.name === name);
  const food = name => FOOD_TABLE.find(e => e.name === name);
  const mean = e => (e.min + e.max) / 2;
  assert.ok(mean(food("Холодная гречневая лапша с редькой")) < mean(food("Свиные ребрышки с редькой")));
  assert.ok(mean(drink("Настой жареного цикория")) < mean(drink("Черный кофе")));
  assert.equal(TavernMenuProfile.tier(drink("Настой жареного цикория")), "basic");
  assert.equal(TavernMenuProfile.tier(drink("Кувшин кислого молока")), "basic");
  assert.equal(TavernStockService.profile(drink("Прохладная вода из глиняного кувшина")), "drink");
  assert.equal(TavernStockService.profile(drink("Кувшин кислого молока")), "bottle");
  for (const name of ["Место у очага", "Место в конюшне", "Лавка в общей зале"]) {
    const entry = ROOM_TABLE.find(e => e.name === name);
    assert.equal(entry.unlimited, false);
    assert.ok(entry.totalMin > 0 && entry.totalMax >= entry.totalMin);
  }
});
