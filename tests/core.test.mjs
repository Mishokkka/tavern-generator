import { getSetting, setSetting } from "./test-env.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const { TAVERN_OPTIONS, TAVERN_MOOD_TABLE, TAVERN_RUMOR_TABLE, TAVERN_REGULAR_TABLE, TAVERN_INCIDENT_TABLE } = await import("../scripts/data/index.js");
const { TavernDataValidator } = await import("../scripts/services/TavernDataValidator.js");
const { TavernGenerator } = await import("../scripts/services/TavernGenerator.js");
const { TavernMigrations, TAVERN_SCHEMA_VERSION } = await import("../scripts/services/TavernMigrations.js");
const { TavernPurchaseService } = await import("../scripts/services/TavernPurchaseService.js");
const { TavernDailyService } = await import("../scripts/services/TavernDailyService.js");
const { TavernAtmosphereService } = await import("../scripts/services/TavernAtmosphereService.js");
const { TavernAvailabilityService } = await import("../scripts/services/TavernAvailabilityService.js");
const { TavernState } = await import("../scripts/services/TavernState.js");

test("content validator has no hard errors", () => {
  const report = TavernDataValidator.validate({ log: false });
  assert.deepEqual(report.errors, []);
});

test("living tavern content tables retain expanded coverage", () => {
  assert.equal(TAVERN_MOOD_TABLE.length, 18);
  assert.equal(TAVERN_RUMOR_TABLE.length, 60);
  assert.equal(TAVERN_REGULAR_TABLE.length, 45);
  assert.equal(TAVERN_INCIDENT_TABLE.length, 45);
});

test("all region/quality/size/terrain combinations generate usable inventory", () => {
  let generated = 0;
  for (const region of Object.keys(TAVERN_OPTIONS.regions)) {
    for (const quality of Object.keys(TAVERN_OPTIONS.qualities)) {
      for (const size of Object.keys(TAVERN_OPTIONS.sizes)) {
        for (const terrain of Object.keys(TAVERN_OPTIONS.terrains)) {
          const tavern = TavernGenerator.generate({ region, quality, size, terrain, priceMultiplier: 1 });
          assert.equal(tavern.schemaVersion, TAVERN_SCHEMA_VERSION);
          assert.ok(tavern.id);
          assert.ok(tavern.name);
          assert.ok(tavern.inventory.food.length > 0, `${region}/${quality}/${size}/${terrain}: no food`);
          assert.ok(tavern.inventory.drinks.length > 0, `${region}/${quality}/${size}/${terrain}: no drinks`);
          assert.ok(tavern.inventory.lodging.length > 0, `${region}/${quality}/${size}/${terrain}: no lodging`);
          generated += 1;
        }
      }
    }
  }
  assert.equal(generated, 2016);
});

test("Izauver generates imported food and drinks", () => {
  const tavern = TavernGenerator.generate({ region: "izuaver", quality: "modest", size: "medium", terrain: "city", priceMultiplier: 1 });
  assert.ok(tavern.inventory.food.length > 0);
  assert.ok(tavern.inventory.drinks.length > 0);
  assert.ok(tavern.inventory.food.every((entry) => entry.local === false));
  assert.ok(tavern.inventory.drinks.every((entry) => entry.local === false));
});

test("legacy tavern data migrates and gains pinned/maxStock fields", () => {
  const legacy = {
    schemaVersion: 1,
    id: "legacy",
    name: "Старая таверна",
    menu: [{ id: "f1", name: "Каша", type: "food", price: 3, stock: 2 }],
    lodging: [{ id: "r1", name: "Лавка", type: "room", price: 2, stock: 1, total: 2 }]
  };
  const migrated = TavernMigrations.migrate(legacy);
  assert.equal(migrated.schemaVersion, TAVERN_SCHEMA_VERSION);
  assert.equal(migrated.inventory.food[0].pinned, false);
  assert.equal(migrated.inventory.food[0].maxStock, 2);
  assert.equal(migrated.inventory.lodging[0].maxStock, 2);
  assert.equal("menu" in migrated, false);
});

