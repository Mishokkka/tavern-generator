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
const { TavernEditor } = await import("../scripts/services/TavernEditor.js");
const { TavernPricing } = await import("../scripts/services/TavernPricing.js");
const { PurchaseSoundService } = await import("../scripts/services/PurchaseSoundService.js");
const { CurrencyAdapter } = await import("../scripts/services/CurrencyAdapter.js");
const { CleanlinessAdapter } = await import("../scripts/services/CleanlinessAdapter.js");
const { TavernPrivateStore } = await import("../scripts/services/TavernPrivateStore.js");
const { FoundryDocumentUtils } = await import("../scripts/services/FoundryDocumentUtils.js");
const { TavernSocketIdentity } = await import("../scripts/services/TavernSocketIdentity.js");
const { TavernSocketRelay } = await import("../scripts/services/TavernSocketRelay.js");
const { TavernSceneService } = await import("../scripts/services/TavernSceneService.js");
const { TavernPlayerApp } = await import("../scripts/apps/TavernPlayerApp.js");

let privateStoreJournal = null;

async function activatePrivateStore() {
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0 } };
  const journals = new Map();
  if (privateStoreJournal) journals.set(privateStoreJournal.id, privateStoreJournal);

  game.journal = {
    get: (id) => journals.get(id) ?? null,
    find: (predicate) => [...journals.values()].find(predicate) ?? null
  };

  globalThis.JournalEntry = {
    create: async (data) => {
      const journal = {
        id: "private-store-test",
        ownership: structuredClone(data.ownership),
        flags: structuredClone(data.flags),
        getFlag(moduleId, key) { return this.flags?.[moduleId]?.[key]; },
        async setFlag(moduleId, key, value) {
          this.flags[moduleId] ??= {};
          this.flags[moduleId][key] = structuredClone(value);
          return value;
        },
        async update(changes) {
          if (Object.hasOwn(changes, "ownership.default")) this.ownership.default = changes["ownership.default"];
          for (const [key] of Object.entries(changes)) {
            if (key.startsWith("ownership.-=")) delete this.ownership[key.slice("ownership.-=".length)];
          }
          return this;
        }
      };
      privateStoreJournal = journal;
      journals.set(journal.id, journal);
      return journal;
    }
  };

  const gm = { id: "gm-private-store", isGM: true, active: true };
  game.user = gm;
  game.users = [gm];
  setSetting("privateStateJournalId", privateStoreJournal?.id ?? "");
  await TavernPrivateStore.initialize();
  return TavernPrivateStore;
}

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
  const store = await activatePrivateStore();
  await store.write({ current: selected, saved: [selected, untouched] });
  setSetting("currentTavern", TavernAtmosphereService.publicView(selected));

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

  const saved = store.state.saved;
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
  const store = await activatePrivateStore();
  await store.write({ current: tavern, saved: [] });
  setSetting("currentTavern", TavernAtmosphereService.publicView(tavern));

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
  assert.equal(store.state.current.inventory.food.find((entry) => entry.id === item.id).stock, item.stock - 2);
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
  const store = await activatePrivateStore();
  await store.write({ current: tavern, saved: [] });
  setSetting("currentTavern", TavernAtmosphereService.publicView(tavern));

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
  assert.equal(store.state.current.inventory.food.find((entry) => entry.id === item.id).stock, item.stock);
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


test("zero stock limits survive migration", () => {
  const tavern = TavernGenerator.generate({ region: "common", quality: "modest", size: "small", terrain: "road", priceMultiplier: 1 });
  const entry = tavern.inventory.food[0];
  entry.stock = 0;
  entry.maxStock = 0;

  const migrated = TavernMigrations.migrate(tavern);
  assert.equal(migrated.inventory.food[0].stock, 0);
  assert.equal(migrated.inventory.food[0].maxStock, 0);
});

test("zero crowd survives migration", () => {
  const tavern = TavernGenerator.generate({ region: "common", quality: "modest", size: "small", terrain: "road", priceMultiplier: 1 });
  tavern.atmosphere.crowd = 0;
  tavern.atmosphere.mood.crowd = 75;

  const migrated = TavernMigrations.migrate(tavern);
  assert.equal(migrated.atmosphere.crowd, 0);
});

