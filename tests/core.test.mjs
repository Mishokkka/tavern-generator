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
const { TavernGMApp } = await import("../scripts/apps/TavernGMApp.js");
const { TavernEntryEditorDialog } = await import("../scripts/apps/TavernEntryEditorDialog.js");
const { CalendariaAdapter } = await import("../scripts/services/CalendariaAdapter.js");
const { TavernNames } = await import("../scripts/services/TavernNames.js");
const { TavernSocket } = await import("../scripts/services/TavernSocket.js");
const { MENU_TABLE } = await import("../scripts/data/index.js");

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
  assert.deepEqual(line, { category: "lodging", entryId: "abc", quantity: 99, days: 365, quotedPrice: null });
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
  assert.deepEqual(saved.find((entry) => entry.id === untouched.id).refreshState, untouched.refreshState);
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

  const originalWrite = store.write;
  let failOnce = true;
  store.write = async (state) => {
    if (Object.values(state.purchases ?? {}).some((receipt) => receipt.status === "completed") && failOnce) {
      failOnce = false;
      throw new Error("simulated storage failure");
    }
    return originalWrite.call(store, state);
  };

  try {
    await assert.rejects(() => TavernPurchaseService.execute({
      userId: user.id,
      actorId: actor.id,
      tavernId: tavern.id,
      items: [{ category: "food", entryId: item.id, quantity: 1 }]
    }), /simulated storage failure/);
  } finally {
    store.write = originalWrite;
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

  // Sender clock skew must not prevent delivery; duplicates still expire by local arrival time.
  for (const skew of [-24 * 60 * 60 * 1000, 24 * 60 * 60 * 1000]) {
    const packet = { ...structuredClone(sent[1]), id: `clock-skew-${skew}`, sentAt: Date.now() + skew };
    const before = deliveries.length;
    socketHandler(packet);
    socketHandler(structuredClone(packet));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(deliveries.length, before + 1);
    assert.equal(deliveries.at(-1).payload.ok, true);
  }
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

async function withWashModules(quickEnabled, expandedEnabled, task) {
  const quickId = "fbl-quick-access";
  const expandedId = "forbidden-lands-expanded-conditions";
  const previous = { modules: game.modules, items: game.items, packs: game.packs, fromUuid: globalThis.fromUuid };
  const settings = [quickId, expandedId].flatMap((id) => ["featureWash", "washStateUuids"].map((key) =>
    [id, key, game.settings.get(id, key)]));
  const actor = {
    items: [], flags: {},
    async setFlag(moduleId, key, value) { (this.flags[moduleId] ??= {})[key] = structuredClone(value); },
    async createEmbeddedDocuments(_type, data) {
      const created = data.map((item) => ({ ...structuredClone(item), id: foundry.utils.randomID() }));
      this.items.push(...created);
      return created;
    },
    async deleteEmbeddedDocuments(_type, ids) { this.items = this.items.filter((item) => !ids.includes(item.id)); }
  };
  const entry = { name: "Купание", cleanliness: { level: 2, state: "Хорошенько помытый" } };
  const pack = (moduleId) => ({
    documentName: "Item", collection: `${moduleId}.wash`, metadata: { packageName: moduleId },
    getIndex: async () => [{ _id: "wash", name: entry.cleanliness.state, type: "criticalInjury" }],
    getDocument: async () => ({ type: "criticalInjury", uuid: `Compendium.${moduleId}.wash.wash`,
      toObject: () => ({ name: entry.cleanliness.state, type: "criticalInjury", system: { origin: moduleId } }) })
  });
  try {
    game.modules = new Map([[quickId, { active: true }], [expandedId, { active: true }]]);
    game.items = [];
    game.packs = [pack(quickId), pack(expandedId)];
    globalThis.fromUuid = async () => null;
    await game.settings.set(quickId, "featureWash", quickEnabled);
    await game.settings.set(expandedId, "featureWash", expandedEnabled);
    await game.settings.set(quickId, "washStateUuids", {});
    await game.settings.set(expandedId, "washStateUuids", {});
    await task({ actor, entry, quickId, expandedId });
  } finally {
    game.modules = previous.modules;
    game.items = previous.items;
    game.packs = previous.packs;
    globalThis.fromUuid = previous.fromUuid;
    for (const [id, key, value] of settings) await game.settings.set(id, key, value);
  }
}

test("disabled Quick Access wash falls through to enabled Expanded Conditions and its own pack", async () => {
  await withWashModules(false, true, async ({ actor, entry, expandedId }) => {
    const result = await CleanlinessAdapter.applyFromEntry(actor, entry);
    assert.equal(result.applied, true);
    assert.equal(result.method, "expanded-conditions-critical-injury");
    assert.equal(actor.items.length, 1);
    assert.equal(actor.items[0].system.origin, expandedId);
  });
});

test("enabled Quick Access wash prefers its own pack even when Expanded Conditions is listed first", async () => {
  await withWashModules(true, true, async ({ actor, entry, quickId }) => {
    game.packs.reverse();
    const result = await CleanlinessAdapter.applyFromEntry(actor, entry);
    assert.equal(result.method, "quick-access-critical-injury");
    assert.equal(actor.items[0].system.origin, quickId);
  });
});

test("disabled wash integrations return the disabled message without bypassing settings via legacy APIs or flags", async () => {
  await withWashModules(false, false, async ({ actor, entry, expandedId }) => {
    const previousGlobalApi = game.fblExpandedConditions;
    try {
      const api = { setWashState: () => assert.fail("Disabled integration must not apply wash") };
      game.modules.get(expandedId).api = api;
      game.fblExpandedConditions = api;
      const result = await CleanlinessAdapter.applyFromEntry(actor, entry);
      assert.equal(result.applied, false);
      assert.equal(result.method, "quick-access-wash-disabled");
      assert.equal(actor.items.length, 0);
      assert.equal(actor.flags["fbl-tavern-generator"].lastCleanlinessService.level, 2);
    } finally { game.fblExpandedConditions = previousGlobalApi; }
  });
});

// Regression cases from the October audit. Each fixture represents a normal trusted table.
async function purchaseFixture({ stock = 10, saved = true } = {}) {
  game.time.worldTime = 0;
  const store = await activatePrivateStore();
  const gm = game.user;
  const user = { id: "audit-player", name: "Игрок", active: true, isGM: false };
  const actor = makeActor({ id: "audit-actor", copper: 100 });
  actor.type = "character";
  actor.isOwner = true;
  game.users = [gm, user];
  game.users.get = (id) => game.users.find((entry) => entry.id === id);
  game.actors = [actor];
  game.actors.get = (id) => game.actors.find((entry) => entry.id === id);
  setSetting("currencyMode", "flags");
  setSetting("seasonalPricingEnabled", false);
  const tavern = TavernGenerator.generate();
  tavern.atmosphere.crowd = tavern.atmosphere.mood.crowd = 0;
  const item = tavern.inventory.food[0];
  Object.assign(item, { price: 5, basePrice: 5, stock, maxStock: stock, unlimited: false });
  await store.write({ current: tavern, saved: saved ? [tavern] : [] });
  setSetting("currentTavern", TavernAtmosphereService.publicView(tavern));
  const request = { userId: user.id, actorId: actor.id, tavernId: tavern.id,
    requestId: "audit-request", expectedTotal: 5,
    items: [{ category: "food", entryId: item.id, quantity: 1, unitPrice: 5 }] };
  return { store, gm, user, actor, tavern, item, request };
}

test("parallel saves of different taverns retain both records", async () => {
  const store = await activatePrivateStore();
  await store.write({ current: null, saved: [] });
  const a = TavernGenerator.generate();
  const b = TavernGenerator.generate();
  await Promise.all([TavernState.saveTavern(a), TavernState.saveTavern(b)]);
  assert.deepEqual(new Set(TavernState.getSaved().map((t) => t.id)), new Set([a.id, b.id]));
});

test("purchase and stale GM save cannot overwrite each other", async () => {
  const { actor, tavern, request } = await purchaseFixture();
  let releaseWallet, signalWallet;
  const walletStarted = new Promise((resolve) => { signalWallet = resolve; });
  const walletGate = new Promise((resolve) => { releaseWallet = resolve; });
  const originalSet = actor.setFlag;
  actor.setFlag = async (...args) => { signalWallet(); await walletGate; return originalSet(...args); };
  const purchase = TavernPurchaseService.execute(request);
  await walletStarted;
  const staleSave = assert.rejects(TavernState.saveTavern({ ...tavern, name: "Старый черновик" }), /уже изменена/);
  releaseWallet();
  await Promise.all([purchase, staleSave]);
  assert.equal(actor.wallet().copper, 95);
  assert.equal(TavernState.getCurrent().inventory.food[0].stock, 9);
  assert.deepEqual(TavernState.getCurrent(), TavernState.getSavedById(tavern.id));
});

test("two simultaneous buyers cannot buy the last portion twice", async () => {
  const { request, actor } = await purchaseFixture({ stock: 1 });
  const results = await Promise.allSettled([
    TavernPurchaseService.execute(request),
    TavernPurchaseService.execute({ ...request, requestId: "second-buyer" })
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(actor.wallet().copper, 95);
  assert.equal(TavernState.getCurrent().inventory.food[0].stock, 0);
});

test("purchase receipt survives GM reload and returns without a second charge", async () => {
  const { request, actor } = await purchaseFixture();
  await TavernPurchaseService.execute(request);
  await TavernPrivateStore.initialize();
  const replay = await TavernPurchaseService.execute(request);
  assert.equal(replay.replayed, true);
  assert.equal(replay.total, 5);
  assert.equal(actor.wallet().copper, 95);
  assert.equal(TavernState.getCurrent().inventory.food[0].stock, 9);
  await assert.rejects(TavernPurchaseService.execute({ ...request, actorId: actor.id,
    items: [{ ...request.items[0], quantity: 2 }] }), /другой корзины/);
});

test("concurrent copies of the same request commit once", async () => {
  const { request, actor } = await purchaseFixture();
  const results = await Promise.all([TavernPurchaseService.execute(request), TavernPurchaseService.execute(request)]);
  assert.equal(results.filter((r) => r.replayed).length, 1);
  assert.equal(actor.wallet().copper, 95);
});

test("old price and changed total are rejected before any debit", async () => {
  const { request, actor, tavern } = await purchaseFixture();
  tavern.inventory.food[0].price = 50;
  await TavernState.saveTavern(tavern);
  await assert.rejects(TavernPurchaseService.execute(request), /Цена в меню изменилась/);
  await assert.rejects(TavernPurchaseService.execute({ ...request,
    items: [{ ...request.items[0], unitPrice: 50 }] }), /Сумма корзины изменилась/);
  assert.equal(actor.wallet().copper, 100);
  assert.equal(TavernState.getCurrent().inventory.food[0].stock, 10);
});

test("a failed public mirror cannot refund a committed purchase", async () => {
  const { request, actor } = await purchaseFixture();
  const originalSet = game.settings.set;
  game.settings.set = async () => { throw new Error("public mirror offline"); };
  try { await TavernPurchaseService.execute(request); }
  finally { game.settings.set = originalSet; }
  assert.equal(actor.wallet().copper, 95);
  assert.equal(TavernState.getCurrent().inventory.food[0].stock, 9);
  assert.equal((await TavernPurchaseService.execute(request)).replayed, true);
});

test("incomplete rollback stays pending and cannot charge again", async () => {
  const { request, actor } = await purchaseFixture();
  const originalPersist = TavernState.persistPurchaseTavern;
  const originalRestore = CurrencyAdapter.restore;
  TavernState.persistPurchaseTavern = async () => { throw new Error("journal offline"); };
  CurrencyAdapter.restore = async () => { throw new Error("wallet offline"); };
  try { await assert.rejects(TavernPurchaseService.execute(request), /Откат выполнен не полностью/); }
  finally { TavernState.persistPurchaseTavern = originalPersist; CurrencyAdapter.restore = originalRestore; }
  await TavernPrivateStore.initialize();
  await assert.rejects(TavernPurchaseService.execute(request), /Повторное списание остановлено/);
  await assert.rejects(TavernPurchaseService.execute({ ...request, requestId: "new-id-after-reload" }), /Повторное списание остановлено/);
  assert.equal(actor.wallet().copper, 95);
  const [pending] = TavernState.pendingPurchases();
  assert.equal(pending.actorId, actor.id);
  // GM checks the world and refunds manually, then records that decision.
  await CurrencyAdapter.restore(actor, pending.walletBefore);
  await TavernState.resolvePendingPurchase(pending.id, "cancelled");
  await assert.rejects(TavernPurchaseService.execute(request), /отменена ГМом/);
  assert.equal(actor.wallet().copper, 100);
  assert.deepEqual(TavernState.pendingPurchases(), []);
});

test("switching taverns clears the cart but preserves a pending checkout", async () => {
  const { tavern } = await purchaseFixture();
  const other = TavernGenerator.generate();
  const app = new TavernPlayerApp({ tavern });
  const item = { key: "food:x", category: "food", entryId: "x", quantity: 1, unitPrice: 5 };
  app.cart = [item];
  app.activeRequestId = "pending";
  assert.equal(app.setTavern(other), false);
  assert.equal(app.tavernOverride.id, tavern.id);
  assert.equal(app.cart.length, 1);
  app.activeRequestId = null;
  assert.equal(app.setTavern(other), true);
  assert.deepEqual(app.cart, []);
  assert.equal(app.cartTavernId, other.id);
});

test("cart refresh reprices retained entries and removes deleted menu entries", async () => {
  const { tavern, item } = await purchaseFixture();
  const app = new TavernPlayerApp({ tavern });
  app.cart = [{ key: `food:${item.id}`, category: "food", entryId: item.id, quantity: 1, unitPrice: 5 },
    { key: "food:deleted", category: "food", entryId: "deleted", quantity: 1, unitPrice: 7 }];
  tavern.inventory.food[0].price = 50;
  app.setTavern(tavern);
  assert.equal(app.cart.length, 1);
  assert.equal(app.cart[0].unitPrice, 50);
  assert.equal(app.cartContext().total, 50);
});

function bookedTavern(days = 10) {
  const tavern = TavernGenerator.generate();
  tavern.inventory.lodging = [{ id: "one-room", name: "Комната", type: "room", price: 5, basePrice: 5,
    total: 1, stock: 1, maxStock: 1, occupied: 0, unlimited: false }];
  return TavernState.purchaseEntryInData(tavern, "lodging", "one-room", { days }).tavern;
}

test("calendar catches up five days and ignores duplicate/backward dates", () => {
  game.time.worldTime = 0;
  for (const setting of ["dailyInventoryRefreshEnabled", "dailyMenuRotationEnabled", "dailyAtmosphereRefreshEnabled"]) setSetting(setting, false);
  const tavern = bookedTavern();
  const first = TavernDailyService.refreshTavernForNewDay(tavern, { dayKey: "world:5" });
  assert.equal(first.tavern.lodgingBookings[0].remainingDays, 5);
  for (const dayKey of ["world:5", "world:2", "world:5"]) {
    const repeat = TavernDailyService.refreshTavernForNewDay(first.tavern, { dayKey });
    assert.equal(repeat.changed, false);
    assert.equal(repeat.tavern.lodgingBookings[0].remainingDays, 5);
  }
  const expired = TavernDailyService.refreshTavernForNewDay(first.tavern, { dayKey: "world:11" });
  assert.equal(expired.expired.length, 1);
  assert.equal(expired.tavern.lodgingBookings.length, 0);
  assert.equal(expired.tavern.inventory.lodging[0].stock, 1);
});

test("calendar changes rebase the clock without expiring bookings", () => {
  const tavern = bookedTavern();
  const next = TavernDailyService.refreshTavernForNewDay(tavern, { dayKey: "new-calendar:500",
    dayInfo: { ordinal: 500, clockId: "new-calendar" } });
  assert.equal(next.tavern.lodgingBookings[0].remainingDays, 10);
  assert.equal(next.tavern.refreshState.lastDayOrdinal, 500);
});

test("new day counts expirations in an active unsaved tavern", async () => {
  const store = await activatePrivateStore();
  const tavern = bookedTavern(1);
  await store.write({ current: tavern, saved: [] });
  const result = await TavernDailyService.advanceDay();
  assert.equal(result.expired, 1);
  assert.equal(result.current.lodgingBookings.length, 0);
  assert.deepEqual(TavernState.getSaved(), []);
});

test("repeated calendar hooks serialize and advance each tavern only once", async () => {
  const store = await activatePrivateStore();
  game.time.worldTime = 0;
  const tavern = bookedTavern();
  await store.write({ current: tavern, saved: [tavern] });
  setSetting("calendariaIntegrationEnabled", true);
  setSetting("lastDailyRefreshKey", "world:0");
  game.time.worldTime = 5 * 86400;
  try { await Promise.all([TavernDailyService.handlePossibleDayChange(), TavernDailyService.handlePossibleDayChange()]); }
  finally { setSetting("calendariaIntegrationEnabled", false); game.time.worldTime = 0; }
  assert.equal(TavernState.getCurrent().lodgingBookings[0].remainingDays, 5);
  assert.deepEqual(TavernState.getCurrent(), TavernState.getSavedById(tavern.id));
});

test("API new day anchors saved and unsaved taverns before a delayed Calendaria hook", async () => {
  const store = await activatePrivateStore();
  const originalDateInfo = CalendariaAdapter.currentDateInfo;
  const originalAtmosphereSetting = getSetting("dailyAtmosphereRefreshEnabled");
  const originalCalendarSetting = getSetting("calendariaIntegrationEnabled");
  const originalRefreshKey = getSetting("lastDailyRefreshKey");
  let day = 0;
  CalendariaAdapter.currentDateInfo = () => ({ key: `calendar:${day}`, ordinal: day, clockId: "calendaria:review" });
  try {
    setSetting("calendariaIntegrationEnabled", true);
    setSetting("dailyAtmosphereRefreshEnabled", true);
    for (const saveCurrent of [true, false]) {
      day = 0;
      const current = bookedTavern(10);
      const other = bookedTavern(10);
      await store.write({ current, saved: saveCurrent ? [current, other] : [other] });
      setSetting("lastDailyRefreshKey", "calendar:0");
      day = 5;
      const result = await TavernDailyService.advanceDay({ reason: "api" });
      assert.equal(result.current.lodgingBookings[0].remainingDays, 9);
      assert.equal(TavernState.getSavedById(other.id).lodgingBookings[0].remainingDays, 9);
      assert.equal(result.current.refreshState.lastDayOrdinal, 5);
      assert.equal(result.current.refreshState.lastDayKey, "calendar:5");
      assert.equal(result.current.refreshState.clockId, "calendaria:review");
      const beforeHook = store.state;
      const repeat = await TavernDailyService.handlePossibleDayChange();
      assert.equal(repeat.changed, 0);
      assert.deepEqual(store.state, beforeHook);
      day = 6;
      await TavernDailyService.handlePossibleDayChange();
      assert.equal(TavernState.getCurrent().lodgingBookings[0].remainingDays, 8);
      assert.equal(TavernState.getSavedById(other.id).lodgingBookings[0].remainingDays, 8);
      if (saveCurrent) assert.deepEqual(TavernState.getCurrent(), TavernState.getSavedById(current.id));
    }
  } finally {
    CalendariaAdapter.currentDateInfo = originalDateInfo;
    setSetting("dailyAtmosphereRefreshEnabled", originalAtmosphereSetting);
    setSetting("calendariaIntegrationEnabled", originalCalendarSetting);
    setSetting("lastDailyRefreshKey", originalRefreshKey);
  }
});

test("manual new day anchors only the selected tavern and still allows another manual day", async () => {
  const store = await activatePrivateStore();
  const originalWorldTime = game.time.worldTime;
  game.time.worldTime = 0;
  const current = bookedTavern(10);
  const other = bookedTavern(10);
  await store.write({ current, saved: [current, other] });
  try {
    game.time.worldTime = 5 * 86400;
    const first = await TavernDailyService.advanceTavern(current, { dayKey: "manual:first", broadcast: false });
    assert.equal(first.tavern.lodgingBookings[0].remainingDays, 9);
    assert.equal(first.tavern.refreshState.lastDayOrdinal, 5);
    assert.equal(first.tavern.refreshState.clockId, "world");
    assert.equal(TavernDailyService.refreshTavernForNewDay(first.tavern, { dayKey: "world:5" }).changed, false);
    const second = await TavernDailyService.advanceTavern(first.tavern, { dayKey: "manual:second", broadcast: false });
    assert.equal(second.tavern.lodgingBookings[0].remainingDays, 8);
    assert.equal(second.tavern.refreshState.lastDayOrdinal, 5);
    assert.deepEqual(TavernState.getSavedById(other.id), other);
  } finally { game.time.worldTime = originalWorldTime; }
});

test("API new day preserves the calendar watermark when the clock moves backwards", () => {
  const originalWorldTime = game.time.worldTime;
  try {
    game.time.worldTime = 5 * 86400;
    const tavern = bookedTavern(10);
    game.time.worldTime = 2 * 86400;
    const manual = TavernDailyService.refreshTavernForNewDay(tavern, { reason: "api" }).tavern;
    assert.equal(manual.lodgingBookings[0].remainingDays, 9);
    assert.equal(manual.refreshState.lastDayOrdinal, 5);
    assert.equal(TavernDailyService.refreshTavernForNewDay(manual, { dayKey: "world:5" }).changed, false);
    const next = TavernDailyService.refreshTavernForNewDay(manual, { dayKey: "world:6" }).tavern;
    assert.equal(next.lodgingBookings[0].remainingDays, 8);
  } finally { game.time.worldTime = originalWorldTime; }
});

test("Calendaria 1.0.11 API and dayChange payload agree on date, season and custom day length", () => {
  const calendar = { id: "custom", years: { yearZero: 100 }, days: { hoursPerDay: 10, minutesPerHour: 60, secondsPerMinute: 60 },
    seasonsArray: [{ name: "Зарость" }],
    componentsToTime: ({ year, month, dayOfMonth }) => (year * 360 + month * 30 + dayOfMonth) * 36000 };
  globalThis.CALENDARIA = { managers: { CalendarManager: { getActiveCalendar: () => calendar } },
    api: { getCurrentDateTime: () => ({ year: 101, month: 2, day: 6 }), getCurrentSeason: () => ({ name: "Зарость" }) } };
  try {
    const api = CalendariaAdapter.currentDateInfo();
    const hook = CalendariaAdapter.currentDateInfo({ args: [{
      previous: { year: 101, month: 1, dayOfMonth: 0, season: 0 },
      current: { year: 101, month: 1, dayOfMonth: 5, season: 0 }, calendar }] });
    assert.equal(api.key, hook.key);
    assert.equal(api.ordinal, 395);
    assert.equal(hook.ordinal - hook.previousOrdinal, 5);
    assert.equal(hook.seasonKey, "zarost");
    assert.equal(api.seasonKey, "zarost");
  } finally { delete globalThis.CALENDARIA; }
});

test("zero restock capacity stays zero across daily refresh and manual restock", () => {
  const tavern = TavernGenerator.generate();
  const entry = tavern.inventory.food[0];
  Object.assign(entry, { stock: 0, maxStock: 0, unlimited: false });
  setSetting("dailyInventoryRefreshEnabled", true);
  setSetting("dailyMenuRotationEnabled", false);
  try {
    const next = TavernDailyService.refreshTavernForNewDay(tavern).tavern;
    assert.equal(next.inventory.food[0].stock, 0);
    assert.equal(next.inventory.food[0].maxStock, 0);
    assert.equal(TavernEditor.restockAll(next).inventory.food[0].stock, 0);
  } finally { setSetting("dailyInventoryRefreshEnabled", false); }
});

test("room editing and deletion respect paid reservations", () => {
  const tavern = bookedTavern();
  assert.throws(() => TavernEditor.updateLodgingEntry(tavern, "one-room", { stock: 1 }), /Уже оплачено/);
  assert.throws(() => TavernEditor.upsertEntry(tavern, "lodging", "one-room", { total: 0, stock: 0 }), /Уже оплачено/);
  assert.throws(() => TavernEditor.removeEntry(tavern, "lodging", "one-room"), /действующими бронями/);
  assert.throws(() => TavernEditor.updateLodgingEntry(tavern, "one-room", { unlimited: true }), /действующими бронями/);
  const expanded = TavernEditor.updateLodgingEntry(tavern, "one-room", { total: 2, stock: 1 });
  const bought = TavernState.purchaseEntryInData(expanded, "lodging", "one-room");
  assert.equal(bought.tavern.lodgingBookings.length, 2);
  assert.equal(bought.tavern.inventory.lodging[0].stock, 0);
});

test("legacy inconsistent room stock cannot resell an occupied bed", () => {
  const tavern = bookedTavern();
  tavern.inventory.lodging[0].stock = 1;
  const migrated = TavernMigrations.migrate(tavern);
  assert.equal(migrated.inventory.lodging[0].stock, 0);
  assert.equal(migrated.inventory.lodging[0].occupied, 1);
  assert.throws(() => TavernState.purchaseEntryInData(migrated, "lodging", "one-room"), /нет нужного количества/);
});

test("editor can lower a non-room restock capacity to zero", () => {
  const tavern = TavernGenerator.generate();
  const next = TavernEditor.upsertEntry(tavern, "food", tavern.inventory.food[0].id, { stock: 0, maxStock: 0 });
  assert.equal(TavernEditor.restockAll(next).inventory.food[0].stock, 0);
});

test("generated seasonal products retain their price rules", () => {
  const sources = new Map(MENU_TABLE.filter((entry) => entry.seasonal).map((entry) => [entry.name, entry.seasonal]));
  let matched = 0;
  const random = Math.random;
  let seed = 918273;
  Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  try {
    for (let i = 0; i < 500; i++) {
      const tavern = TavernGenerator.generate();
      for (const entry of [...tavern.inventory.food, ...tavern.inventory.drinks]) {
        if (!sources.has(entry.name)) continue;
        matched++;
        assert.deepEqual(entry.seasonal, sources.get(entry.name));
      }
    }
  } finally { Math.random = random; }
  assert.ok(matched > 0);
});

test("private atmosphere seed is preserved privately and absent from public copies", () => {
  const tavern = TavernGenerator.generate();
  const publicView = TavernAtmosphereService.publicView(tavern);
  assert.ok(tavern.atmosphereSeed);
  assert.equal("atmosphereSeed" in publicView, false);
  assert.equal(TavernAtmosphereService.advanceDay(tavern).atmosphereSeed, tavern.atmosphereSeed);
  assert.notEqual(TavernAtmosphereService.ensure(publicView).atmosphereSeed, tavern.atmosphereSeed);
});

test("Russian procedural names keep terrain out of adjective noun pairs", () => {
  const random = Math.random;
  try {
    Math.random = () => 0.999;
    for (const terrain of Object.keys(TAVERN_OPTIONS.terrains)) {
      assert.equal(TavernNames.generate("common", terrain), "Двор ночного угля");
    }
    const sequence = [0.9, 0.85, 0.0, 0.0, 0.0];
    Math.random = () => sequence.shift() ?? 0;
    assert.equal(TavernNames.generate("common", "road"), "Трактир у ворона");
  } finally { Math.random = random; }
});

test("late day-change event does not age a booking purchased after the time jump", () => {
  game.time.worldTime = 0;
  const tavern = TavernGenerator.generate();
  tavern.inventory.lodging = [{ id: "late-room", name: "Комната", type: "room", price: 5, stock: 1, total: 1, unlimited: false }];
  game.time.worldTime = 5 * 86400;
  try {
    const purchased = TavernState.purchaseEntryInData(tavern, "lodging", "late-room", { days: 3 }).tavern;
    const updated = TavernDailyService.refreshTavernForNewDay(purchased, { dayKey: "world:5" }).tavern;
    assert.equal(updated.lodgingBookings[0].remainingDays, 3);
    const tomorrow = TavernDailyService.refreshTavernForNewDay(updated, { dayKey: "world:6" }).tavern;
    assert.equal(tomorrow.lodgingBookings[0].remainingDays, 2);
  } finally { game.time.worldTime = 0; }
});

async function gmButtons(tavern, { savedTavernId = null } = {}) {
  const app = new TavernGMApp({ tavern });
  const listeners = new Map();
  const buttons = new Map();
  const button = (selector) => {
    if (!buttons.has(selector)) buttons.set(selector, { dataset: {}, addEventListener: (type, callback) => { listeners.set(`${selector}:${type}`, callback); } });
    return buttons.get(selector);
  };
  app.render = () => app;
  app.element = {
    querySelectorAll: (selector) => selector.startsWith("[data-action=") ? [button(selector)] : [],
    querySelector: (selector) => {
      if (selector === "select[name='savedTavernId']") return { value: savedTavernId };
      if (selector === "[name='draftPricePercent']") return { value: "200" };
      if (!selector.startsWith("[data-action=")) return null;
      return button(selector);
    }
  };
  await app._onRender();
  return { app, click: (action, dataset = {}) => {
    const selector = `[data-action='${action}']`;
    const currentTarget = button(selector);
    Object.assign(currentTarget.dataset, dataset);
    return listeners.get(`${selector}:click`)({ preventDefault() {}, currentTarget });
  } };
}

test("GM undo reverses its own edit when no purchase intervened", async () => {
  const { tavern } = await purchaseFixture();
  const { app, click } = await gmButtons(tavern);
  try {
    await click("applyPriceModifier");
    assert.equal(TavernState.getCurrent().inventory.food[0].price, 10);
    await click("undo");
    assert.equal(TavernState.getCurrent().inventory.food[0].price, 5);
    assert.equal(TavernState.getCurrent().inventory.food[0].stock, 10);
  } finally { await app._onClose(); }
});

test("GM undo cannot rewind an intervening purchase", async () => {
  const { tavern, request, actor } = await purchaseFixture();
  const { app, click } = await gmButtons(tavern);
  try {
    await click("applyPriceModifier");
    await TavernPurchaseService.execute({ ...request, expectedTotal: 10, items: [{ ...request.items[0], unitPrice: 10 }] });
    await click("undo");
    assert.equal(TavernState.getCurrent().inventory.food[0].stock, 9);
    assert.equal(TavernState.getCurrent().inventory.food[0].price, 10);
    assert.equal(actor.wallet().copper, 90);
    assert.equal(app.undoDraft, null);
  } finally { await app._onClose(); }
});

test("GM undo and redo across taverns use each tavern's revision and form parameters", async () => {
  const { tavern } = await purchaseFixture();
  const other = await TavernState.saveTavern(TavernGenerator.generate({ region: "boltrask", quality: "rich" }));
  const { app, click } = await gmButtons(tavern, { savedTavernId: other.id });
  try {
    await click("applyPriceModifier");
    await click("applyPriceModifier");
    const edited = structuredClone(app.draft);
    assert.notEqual(edited.storageRevision, other.storageRevision);
    await app.loadSavedTavern(other.id);
    assert.equal(app.draft.id, other.id);
    await click("undo");
    assert.equal(app.draft.id, edited.id);
    assert.equal(app.draft.storageRevision, edited.storageRevision);
    assert.equal(app.activeTavernId, edited.id);
    assert.equal(app.params.priceMultiplier, edited.priceMultiplier);
    assert.equal(TavernState.getCurrent().storageRevision, edited.storageRevision);
    await click("undo");
    assert.equal(app.draft.id, other.id);
    assert.equal(app.activeTavernId, null);
    assert.equal(app.params.region, other.region);
    assert.equal(app.params.priceMultiplier, other.priceMultiplier);
  } finally { await app._onClose(); }
});

test("GM undo of a tavern switch displays purchases made while the old tavern was hidden", async () => {
  const { tavern, request, actor } = await purchaseFixture();
  const other = await TavernState.saveTavern(TavernGenerator.generate());
  const { app, click } = await gmButtons(tavern, { savedTavernId: other.id });
  try {
    await app.loadSavedTavern(other.id);
    await TavernPurchaseService.execute(request);
    await click("undo");
    assert.equal(app.draft.id, tavern.id);
    assert.equal(app.draft.inventory.food[0].stock, 9);
    assert.equal(app.draft.storageRevision, TavernState.getCurrent().storageRevision);
    assert.equal(actor.wallet().copper, 95);
    assert.equal(TavernState.getCurrent().inventory.food[0].stock, 9);
  } finally { await app._onClose(); }
});

test("GM synchronizes a purchase refresh deferred by a cancelled dialog", async () => {
  const { tavern, request } = await purchaseFixture();
  const { app, click } = await gmButtons(tavern);
  const originalConfirm = foundry.applications.api.DialogV2.confirm;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let pending;
  try {
    app.rendered = true;
    foundry.applications.api.DialogV2.confirm = () => gate;
    pending = click("clear");
    assert.equal(app.actionPending, true);
    await TavernPurchaseService.execute(request);
    TavernGMApp.renderOpenInstances({ syncCurrent: true });
    assert.equal(app.draft.inventory.food[0].stock, 10);
    release(false);
    await pending;
    assert.equal(app.actionPending, false);
    assert.equal(app.draft.inventory.food[0].stock, 9);
    assert.equal(app.draft.storageRevision, TavernState.getCurrent().storageRevision);
  } finally {
    release(false);
    await pending;
    foundry.applications.api.DialogV2.confirm = originalConfirm;
    await app._onClose();
  }
});

test("GM deferred refresh does not overwrite an intentionally changed local draft", async () => {
  const { tavern, request } = await purchaseFixture();
  const { app, click } = await gmButtons(tavern);
  const originalConfirm = foundry.applications.api.DialogV2.confirm;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let pending;
  try {
    app.rendered = true;
    foundry.applications.api.DialogV2.confirm = () => gate;
    pending = click("clear");
    app.draft.name = "Несохранённый черновик";
    await TavernPurchaseService.execute(request);
    TavernGMApp.renderOpenInstances({ syncCurrent: true });
    release(false);
    await pending;
    assert.equal(app.draft.name, "Несохранённый черновик");
    assert.equal(TavernState.getCurrent().inventory.food[0].stock, 9);
  } finally {
    release(false);
    await pending;
    foundry.applications.api.DialogV2.confirm = originalConfirm;
    await app._onClose();
  }
});

test("restoring a deleted private tavern accepts the revision carried by its scene snapshot", async () => {
  const store = await activatePrivateStore();
  await store.write({ current: null, saved: [] });
  const restored = TavernGenerator.generate();
  restored.storageRevision = 7;
  const saved = await TavernState.saveTavern(restored);
  assert.equal(saved.storageRevision, 1);
  assert.equal(TavernState.getSavedById(restored.id).name, restored.name);
});

test("scene link imports only the archive associated with the saved tavern", async () => {
  const { tavern, store } = await purchaseFixture();
  tavern.scene = { id: "missing-scene", compendium: { pack: "world.trusted-scenes", id: "correct" } };
  await store.write({ current: tavern, saved: [tavern] });
  const scene = { id: "restored-scene", uuid: "Scene.restored-scene", name: "Восстановленная таверна", background: {},
    flags: { "fbl-tavern-generator": { tavernId: tavern.id } },
    getFlag(moduleId, key) { return this.flags?.[moduleId]?.[key]; }, toObject() { return { flags: this.flags }; }, async view() {} };
  const reads = [];
  const trusted = { collection: "world.trusted-scenes", getDocument: async (id) => { reads.push(id); return scene; } };
  game.packs = new Map([[trusted.collection, trusted], ["world.unrelated", { getDocument: async () => { throw new Error("Wrong pack"); } }]]);
  game.scenes = new Map();
  game.scenes.importFromCompendium = async (pack, id) => { assert.equal(pack, trusted); assert.equal(id, "correct"); return scene; };
  const originalOpen = TavernPlayerApp.openSingleton;
  TavernPlayerApp.openSingleton = () => ({});
  try {
    const result = await TavernSceneService.openTavernLink({ tavernId: tavern.id,
      compendium: { pack: "world.unrelated", id: "wrong" } });
    assert.deepEqual(reads, ["correct"]);
    assert.equal(result.tavern.scene.compendium.pack, trusted.collection);
  } finally { TavernPlayerApp.openSingleton = originalOpen; game.scenes = new Map(); }
});

test("seasonal price matches the amount accepted by checkout", async () => {
  const { tavern, item, actor, request, store } = await purchaseFixture();
  item.seasonal = { seasons: ["zarost"], inSeason: 0.8, outOfSeason: 1.4 };
  await store.write({ current: tavern, saved: [tavern] });
  setSetting("seasonalPricingEnabled", true);
  globalThis.CALENDARIA = { api: { getCurrentDateTime: () => ({ year: 1, month: 1, day: 1 }), getCurrentSeason: () => ({ name: "Зарость" }) } };
  try {
    const displayed = TavernGenerator.decoratePrices(TavernAtmosphereService.publicView(tavern)).inventory.food[0].price;
    assert.equal(displayed, 4);
    const receipt = await TavernPurchaseService.execute({ ...request, expectedTotal: displayed,
      items: [{ ...request.items[0], unitPrice: displayed }] });
    assert.equal(receipt.total, 4);
    assert.equal(actor.wallet().copper, 96);
  } finally { delete globalThis.CALENDARIA; setSetting("seasonalPricingEnabled", false); }
});

test("ambiguous purchase result keeps the player's original request for reconciliation", async () => {
  const { tavern, item } = await purchaseFixture();
  const proto = foundry.applications.api.ApplicationV2.prototype;
  const originalRender = proto.render;
  proto.render = function () { return this; };
  let app;
  try {
    app = TavernPlayerApp.openSingleton({ tavern });
    app.cart = [{ key: `food:${item.id}`, category: "food", entryId: item.id, quantity: 1, unitPrice: 5 }];
    app.activeRequestId = "ambiguous";
    app.checkoutPending = true;
    app.checkoutSnapshots.set("ambiguous", { tavernId: tavern.id, items: structuredClone(app.cart) });
    assert.equal(TavernPlayerApp.receivePurchaseResult({ requestId: "ambiguous", cart: true, ok: false, pending: true }), true);
    assert.equal(app.activeRequestId, "ambiguous");
    assert.equal(app.checkoutPending, false);
    assert.ok(app.checkoutSnapshots.has("ambiguous"));
    assert.equal(TavernPlayerApp.receivePurchaseResult({ requestId: "ambiguous", cart: true, ok: true }), true);
    assert.equal(app.activeRequestId, null);
    assert.deepEqual(app.cart, []);
    assert.equal(TavernPlayerApp.receivePurchaseResult({ requestId: "ambiguous", cart: true, ok: true }), false);
  } finally { if (app?.checkoutTimer) clearTimeout(app.checkoutTimer); proto.render = originalRender; }
});

async function tavernControls(tavern, { tab = "menu" } = {}) {
  const app = new TavernPlayerApp({ tavern, followCurrent: false, tab });
  const actions = ["newDay", "rerollMood", "regenerateAtmosphere", "applyCrowdAvailability", "toggleLifePinned", "sendLifeEntry"];
  const buttons = new Map();
  for (const action of actions) {
    buttons.set(action, { dataset: { gmAction: action }, addEventListener(type, handler) { this[type] = handler; } });
  }
  const tabs = ["menu", "life"].map((tab) => ({ dataset: { tab }, addEventListener(type, handler) { this[type] = handler; } }));
  app.render = () => app;
  app.element = {
    querySelector: () => null,
    querySelectorAll: (selector) => selector === "[data-gm-action]" ? [...buttons.values()]
      : selector === "[data-action='select-tab']" ? tabs : []
  };
  await app._onRender();
  return {
    app,
    click: (action, dataset = {}) => {
      const button = buttons.get(action);
      Object.assign(button.dataset, dataset);
      return button.click({ preventDefault() {}, currentTarget: button });
    },
    tab: (name) => { const button = tabs.find((tab) => tab.dataset.tab === name); button.click({ preventDefault() {}, currentTarget: button }); }
  };
}

test("tavern window has private life context for the GM but no secrets or GM actions for players", async () => {
  const { tavern, user, store } = await purchaseFixture();
  tavern.atmosphere.rumors[0].gmText = "PRIVATE-LIFE-SECRET";
  await store.write({ current: tavern, saved: [tavern] });
  const { app, click, tab } = await tavernControls(TavernAtmosphereService.publicView(tavern));
  try {
    tab("life");
    const gmContext = await app._prepareContext();
    assert.equal(gmContext.tabs.life.active, true);
    assert.equal(gmContext.lifeTavern.atmosphere.rumors[0].gmText, "PRIVATE-LIFE-SECRET");
    assert.equal(gmContext.tavern.atmosphere, undefined);
    game.user = user;
    const playerContext = await app._prepareContext();
    assert.equal(playerContext.tabs.menu.active, true);
    assert.equal(playerContext.lifeTavern, null);
    assert.equal(JSON.stringify(playerContext).includes("PRIVATE-LIFE-SECRET"), false);
    tab("life");
    assert.equal(app.activeTab, "menu");
    const before = store.state;
    await click("newDay");
    await click("rerollMood");
    assert.deepEqual(store.state, before);
  } finally { await app._onClose(); }
});

test("tavern new day updates the displayed saved tavern and broadcasts even when another is active", async () => {
  const { store, tavern: active } = await purchaseFixture();
  const selected = bookedTavern(1);
  selected.inventory.food[0].maxStock = 0;
  selected.inventory.food[0].stock = 0;
  await store.write({ current: active, saved: [active, selected] });
  const refresh = TavernSocket.refreshAll;
  const sent = [];
  TavernSocket.refreshAll = (tavern) => sent.push(tavern);
  const { app, click } = await tavernControls(selected, { tab: "life" });
  try {
    await click("newDay");
    assert.equal(TavernState.getSavedById(selected.id).lodgingBookings.length, 0);
    assert.equal(TavernState.getSavedById(selected.id).inventory.lodging[0].stock, 1);
    assert.deepEqual(TavernState.getCurrent(), active);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].id, selected.id);
    assert.equal(app.tavernOverride.id, selected.id);
    assert.equal(app.activeTab, "life");
    assert.equal(app.gmActionPending, false);
    assert.equal(app.tavernOverride.inventory.food[0].maxStock, 0);
  } finally { TavernSocket.refreshAll = refresh; await app._onClose(); }
});

test("tavern new day locks before confirmation and keeps purchases made while waiting", async () => {
  const { tavern, request, actor } = await purchaseFixture();
  const { app, click } = await tavernControls(tavern);
  const originalConfirm = foundry.applications.api.DialogV2.confirm;
  const originalMenu = getSetting("dailyMenuRotationEnabled");
  setSetting("dailyMenuRotationEnabled", false);
  let release, confirmations = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  foundry.applications.api.DialogV2.confirm = () => { confirmations += 1; return gate; };
  let pending;
  try {
    pending = click("newDay");
    await click("newDay");
    assert.equal(confirmations, 1);
    assert.equal(app.gmActionPending, true);
    await TavernPurchaseService.execute(request);
    release(true);
    await pending;
    assert.equal(TavernState.getCurrent().inventory.food[0].stock, 9);
    assert.equal(actor.wallet().copper, 95);
    assert.equal(app.tavernOverride.storageRevision, TavernState.getCurrent().storageRevision);
    assert.equal(app.gmActionPending, false);
  } finally {
    release(false); await pending;
    foundry.applications.api.DialogV2.confirm = originalConfirm;
    setSetting("dailyMenuRotationEnabled", originalMenu);
    await app._onClose();
  }
});

test("tavern new day cancellation or a switch during confirmation changes neither tavern", async () => {
  const { tavern, store } = await purchaseFixture();
  const other = await TavernState.saveTavern(bookedTavern(2));
  const { app, click } = await tavernControls(tavern);
  const originalConfirm = foundry.applications.api.DialogV2.confirm;
  let release;
  let pending;
  try {
    const before = store.state;
    foundry.applications.api.DialogV2.confirm = async () => false;
    await click("newDay");
    assert.deepEqual(store.state, before);
    foundry.applications.api.DialogV2.confirm = () => new Promise((resolve) => { release = resolve; });
    pending = click("newDay");
    app.setTavern(other);
    release(true);
    await pending;
    assert.deepEqual(store.state, before);
    assert.equal(app.tavernOverride.id, other.id);
    assert.equal(app.gmActionPending, false);
  } finally { release?.(false); await pending; foundry.applications.api.DialogV2.confirm = originalConfirm; await app._onClose(); }
});

test("tavern new day updates an unsaved preview without adding it to storage", async () => {
  const { tavern, store } = await purchaseFixture();
  const draft = bookedTavern(2);
  const before = store.state;
  const { app, click } = await tavernControls(draft);
  try {
    await click("newDay");
    assert.equal(app.tavernOverride.lodgingBookings[0].remainingDays, 1);
    assert.deepEqual(store.state, before);
    assert.equal(TavernState.getCurrent().id, tavern.id);
  } finally { await app._onClose(); }
});

test("tavern life edits use fresh private state and survive a purchase", async () => {
  const { tavern, request } = await purchaseFixture();
  const { app, click } = await tavernControls(TavernAtmosphereService.publicView(tavern));
  try {
    await TavernPurchaseService.execute(request);
    const rumor = tavern.atmosphere.rumors[0];
    await click("toggleLifePinned", { section: "rumors", entryId: rumor.id });
    assert.equal(TavernState.getCurrent().inventory.food[0].stock, 9);
    assert.equal(TavernState.getCurrent().atmosphere.rumors[0].pinned, !rumor.pinned);
    assert.deepEqual(TavernState.getCurrent(), TavernState.getSavedById(tavern.id));
  } finally { await app._onClose(); }
});

test("tavern life does not generate private content from an orphaned public snapshot", async () => {
  await purchaseFixture();
  const orphan = TavernAtmosphereService.publicView(TavernGenerator.generate());
  const { app, click } = await tavernControls(orphan, { tab: "life" });
  try {
    assert.equal((await app._prepareContext()).lifeTavern, null);
    await click("newDay");
    await click("regenerateAtmosphere");
    assert.equal(app.tavernOverride.atmosphere, undefined);
    assert.equal(TavernState.getSavedById(orphan.id), null);
  } finally { await app._onClose(); }
});

test("tavern new day failure unlocks the control without changing bookings", async () => {
  const { store, tavern } = await purchaseFixture();
  const { app, click } = await tavernControls(tavern);
  const before = store.state;
  const write = store.write;
  store.write = async () => { throw new Error("test storage unavailable"); };
  try {
    await click("newDay");
    assert.equal(app.gmActionPending, false);
    assert.deepEqual(store.state, before);
    assert.deepEqual(app.tavernOverride, tavern);
  } finally { store.write = write; await app._onClose(); }
});

test("new day preserves pinned life content, advances atmosphere and refills stock within its limit", async () => {
  const { store } = await purchaseFixture();
  const tavern = bookedTavern(2);
  const settings = ["dailyInventoryRefreshEnabled", "dailyMenuRotationEnabled", "dailyAtmosphereRefreshEnabled"];
  const previous = settings.map(getSetting);
  tavern.inventory.food[0].pinned = true;
  tavern.inventory.food[0].stock = 0;
  tavern.inventory.food[0].maxStock = 10;
  tavern.atmosphere.rumors[0].pinned = true;
  tavern.atmosphere.regulars[0].pinned = true;
  const food = tavern.inventory.food[0], rumor = tavern.atmosphere.rumors[0], regular = tavern.atmosphere.regulars[0];
  await store.write({ current: tavern, saved: [tavern] });
  const { app, click } = await tavernControls(tavern);
  try {
    settings.forEach(key => setSetting(key, true));
    await click("newDay");
    const next = TavernState.getCurrent();
    const refilled = next.inventory.food.find(entry => entry.id === food.id);
    assert.ok(refilled.stock >= 7 && refilled.stock <= 10);
    assert.equal(next.lodgingBookings[0].remainingDays, 1);
    assert.equal(next.atmosphere.revision, tavern.atmosphere.revision + 1);
    assert.deepEqual(next.atmosphere.rumors.find(entry => entry.id === rumor.id), rumor);
    assert.deepEqual(next.atmosphere.regulars.find(entry => entry.id === regular.id), regular);
  } finally { settings.forEach((key, i) => setSetting(key, previous[i])); await app._onClose(); }
});

test("tavern draft updates synchronize its generator preview without overwriting another tavern", async () => {
  await purchaseFixture();
  const draft = bookedTavern(2);
  const { app: generator } = await gmButtons(draft);
  const { app: other } = await gmButtons(TavernGenerator.generate());
  try {
    const untouched = structuredClone(other.draft);
    const next = TavernDailyService.refreshTavernForNewDay(draft).tavern;
    TavernGMApp.receiveDraftUpdate(next);
    assert.equal(generator.draft.lodgingBookings[0].remainingDays, 1);
    assert.equal(generator.undoDraft, null);
    assert.deepEqual(other.draft, untouched);
    assert.equal(TavernState.getSavedById(draft.id), null);
  } finally { await generator._onClose(); await other._onClose(); }
});

for (const saved of [false, true]) {
  test(`deferred life updates preserve a later entry edit and new-day stock before saving a ${saved ? "saved" : "new"} tavern`, async () => {
    const { store } = await purchaseFixture();
    const draft = bookedTavern(2);
    draft.inventory.food[0].stock = 0;
    draft.inventory.food[0].maxStock = 10;
    draft.inventory.food[0].pinned = true;
    if (saved) await store.write({ current: draft, saved: [draft] });
    const { app: generator, click: edit } = await gmButtons(draft);
    const { app: tavern, click: life } = await tavernControls(draft);
    const prompt = TavernEntryEditorDialog.prompt, callAll = Hooks.callAll;
    const setting = getSetting("dailyInventoryRefreshEnabled");
    let release, pending;
    TavernEntryEditorDialog.prompt = () => new Promise((resolve) => { release = resolve; });
    Hooks.callAll = (name, data) => { if (name === "fbl-tavern-generator.tavernDraftUpdated") TavernGMApp.receiveDraftUpdate(data); };
    setSetting("dailyInventoryRefreshEnabled", true);
    try {
      const entry = draft.inventory.food[0];
      const rumor = draft.atmosphere.rumors[0];
      pending = edit("editEntry", { category: "food", entryId: entry.id });
      assert.equal(generator.actionPending, true);
      await life("toggleLifePinned", { section: "rumors", entryId: rumor.id });
      await life("newDay");
      const latest = structuredClone(tavern.tavernOverride);
      const expectedStock = latest.inventory.food.find((item) => item.id === entry.id).stock;
      assert.ok(expectedStock >= 7);
      // The editor submits the whole form, including unchanged stale stock.
      release({ ...entry, name: "Edited after the life update", basePrice: 123 });
      await pending;
      const edited = generator.draft.inventory.food.find((item) => item.id === entry.id);
      assert.equal(edited.name, "Edited after the life update");
      assert.equal(edited.basePrice, 123);
      assert.equal(edited.stock, expectedStock);
      assert.deepEqual(generator.draft.atmosphere, latest.atmosphere);
      assert.deepEqual(generator.draft.lodgingBookings, latest.lodgingBookings);
      assert.equal(generator.draft.lodgingBookings[0].remainingDays, 1);
      assert.equal(generator.pendingDraftUpdate, null);
      assert.equal(generator.undoDraft, null);
      await edit("saveDraft");
      const persisted = TavernState.getSavedById(draft.id);
      assert.deepEqual(persisted.atmosphere, latest.atmosphere);
      assert.deepEqual(persisted.lodgingBookings, latest.lodgingBookings);
      assert.equal(persisted.inventory.food.find((item) => item.id === entry.id).stock, expectedStock);
      assert.equal(persisted.inventory.food.find((item) => item.id === entry.id).name, edited.name);
    } finally {
      release?.(null); await pending;
      TavernEntryEditorDialog.prompt = prompt; Hooks.callAll = callAll;
      setSetting("dailyInventoryRefreshEnabled", setting);
      await generator._onClose(); await tavern._onClose();
    }
  });
}

for (const failed of [false, true]) {
  test(`deferred draft updates survive an entry dialog ${failed ? "failure" : "cancellation"}`, async () => {
    await purchaseFixture();
    const draft = bookedTavern(2);
    const { app, click } = await gmButtons(draft);
    const prompt = TavernEntryEditorDialog.prompt;
    let release, reject, pending;
    TavernEntryEditorDialog.prompt = () => new Promise((resolve, fail) => { release = resolve; reject = fail; });
    try {
      pending = click("editEntry", { category: "food", entryId: draft.inventory.food[0].id });
      const next = TavernDailyService.refreshTavernForNewDay(draft).tavern;
      TavernGMApp.receiveDraftUpdate(next);
      if (failed) reject(new Error("test dialog failure"));
      else release(null);
      await pending;
      assert.deepEqual(app.draft.lodgingBookings, next.lodgingBookings);
      assert.deepEqual(app.draft.atmosphere, next.atmosphere);
      assert.equal(app.actionPending, false);
      assert.equal(app.pendingDraftUpdate, null);
    } finally { release?.(null); await pending; TavernEntryEditorDialog.prompt = prompt; await app._onClose(); }
  });
}

test("a deferred update cannot replace a different generator draft", async () => {
  await purchaseFixture();
  const draft = bookedTavern(2), other = TavernGenerator.generate();
  const { app, click } = await gmButtons(draft);
  const prompt = TavernEntryEditorDialog.prompt;
  let release, pending;
  TavernEntryEditorDialog.prompt = () => new Promise((resolve) => { release = resolve; });
  try {
    pending = click("editEntry", { category: "food", entryId: draft.inventory.food[0].id });
    TavernGMApp.receiveDraftUpdate(TavernDailyService.refreshTavernForNewDay(draft).tavern);
    app.draft = structuredClone(other);
    release(null);
    await pending;
    assert.deepEqual(app.draft, other);
    assert.equal(app.pendingDraftUpdate, null);
  } finally { release?.(null); await pending; TavernEntryEditorDialog.prompt = prompt; await app._onClose(); }
});

test("reconciling a deferred update cannot change the mode of a newly booked room", async () => {
  const { store } = await purchaseFixture();
  const booked = bookedTavern(2);
  const draft = structuredClone(booked);
  draft.lodgingBookings = [];
  Object.assign(draft.inventory.lodging[0], { stock: 1, occupied: 0 });
  await store.write({ current: draft, saved: [draft] });
  const { app, click } = await gmButtons(draft);
  const prompt = TavernEntryEditorDialog.prompt;
  let release, pending;
  TavernEntryEditorDialog.prompt = () => new Promise((resolve) => { release = resolve; });
  try {
    const room = draft.inventory.lodging[0];
    pending = click("editEntry", { category: "lodging", entryId: room.id });
    const latest = await TavernState.saveTavern(booked);
    TavernGMApp.receiveDraftUpdate(latest);
    release({ ...room, unlimited: true });
    await pending;
    const persisted = TavernState.getSavedById(draft.id);
    assert.deepEqual(persisted.lodgingBookings, latest.lodgingBookings);
    assert.equal(persisted.inventory.lodging[0].unlimited, false);
    assert.equal(persisted.inventory.lodging[0].stock, 0);
    assert.equal(app.actionPending, false);
  } finally { release?.(null); await pending; TavernEntryEditorDialog.prompt = prompt; await app._onClose(); }
});

const { prepareTavernLibrary } = await import("../scripts/services/TavernLibraryView.js");
const { TavernLibraryApp } = await import("../scripts/apps/TavernLibraryApp.js");

test("library finds words across labels, normalizes ё, and bounds large pages without duplicates", () => {
  const entries = Array.from({ length: 207 }, (_, index) => ({
    id: `library-${index}`, name: `Трактир ${index}`, region: index % 2 ? "novandia" : "sangren",
    terrain: "road", updatedAt: index, inventory: {}
  }));
  entries[1].name = "Зелёный фонарь";
  const found = prepareTavernLibrary(entries, { query: "зеленый НОВАНД" });
  assert.deepEqual(found.rows.map(row => row.id), ["library-1"]);
  assert.equal(prepareTavernLibrary(entries, { region: "sangren" }).matched, 104);
  assert.equal(prepareTavernLibrary(entries, { status: "active" }, "library-1").matched, 1);
  const ids = [];
  for (let page = 1; page <= 11; page++) {
    const result = prepareTavernLibrary(entries, { page });
    assert.ok(result.rows.length <= 20);
    ids.push(...result.rows.map(row => row.id));
  }
  assert.equal(new Set(ids).size, 207);
  assert.equal(ids[0], "library-206");
  const empty = prepareTavernLibrary(entries, { query: "нет-такого", page: 999 });
  assert.equal(empty.page, 1);
  assert.equal(empty.start, 0);
  assert.equal(empty.nextDisabled, true);
  assert.equal(prepareTavernLibrary(entries, { page: 999 }).page, 11);
});

test("library edit selects the exact latest saved tavern without activating it", async () => {
  const { tavern: active } = await purchaseFixture();
  const other = await TavernState.saveTavern(TavernGenerator.generate({ region: "novandia" }));
  const { app } = await gmButtons(active);
  const library = new TavernLibraryApp({ onEdit: (id) => app.loadSavedTavern(id) });
  library.render = () => library;
  try {
    const changed = await TavernState.saveTavern({ ...other, name: "Новое имя" });
    await library.perform("edit", other.id);
    assert.equal(app.draft.name, changed.name);
    assert.equal(app.draft.storageRevision, changed.storageRevision);
    assert.equal(TavernState.getCurrent().id, active.id);
    assert.equal(app.activeTavernId, null);
    assert.equal(app.editorTab, "menu");
  } finally { await app._onClose(); await library._onClose(); }
});

test("library deletion cancellation preserves data; confirmed deletion preserves active tavern", async () => {
  const { tavern } = await purchaseFixture();
  const library = new TavernLibraryApp();
  library.render = () => library;
  const confirm = foundry.applications.api.DialogV2.confirm;
  try {
    foundry.applications.api.DialogV2.confirm = async () => false;
    await library.perform("delete", tavern.id);
    assert.ok(TavernState.getSavedById(tavern.id));
    foundry.applications.api.DialogV2.confirm = async () => true;
    await library.perform("delete", tavern.id);
    assert.equal(TavernState.getSavedById(tavern.id), null);
    assert.equal(TavernState.getCurrent().id, tavern.id);
    assert.equal(library.pending, false);
  } finally { foundry.applications.api.DialogV2.confirm = confirm; await library._onClose(); }
});

test("library activation is explicit, does not open player windows, and ignores repeated pending actions", async () => {
  await purchaseFixture();
  const tavern = await TavernState.saveTavern(TavernGenerator.generate());
  const library = new TavernLibraryApp(); library.render = () => library;
  const original = TavernSocket.openForPlayers;
  let opened = 0; TavernSocket.openForPlayers = () => opened++;
  try {
    library.pending = true;
    await library.perform("activate", tavern.id);
    assert.notEqual(TavernState.getCurrent().id, tavern.id);
    library.pending = false;
    await library.perform("activate", tavern.id);
    assert.equal(TavernState.getCurrent().id, tavern.id);
    assert.equal(opened, 0);
  } finally { TavernSocket.openForPlayers = original; await library._onClose(); }
});

test("library does not expose saved taverns or actions to a player", async () => {
  const { tavern, gm, user } = await purchaseFixture();
  const library = new TavernLibraryApp(); library.render = () => library;
  try {
    game.user = user;
    assert.deepEqual(await library._prepareContext(), { isGM: false });
    await library.perform("delete", tavern.id);
    game.user = gm;
    assert.ok(TavernState.getSavedById(tavern.id));
  } finally { game.user = gm; await library._onClose(); }
});

test("GM draft price edits do not consume new-generation parameters", async () => {
  const { tavern } = await purchaseFixture();
  const { app, click } = await gmButtons(tavern);
  try {
    app.params.region = "novandia";
    app.params.priceMultiplier = 3;
    await click("applyPriceModifier");
    assert.equal(app.draft.priceMultiplier, 2);
    assert.equal(app.params.priceMultiplier, 3);
    assert.equal(app.params.region, "novandia");
    assert.equal(app.draft.region, tavern.region);
  } finally { await app._onClose(); }
});

test("GM manual rename auto-saves and undo restores the previous name", async () => {
  const { tavern } = await purchaseFixture();
  const { app, click } = await gmButtons(tavern);
  const query = app.element.querySelector;
  app.element.querySelector = selector => selector === "[name='tavernName']" ? { value: "  У старого моста  " } : query(selector);
  try {
    await click("rename");
    assert.equal(TavernState.getSavedById(tavern.id).name, "У старого моста");
    assert.equal(TavernState.getCurrent().name, "У старого моста");
    await click("undo");
    assert.equal(TavernState.getCurrent().name, tavern.name);
  } finally { await app._onClose(); }
});

test("GM deactivating another tavern retains the editor draft", async () => {
  const { tavern } = await purchaseFixture();
  const draft = TavernGenerator.generate({ region: "sangren" });
  const { app, click } = await gmButtons(draft);
  try {
    assert.equal(app.activeTavernId, null);
    await click("clear");
    assert.equal(TavernState.getCurrent(), null);
    assert.equal(app.draft.id, draft.id);
    assert.ok(TavernState.getSavedById(tavern.id));
  } finally { await app._onClose(); }
});

test("manual scene path immediately enables creation and whitespace disables it again", async () => {
  await purchaseFixture();
  const app = new TavernGMApp({ tavern: TavernGenerator.generate() });
  app.render = () => app;
  app.sceneConfig.mode = "manual";
  const handlers = {};
  const path = { dataset: { sceneParam: "manualImagePath" }, type: "text", value: "", addEventListener: (type, callback) => { handlers[type] = callback; } };
  const create = { disabled: true, addEventListener() {} };
  app.element = {
    querySelector: selector => selector === "[data-action='createScene']" ? create : null,
    querySelectorAll: selector => selector === "select[data-scene-param], input[data-scene-param]" ? [path] : []
  };
  try {
    await app._onRender();
    path.value = "taverns/background.webp"; handlers.input();
    assert.equal(create.disabled, false);
    path.value = "   "; handlers.input();
    assert.equal(create.disabled, true);
  } finally { await app._onClose(); }
});