test("purchase payload normalization ignores client price and clamps quantities", () => {
  const [line] = TavernPurchaseService.normalizeLines([{
    category: "room",
    entryId: "abc",
    quantity: 9999,
    days: 9999,
    price: 1,
    stock: 9999
  }]);
  assert.deepEqual(line, { category: "lodging", entryId: "abc", quantity: 99, days: 365 });
  assert.equal("price" in line, false);
  assert.equal("stock" in line, false);
});

test("pinned menu positions survive forced daily rotation", () => {
  const tavern = TavernGenerator.generate({ region: "common", quality: "modest", size: "medium", terrain: "road", priceMultiplier: 1 });
  const pinned = tavern.inventory.food[0];
  pinned.pinned = true;
  for (const entry of tavern.inventory.food.slice(1)) entry.pinned = true;
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const result = TavernDailyService.refreshTavernForNewDay(tavern, { dayKey: "test:1" });
    assert.ok(result.tavern.inventory.food.some((entry) => entry.id === pinned.id));
  } finally {
    Math.random = originalRandom;
  }
});



test("living tavern generation is stable for the same tavern revision", () => {
  const base = TavernGenerator.generate({ region: "flechenrand", quality: "modest", size: "medium", terrain: "town", priceMultiplier: 1 });
  delete base.atmosphere;
  const first = TavernAtmosphereService.ensure(base);
  const second = TavernAtmosphereService.ensure(base);

  assert.equal(first.atmosphere.mood.id, second.atmosphere.mood.id);
  assert.deepEqual(first.atmosphere.rumors.map((entry) => [entry.id, entry.title]), second.atmosphere.rumors.map((entry) => [entry.id, entry.title]));
  assert.deepEqual(first.atmosphere.regulars.map((entry) => [entry.id, entry.title]), second.atmosphere.regulars.map((entry) => [entry.id, entry.title]));
  assert.equal(first.atmosphere.incident.id, second.atmosphere.incident.id);
});

test("pinned rumors and regulars survive atmosphere day advance", () => {
  let tavern = TavernGenerator.generate({ region: "naerder", quality: "comfortable", size: "large", terrain: "city", priceMultiplier: 1 });
  const rumor = tavern.atmosphere.rumors[0];
  const regular = tavern.atmosphere.regulars[0];
  tavern = TavernAtmosphereService.togglePinned(tavern, "rumors", rumor.id);
  tavern = TavernAtmosphereService.togglePinned(tavern, "regulars", regular.id);
  const advanced = TavernAtmosphereService.advanceDay(tavern);

  assert.ok(advanced.atmosphere.rumors.some((entry) => entry.id === rumor.id && entry.pinned));
  assert.ok(advanced.atmosphere.regulars.some((entry) => entry.id === regular.id && entry.pinned));
});

test("public tavern view strips the complete GM-only atmosphere state", () => {
  const tavern = TavernGenerator.generate({ region: "sangren", quality: "modest", size: "medium", terrain: "town", priceMultiplier: 1 });
  tavern.atmosphere.incident.revealed = true;
  const publicView = TavernAtmosphereService.publicView(tavern);

  assert.equal("atmosphere" in publicView, false);
});

test("crowd pressure reduces finite goods in the public and authoritative views", () => {
  const tavern = TavernGenerator.generate({ region: "common", quality: "modest", size: "small", terrain: "road", priceMultiplier: 1 });
  const item = tavern.inventory.food[0];
  item.stock = 10;
  item.maxStock = 10;
  tavern.atmosphere.crowd = 90;
  tavern.atmosphere.mood.crowd = 90;

  const availability = TavernAvailabilityService.forEntry(tavern, "food", item);
  assert.equal(availability.maxPurchaseQuantity, 5);

  const publicView = TavernAtmosphereService.publicView(tavern);
  const decorated = TavernGenerator.decoratePrices(publicView);
  const publicItem = decorated.inventory.food.find((entry) => entry.id === item.id);
  assert.equal("atmosphere" in decorated, false);
  assert.equal(publicItem.maxPurchaseQuantity, 5);
  assert.equal(publicItem.crowdLimited, true);

  assert.throws(() => TavernState.purchaseEntryInData(tavern, "food", item.id, { quantity: 6 }), /сейчас доступно только 5/);
});