test("private GM store strips explicit player ownership", async () => {
  const store = await activatePrivateStore();
  privateStoreJournal.ownership = { default: 2, "player-explicit": 2, "player-none": 0 };

  await store.initialize();
  assert.deepEqual(privateStoreJournal.ownership, { default: 0 });
});

test("private GM store ignores an unmarked configured journal", async () => {
  globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0 } };
  const staleJournal = {
    id: "unrelated-journal",
    ownership: { default: 2, "player-explicit": 2 },
    flags: {},
    updates: 0,
    getFlag(moduleId, key) { return this.flags?.[moduleId]?.[key]; },
    async update() {
      this.updates += 1;
      return this;
    }
  };
  let createdJournal = null;
  const journals = new Map([[staleJournal.id, staleJournal]]);
  game.journal = {
    get: (id) => journals.get(id) ?? null,
    find: (predicate) => [...journals.values()].find(predicate) ?? null
  };
  globalThis.JournalEntry = {
    create: async (data) => {
      createdJournal = {
        id: "replacement-private-store",
        ownership: structuredClone(data.ownership),
        flags: structuredClone(data.flags),
        getFlag(moduleId, key) { return this.flags?.[moduleId]?.[key]; },
        async setFlag(moduleId, key, value) {
          this.flags[moduleId] ??= {};
          this.flags[moduleId][key] = structuredClone(value);
          return value;
        },
        async update() { return this; }
      };
      journals.set(createdJournal.id, createdJournal);
      privateStoreJournal = createdJournal;
      return createdJournal;
    }
  };

  const gm = { id: "gm-private-store-marker", isGM: true, active: true };
  game.user = gm;
  game.users = [gm];
  setSetting("privateStateJournalId", staleJournal.id);

  assert.equal(await TavernPrivateStore.initialize(), true);
  assert.equal(staleJournal.updates, 0);
  assert.deepEqual(staleJournal.ownership, { default: 2, "player-explicit": 2 });
  assert.equal(createdJournal?.getFlag("fbl-tavern-generator", "privateStateStore"), true);
  assert.equal(getSetting("privateStateJournalId"), createdJournal.id);
});

test("tavern state writes fail closed while the private store is inactive", async () => {
  setSetting("savedTaverns", [{ id: "legacy-private", name: "Legacy private tavern" }]);
  game.user = { id: "player-reset-store", isGM: false, active: true };
  game.users = [game.user];
  assert.equal(await TavernPrivateStore.initialize(), false);

  const gm = { id: "gm-fail-closed", isGM: true, active: true };
  game.user = gm;
  game.users = [gm];
  await assert.rejects(
    () => TavernState.setSavedMany([{ id: "must-not-persist", name: "Must not persist" }]),
    /Закрытое хранилище таверн недоступно/
  );
  assert.deepEqual(getSetting("savedTaverns"), [{ id: "legacy-private", name: "Legacy private tavern" }]);
});

test("partial entry edits preserve the unlimited flag", () => {
  const tavern = TavernGenerator.generate({ region: "common", quality: "modest", size: "small", terrain: "road", priceMultiplier: 1 });
  const entry = tavern.inventory.services[0] ?? tavern.inventory.food[0];
  const category = entry.type === "service" ? "services" : "food";
  entry.unlimited = true;
  entry.stock = null;
  entry.maxStock = null;

  const edited = TavernEditor.upsertEntry(tavern, category, entry.id, { name: "Исправленное название" });
  const result = TavernEditor.findEntry(edited, category, entry.id);
  assert.equal(result.unlimited, true);
  assert.equal(result.stock, null);
  assert.equal(result.maxStock, null);
});

test("price multipliers clamp malformed and extreme values", () => {
  assert.equal(TavernPricing.normalizeMultiplier(Number.NaN), 1);
  assert.equal(TavernPricing.normalizeMultiplier(-99), 0.1);
  assert.equal(TavernPricing.normalizeMultiplier(99), 5);

  const tavern = TavernGenerator.generate({ region: "common", quality: "modest", size: "small", terrain: "road", priceMultiplier: 1 });
  tavern.inventory.food[0].basePrice = 4.9;
  const repriced = TavernPricing.applyMultiplier(tavern, 99);
  assert.equal(repriced.priceMultiplier, 5);
  assert.equal(repriced.inventory.food[0].basePrice, 4);
  assert.equal(repriced.inventory.food[0].price, 20);
});

