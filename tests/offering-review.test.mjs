import "./test-env.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { FOOD_TABLE, ROOM_TABLE } from "../scripts/data/index.js";
import { TavernGenerator } from "../scripts/services/TavernGenerator.js";
import { TavernInventory } from "../scripts/services/TavernInventory.js";
import { TavernEditor } from "../scripts/services/TavernEditor.js";
import { TavernMigrations } from "../scripts/services/TavernMigrations.js";
import { TavernOfferingModel as Model } from "../scripts/services/TavernOfferingModel.js";
import { TavernEntryEditorDialog } from "../scripts/apps/TavernEntryEditorDialog.js";

function seeded(seed, task) {
  const previous = Math.random;
  Math.random = () => {
    seed += 0x6D2B79F5;
    let t = Math.imul(seed ^ seed >>> 15, seed | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  try { return task(); } finally { Math.random = previous; }
}

const food = name => {
  const entry = FOOD_TABLE.find(item => item.name === name);
  assert.ok(entry, name);
  return Model.annotate(entry, "food");
};

function cityWithBlockedService(name, quality = "poor") {
  let tavern = seeded(1, () => TavernGenerator.generate({ region: "common", quality, size: "tiny", terrain: "city" }));
  tavern.inventory.lodging = [];
  tavern.inventory.services = tavern.inventory.services.filter(entry => Model.has(entry, "wash"));
  delete tavern.offeringPlan;
  return TavernEditor.upsertEntry(tavern, "services", null, {
    name, basePrice: 71, stock: 0, maxStock: 2, pinned: true, offering: { roles: ["extra"] }
  });
}

const animalRoom = { name: "Ночь над своим двором", stock: 2, total: 2, offering: { roles: ["lodging"], animals: true } };

test("automatic animal dependencies respect an authored same-name service and keep the unresolved gap visible", () => {
  const before = cityWithBlockedService("Место в стойле");
  const authored = before.inventory.services.at(-1);
  const next = TavernEditor.upsertEntry(before, "lodging", null, animalRoom);
  assert.deepEqual(next.inventory.services.find(entry => entry.id === authored.id), authored);
  assert.equal(next.inventory.services.filter(entry => entry.name === authored.name).length, 1);
  assert.ok(Model.status(next).missing.some(item => item.role === "animalBoarding"));
  assert.ok(Model.coverage(next).animalFeed);
  assert.deepEqual(TavernInventory.completeAnimalOffers(next), next);
  assert.deepEqual(before.inventory.services.at(-1), authored);
});

test("animal dependencies use a different valid feed service when the basic name belongs to an authored row", () => {
  const before = cityWithBlockedService("Корм для верхового животного", "modest");
  const authored = before.inventory.services.at(-1);
  const next = seeded(1, () => TavernEditor.upsertEntry(before, "lodging", null, animalRoom));
  assert.deepEqual(next.inventory.services.find(entry => entry.id === authored.id), authored);
  assert.equal(next.inventory.services.filter(entry => entry.name === authored.name).length, 1);
  assert.ok(next.inventory.services.some(entry => entry.name === "Уход за лошадью"));
  assert.ok(Model.coverage(next).animalBoarding && Model.coverage(next).animalFeed);
  assert.deepEqual(TavernInventory.completeAnimalOffers(next), next);
});

test("the inn explicitly promising separate horse accommodation actually sells accommodation and feed", () => {
  const name = "Лежанка двора наемных всадников";
  const source = ROOM_TABLE.find(entry => entry.name === name);
  assert.match(source.desc, /Лошадь размещается за отдельную плату/);
  // This fixture was a real complete-status false positive, not a synthetic catalogue.
  const tavern = seeded(1, () => TavernGenerator.generate({ region: "novandia", quality: "poor", size: "tiny", terrain: "city" }));
  assert.ok(tavern.inventory.lodging.some(entry => entry.name === name));
  assert.ok(tavern.inventory.services.some(entry => entry.name === "Место в стойле"));
  assert.ok(tavern.inventory.services.some(entry => ["Корм для верхового животного", "Уход за лошадью"].includes(entry.name)));
  assert.ok(tavern.offeringPlan.facilities.animals);
});

test("explicit adoption recognizes the horse accommodation promise in an unannotated legacy room", () => {
  const tavern = seeded(1, () => TavernGenerator.generate({ region: "novandia", quality: "poor", size: "tiny", terrain: "city" }));
  const room = tavern.inventory.lodging.find(entry => entry.name === "Лежанка двора наемных всадников");
  delete room.offering;
  delete tavern.offeringPlan;
  tavern.inventory.services = tavern.inventory.services.filter(entry => !["Место в стойле", "Корм для верхового животного", "Уход за лошадью"].includes(entry.name));
  const snapshot = structuredClone(tavern);
  const next = TavernInventory.ensureOfferings(tavern);
  assert.ok(Model.coverage(next).animalBoarding && Model.coverage(next).animalFeed);
  assert.deepEqual(tavern, snapshot);
  const kept = { ...next.inventory.lodging.find(entry => entry.id === room.id) };
  delete kept.offering;
  assert.deepEqual(kept, room);
  assert.deepEqual(TavernInventory.ensureOfferings(next), next);
});

test("catalogue descriptions determine families: main ingredients and preparation outweigh a small garnish", () => {
  const expected = {
    "Овсяный кисель с ягодной подливой": "grain", "Овсяный кисель с медом": "grain",
    "Картофель с луком и сметаной": "vegetable", "Картофельная сковорода с луком": "vegetable",
    "Грибные шашлычки с соевым соусом": "vegetable", "Печеный перец с белой фасолью": "vegetable",
    "Гороховое пюре с печеным луком": "vegetable", "Бобовые котлеты с кумином": "vegetable", "Нут с оазисным луком": "vegetable",
    "Плоский хлеб с сыром": "cold", "Плоский хлеб с бобовой пастой": "cold", "Хлеб долин с печеной сливой": "cold",
    "Паровые булочки с грибами": "baked", "Паровые булочки с мясом": "baked", "Хлебный пудинг с изюмом": "baked",
    "Паровые свертки с капустой": "pasta", "Томленая говядина в онтаквском вине": "meat", "Рыба на пару с имбирем": "fish",
    "Печеный сыр с виноградным соусом": "dairy", "Жареный сыр с хлебом": "dairy"
  };
  const mismatches = Object.entries(expected).filter(([name, family]) => food(name).offering.family !== family);
  assert.deepEqual(mismatches, []);
});

test("oat dishes, pulse plates and steamed buns do not create false family diversity", () => {
  for (const names of [
    ["Овсяная каша с патокой", "Овсяный кисель с медом", "Овсяный кисель с ягодной подливой"],
    ["Фасоль с чесноком и маслом", "Нут с оазисным луком", "Бобовые котлеты с кумином"],
    ["Паровые булочки с мясом", "Паровые булочки с грибами"]
  ]) assert.equal(Model.coverage({ inventory: { food: names.map(food) } }).foodVariety, false, names.join(" / "));
});

test("rotation cannot replace the only different family with an oat dish disguised by incorrect metadata", () => {
  const soup = food("Ржаная похлебка с луком"), porridge = food("Овсяная каша с патокой"), kissel = food("Овсяный кисель с ягодной подливой");
  const sources = [...FOOD_TABLE];
  try {
    // The only alternative is a real reviewed oat recipe. Keep the last soup.
    FOOD_TABLE.splice(0, FOOD_TABLE.length, { ...kissel, regions: ["common"] });
    const tavern = TavernMigrations.migrate({ schemaVersion: 4, region: "common", quality: "modest", size: "tiny", terrain: "city", inventory: {
      food: [{ ...porridge, id: "porridge", stock: 5, maxStock: 5 }, { ...soup, id: "last-soup", price: 19, basePrice: 19, stock: 1, maxStock: 9 }],
      drinks: [], lodging: [], services: []
    } });
    assert.deepEqual(TavernInventory.rotateMenuEntry(tavern, "food", "last-soup"), tavern);
  } finally { FOOD_TABLE.splice(0, FOOD_TABLE.length, ...sources); }
});

test("the manual editor can represent every catalogue family, including a hot cheese dish", async () => {
  const families = new Map(FOOD_TABLE.map(entry => [Model.profile(entry).family, entry]));
  for (const [family, entry] of families) {
    const context = await new TavernEntryEditorDialog({ category: "food", entry })._prepareContext();
    assert.ok(Object.hasOwn(context.familyChoices, family), `${entry.name}: ${family}`);
    assert.equal(context.family, family);
  }
  const context = await new TavernEntryEditorDialog({ category: "food", entry: food("Жареный сыр с хлебом") })._prepareContext();
  assert.equal(context.family, "dairy");
});