test("crowd limits unlimited services for the current atmosphere period", () => {
  const tavern = TavernGenerator.generate({ region: "common", quality: "comfortable", size: "large", terrain: "city", priceMultiplier: 1 });
  const service = tavern.inventory.services[0] ?? { id: "service-test", name: "Поручение", type: "service", basePrice: 2, price: 2 };
  if (!tavern.inventory.services.length) tavern.inventory.services.push(service);
  service.unlimited = true;
  service.stock = null;
  service.maxStock = null;
  tavern.atmosphere.crowd = 88;
  tavern.atmosphere.mood.crowd = 88;
  tavern.atmosphere.availabilityUsage = {};

  const first = TavernState.purchaseEntryInData(tavern, "services", service.id, { quantity: 1 });
  assert.equal(first.tavern.atmosphere.availabilityUsage[`services:${service.id}`], 1);
  assert.throws(() => TavernState.purchaseEntryInData(first.tavern, "services", service.id, { quantity: 1 }), /сейчас недоступно/);
});


test("manual new day advances and persists only the selected tavern", async () => {
  const selected = TavernGenerator.generate({ region: "common", quality: "modest", size: "small", terrain: "road", priceMultiplier: 1 });
  const untouched = TavernGenerator.generate({ region: "sangren", quality: "comfortable", size: "medium", terrain: "town", priceMultiplier: 1 });

  selected.lodgingBookings = [{
    id: "booking-1",
    entryId: selected.inventory.lodging[0].id,
    quantity: 1,
    remainingDays: 2,
    totalDays: 2
  }];

  setSetting("dailyInventoryRefreshEnabled", false);
  setSetting("dailyMenuRotationEnabled", false);
  setSetting("dailyAtmosphereRefreshEnabled", false);
  setSetting("currentTavern", selected);
  setSetting("savedTaverns", [selected, untouched]);
  game.user = { id: "gm-manual-day", isGM: true };

  const result = await TavernDailyService.advanceTavern(selected, {
    dayKey: "manual:test",
    reason: "gm-header",
    broadcast: false
  });

  assert.equal(result.wasCurrent, true);
  assert.equal(result.tavern.refreshState.lastDayKey, "manual:test");
  assert.equal(result.tavern.refreshState.lastReason, "gm-header");
  assert.equal(result.tavern.lodgingBookings[0].remainingDays, 1);
  assert.equal(getSetting("currentTavern").id, selected.id);
  assert.equal(getSetting("currentTavern").refreshState.lastReason, "gm-header");

  const saved = getSetting("savedTaverns");
  assert.equal(saved.find((entry) => entry.id === selected.id).refreshState.lastReason, "gm-header");
  assert.deepEqual(saved.find((entry) => entry.id === untouched.id).refreshState, {});
});

function makeActor({ id = "actor-1", copper = 100 } = {}) {
  let wallet = { gold: 0, silver: 0, copper };
  return {
    id,
    name: "Плательщик",
    testUserPermission: () => true,
    getFlag: () => structuredClone(wallet),
    setFlag: async (_moduleId, _key, value) => { wallet = structuredClone(value); },
    wallet: () => structuredClone(wallet)
  };
}

test("authoritative purchase changes trusted stock and wallet", async () => {
  const tavern = TavernGenerator.generate({ region: "common", quality: "modest", size: "small", terrain: "road", priceMultiplier: 1 });
  const item = tavern.inventory.food[0];
  item.basePrice = 5;
  item.price = 5;
  item.stock = Math.max(3, item.stock ?? 0);
  item.maxStock = item.stock;
  tavern.atmosphere.crowd = 0;
  tavern.atmosphere.mood.crowd = 0;

  setSetting("currencyMode", "flags");
  setSetting("currentTavern", tavern);
  setSetting("savedTaverns", []);

  const user = { id: "user-1", name: "Игрок", active: true };
  const actor = makeActor({ copper: 100 });
  game.user = { id: "gm-1", isGM: true };
  game.users = { get: (id) => id === user.id ? user : null };
  game.actors = { get: (id) => id === actor.id ? actor : null };

  const result = await TavernPurchaseService.execute({
    userId: user.id,
    actorId: actor.id,
    tavernId: tavern.id,
    items: [{ category: "food", entryId: item.id, quantity: 2 }]
  });

  assert.equal(result.total, 10);
  assert.equal(actor.wallet().copper, 90);
  assert.equal(getSetting("currentTavern").inventory.food.find((entry) => entry.id === item.id).stock, item.stock - 2);
});