test("purchase sound categories are case-insensitive", () => {
  assert.equal(PurchaseSoundService.normalizeCategory("DRINKS"), "drinks");
  assert.equal(PurchaseSoundService.normalizeCategory(" Room "), "lodging");
});

test("adding money updates the active actor wallet source", async () => {
  setSetting("currencyMode", "auto");
  let flagWallet = { gold: 9, silver: 9, copper: 9 };
  const actor = {
    system: { currency: { gold: 1, silver: 2, copper: 3 } },
    getFlag: () => structuredClone(flagWallet),
    setFlag: async (_moduleId, _key, value) => { flagWallet = structuredClone(value); },
    update: async (changes) => {
      for (const [path, value] of Object.entries(changes)) foundry.utils.setProperty(actor, path, value);
    }
  };

  const result = await CurrencyAdapter.addMoney(actor, { silver: 1, copper: 7 });
  assert.deepEqual(result, { gold: 1, silver: 3, copper: 10 });
  assert.deepEqual(actor.system.currency, { gold: 1, silver: 3, copper: 10 });
  assert.deepEqual(flagWallet, { gold: 9, silver: 9, copper: 9 });
});

test("manual new day does not silently save an unsaved draft", async () => {
  const draft = TavernGenerator.generate({ region: "common", quality: "modest", size: "small", terrain: "road", priceMultiplier: 1 });
  setSetting("dailyInventoryRefreshEnabled", false);
  setSetting("dailyMenuRotationEnabled", false);
  setSetting("dailyAtmosphereRefreshEnabled", false);
  const store = await activatePrivateStore();
  await store.write({ current: null, saved: [] });

  const result = await TavernDailyService.advanceTavern(draft, { dayKey: "manual:unsaved", broadcast: false });
  assert.equal(result.wasCurrent, false);
  assert.equal(result.wasSaved, false);
  assert.equal(store.state.current, null);
  assert.deepEqual(store.state.saved, []);
});


test("GM can restore a linked tavern from the trusted Scene snapshot", async () => {
  const tavern = TavernGenerator.generate({ region: "common", quality: "modest", size: "small", terrain: "road", priceMultiplier: 1 });
  const publicView = TavernAtmosphereService.publicView(tavern);
  const store = await activatePrivateStore();
  await store.write({ current: null, saved: [] });

  let viewed = 0;
  const scene = {
    id: "scene-restorable-tavern",
    uuid: "Scene.scene-restorable-tavern",
    name: tavern.name,
    background: { src: "modules/fbl-tavern-generator/test.webp" },
    flags: {
      "fbl-tavern-generator": {
        tavernId: tavern.id,
        tavernPublicView: structuredClone(publicView),
        shopButton: {
          tavernId: tavern.id,
          tavernName: tavern.name,
          tavernPublicView: structuredClone(publicView)
        }
      }
    },
    getFlag(moduleId, key) { return this.flags?.[moduleId]?.[key] ?? null; },
    async view() { viewed += 1; return this; }
  };
  game.scenes = new Map([[scene.id, scene]]);

  const originalOpenSingleton = TavernPlayerApp.openSingleton;
  let openedTavern = null;
  TavernPlayerApp.openSingleton = ({ tavern: opened }) => { openedTavern = opened; return {}; };

  try {
    const result = await TavernSceneService.openTavernLink({
      tavernId: tavern.id,
      tavernName: "Поддельное имя из payload",
      sceneId: scene.id,
      sceneUuid: scene.uuid,
      tavernPublicView: { id: tavern.id, name: "Поддельная таверна", inventory: {} }
    });

    assert.equal(result.scene, scene);
    assert.equal(result.tavern.name, tavern.name);
    assert.equal(openedTavern.name, tavern.name);
    assert.equal(viewed, 1);
    const restored = TavernState.getSavedById(tavern.id);
    assert.equal(restored?.name, tavern.name);
    assert.ok(restored?.atmosphere?.mood);
    assert.ok(restored.inventory.food.every((entry) => !("crowdAvailability" in entry)));
  } finally {
    TavernPlayerApp.openSingleton = originalOpenSingleton;
  }
});

test("public scene snapshots are never authoritative purchase state", async () => {
  const tavern = TavernGenerator.generate({ region: "common", quality: "modest", size: "small", terrain: "road", priceMultiplier: 1 });
  const trustedOther = TavernGenerator.generate({ region: "flechenrand", quality: "modest", size: "small", terrain: "town", priceMultiplier: 1 });
  const publicView = TavernAtmosphereService.publicView(tavern);
  const store = await activatePrivateStore();
  await store.write({ current: trustedOther, saved: [trustedOther] });
  game.scenes = new Map([["scene-public", {
    getFlag: (_moduleId, key) => key === "tavernPublicView" ? publicView : null
  }]]);

  assert.throws(
    () => TavernState.resolveTrustedTavern({ tavernId: tavern.id, sceneId: "scene-public" }),
    /не найдена в доверенном состоянии/
  );
});


test("concurrent compendium writers keep a module-unlocked pack open until all finish", async () => {
  let releaseUnlock;
  const unlockGate = new Promise((resolve) => { releaseUnlock = resolve; });
  const calls = [];
  const pack = {
    collection: "world.concurrent-pack",
    locked: true,
    async configure({ locked }) {
      calls.push(locked);
      if (locked === false) await unlockGate;
      this.locked = locked;
    }
  };

  const first = FoundryDocumentUtils.unlockPack(pack);
  const second = FoundryDocumentUtils.unlockPack(pack);
  releaseUnlock();
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(pack.locked, false);

  assert.equal(await FoundryDocumentUtils.relockPack(pack, true), true);
  assert.equal(pack.locked, false);
  assert.equal(await FoundryDocumentUtils.relockPack(pack, true), true);
  assert.equal(pack.locked, true);
  assert.deepEqual(calls, [false, true]);
});


test("failed compendium relock remains retryable", async () => {
  let relockAttempts = 0;
  const calls = [];
  const pack = {
    collection: "world.retry-relock-pack",
    locked: true,
    async configure({ locked }) {
      calls.push(locked);
      if (locked && relockAttempts++ === 0) throw new Error("simulated relock failure");
      this.locked = locked;
    }
  };

  assert.equal(await FoundryDocumentUtils.unlockPack(pack), true);
  assert.equal(pack.locked, false);
  await assert.rejects(
    () => FoundryDocumentUtils.relockPack(pack, true),
    /simulated relock failure/
  );
  assert.equal(pack.locked, false);

  assert.equal(await FoundryDocumentUtils.relockPack(pack, true), true);
  assert.equal(pack.locked, true);
  assert.deepEqual(calls, [false, true, true]);
});

test("socket signatures survive JSON omission of undefined object properties", async () => {
  const flags = {};
  const user = {
    id: "signed-user",
    isGM: false,
    active: true,
    getFlag: (_moduleId, key) => flags[key],
    setFlag: async (_moduleId, key, value) => { flags[key] = structuredClone(value); }
  };
  game.user = user;
  game.users = { get: (id) => id === user.id ? user : null };
  setSetting("socketPrivateKey", {});

  const signed = await TavernSocketIdentity.sign({
    type: "test",
    omitted: undefined,
    nested: { kept: 1, omitted: undefined },
    array: [1, undefined]
  });
  const transported = JSON.parse(JSON.stringify(signed));
  assert.equal(await TavernSocketIdentity.verify(transported), user);

  const protoPayload = JSON.parse('{"type":"test","__proto__":{"polluted":true}}');
  const signedProto = await TavernSocketIdentity.sign(protoPayload);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(await TavernSocketIdentity.verify(JSON.parse(JSON.stringify(signedProto))), user);
  assert.equal(Object.prototype.polluted, undefined);

  await assert.rejects(() => TavernSocketIdentity.sign({ type: "test", bad: Infinity }), /non-finite/);
});