test("failed tavern persistence restores wallet and trusted storage", async () => {
  const tavern = TavernGenerator.generate({ region: "common", quality: "modest", size: "small", terrain: "road", priceMultiplier: 1 });
  const item = tavern.inventory.food[0];
  item.basePrice = 7;
  item.price = 7;
  item.stock = Math.max(2, item.stock ?? 0);
  item.maxStock = item.stock;
  tavern.atmosphere.crowd = 0;
  tavern.atmosphere.mood.crowd = 0;

  setSetting("currencyMode", "flags");
  setSetting("currentTavern", tavern);
  setSetting("savedTaverns", []);

  const user = { id: "user-2", name: "Игрок", active: true };
  const actor = makeActor({ id: "actor-2", copper: 100 });
  game.user = { id: "gm-1", isGM: true };
  game.users = { get: (id) => id === user.id ? user : null };
  game.actors = { get: (id) => id === actor.id ? actor : null };

  const originalSet = game.settings.set;
  let failOnce = true;
  game.settings.set = async (moduleId, key, value) => {
    if (key === "currentTavern" && failOnce) {
      failOnce = false;
      throw new Error("simulated storage failure");
    }
    return originalSet(moduleId, key, value);
  };

  try {
    await assert.rejects(() => TavernPurchaseService.execute({
      userId: user.id,
      actorId: actor.id,
      tavernId: tavern.id,
      items: [{ category: "food", entryId: item.id, quantity: 1 }]
    }), /simulated storage failure/);
  } finally {
    game.settings.set = originalSet;
  }

  assert.equal(actor.wallet().copper, 100);
  assert.equal(getSetting("currentTavern").inventory.food.find((entry) => entry.id === item.id).stock, item.stock);
});


test("live GM atmosphere overrides stale embedded public availability", () => {
  const tavern = TavernGenerator.generate({ region: "common", quality: "modest", size: "small", terrain: "road", priceMultiplier: 1 });
  const item = tavern.inventory.food[0];
  item.stock = 10;
  item.maxStock = 10;
  item.crowdAvailability = { maxPurchaseQuantity: 9, disabled: false, limited: true, stockLabel: "9", note: "stale" };
  tavern.atmosphere.crowd = 90;
  tavern.atmosphere.mood.crowd = 90;

  const availability = TavernAvailabilityService.forEntry(tavern, "food", item);
  assert.equal(availability.maxPurchaseQuantity, 5);
});

test("restoring a GM atmosphere from a public snapshot removes embedded caps", () => {
  const tavern = TavernGenerator.generate({ region: "common", quality: "modest", size: "small", terrain: "road", priceMultiplier: 1 });
  const publicView = TavernAtmosphereService.publicView(tavern);
  assert.ok(publicView.inventory.food.some((entry) => entry.crowdAvailability));

  const restored = TavernAtmosphereService.ensure(publicView);
  assert.ok(restored.atmosphere);
  assert.ok(restored.inventory.food.every((entry) => !("crowdAvailability" in entry)));
});


test("exact Tavern Life navigation rejects a stripped public-only fallback", () => {
  const tavern = TavernGenerator.generate({ region: "common", quality: "modest", size: "small", terrain: "road", priceMultiplier: 1 });
  const publicView = TavernAtmosphereService.publicView(tavern);
  setSetting("currentTavern", null);
  setSetting("savedTaverns", []);

  const resolved = TavernState.resolveExactTavern({
    tavernId: tavern.id,
    fallback: publicView,
    requirePrivate: true
  });

  assert.equal(resolved, null);
});