test("native Foundry socket relay delivers player purchases and targeted GM results over LAN-safe transport", async () => {
  let socketHandler = null;
  const sent = [];
  game.socket = {
    on(channel, handler) {
      assert.equal(channel, "module.fbl-tavern-generator");
      socketHandler = handler;
    },
    emit(channel, envelope) {
      assert.equal(channel, "module.fbl-tavern-generator");
      sent.push(structuredClone(envelope));
    }
  };

  const player = { id: "socket-player", name: "Player", isGM: false, active: true };
  const gm = { id: "socket-gm", name: "GM", isGM: true, active: true };
  const users = new Map([[player.id, player], [gm.id, gm]]);
  game.users = { get: (id) => users.get(id) ?? null };
  game.user = player;

  const deliveries = [];
  assert.equal(TavernSocketRelay.register((payload, user) => {
    deliveries.push({ payload: structuredClone(payload), user });
  }), true);
  assert.equal(typeof socketHandler, "function");

  await TavernSocketRelay.emit({
    type: "cart-purchase-request",
    sender: "spoofed-user",
    requestId: "purchase-1"
  }, { targetUserId: gm.id });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].senderId, player.id);
  assert.equal(sent[0].recipientId, gm.id);
  assert.equal(sent[0].payload.sender, "spoofed-user");

  // The packet is ignored by the sender and accepted by the addressed GM.
  socketHandler(structuredClone(sent[0]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(deliveries.length, 0);

  game.user = gm;
  socketHandler(structuredClone(sent[0]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].user, player);
  assert.equal(deliveries[0].payload.sender, player.id);
  assert.equal(deliveries[0].payload.requestId, "purchase-1");

  // Replaying the same packet is ignored.
  socketHandler(structuredClone(sent[0]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(deliveries.length, 1);

  await TavernSocketRelay.emit({
    type: "purchase-result",
    userId: player.id,
    requestId: "purchase-1",
    ok: true
  }, { targetUserId: player.id });
  assert.equal(sent.length, 2);
  assert.equal(sent[1].senderId, gm.id);
  assert.equal(sent[1].recipientId, player.id);

  game.user = player;
  socketHandler(structuredClone(sent[1]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(deliveries.length, 2);
  assert.equal(deliveries[1].user, gm);
  assert.equal(deliveries[1].payload.sender, gm.id);
  assert.equal(deliveries[1].payload.ok, true);
});


test("cleanliness services use Quick Access integrated wash states", async () => {
  const previousModules = game.modules;
  const previousItems = game.items;
  const previousPacks = game.packs;
  const previousFromUuid = globalThis.fromUuid;

  try {
    game.modules = new Map([["fbl-quick-access", { active: true }]]);
    game.items = [];
    game.packs = [];
    globalThis.fromUuid = async () => null;
    await game.settings.set("fbl-quick-access", "featureWash", true);
    await game.settings.set("fbl-quick-access", "washStateUuids", {});

    const actor = {
      items: [{ id: "old-wash", name: "Немытый", type: "criticalInjury" }],
      flags: {},
      createOptions: null,
      deleteOptions: null,
      async createEmbeddedDocuments(type, documents, options = {}) {
        assert.equal(type, "Item");
        this.createOptions = structuredClone(options);
        const created = documents.map((data, index) => ({
          ...structuredClone(data),
          id: `created-${index}`
        }));
        this.items.push(...created);
        return created;
      },
      async deleteEmbeddedDocuments(type, ids, options = {}) {
        assert.equal(type, "Item");
        this.deleteOptions = structuredClone(options);
        const idSet = new Set(ids);
        this.items = this.items.filter((item) => !idSet.has(item.id));
        return [];
      },
      async setFlag(moduleId, key, value) {
        this.flags[moduleId] ??= {};
        this.flags[moduleId][key] = structuredClone(value);
        return value;
      }
    };

    const result = await CleanlinessAdapter.applyFromEntry(actor, {
      name: "Горячая вода и мыло",
      cleanliness: { level: 1, state: "Помытый", label: "Помытый" }
    });

    assert.equal(result.method, "quick-access-fallback-item");
    assert.equal(result.changed, true);
    assert.equal(actor.items.some((item) => item.name === "Немытый"), false);
    assert.equal(actor.items.some((item) => item.name === "Помытый" && item.type === "criticalInjury"), true);
    assert.equal(actor.createOptions.fblqaWashTransition, true);
    assert.equal(actor.createOptions.render, false);
    assert.equal(actor.deleteOptions.fblqaWashTransition, true);
    assert.equal(actor.flags["fbl-tavern-generator"].lastCleanlinessService.resultingState, "Помытый");
  } finally {
    game.modules = previousModules;
    game.items = previousItems;
    game.packs = previousPacks;
    globalThis.fromUuid = previousFromUuid;
  }
});
