import "./test-env.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  FOOD_TABLE, DRINK_TABLE, ROOM_TABLE, SERVICE_TABLE,
  TAVERN_OPTIONS, QUALITY_MODIFIERS, SIZE_MODIFIERS
} from "../scripts/data/index.js";
import { TavernInventory } from "../scripts/services/TavernInventory.js";
import { TavernGenerator } from "../scripts/services/TavernGenerator.js";
import { TavernState } from "../scripts/services/TavernState.js";
import { TavernDataValidator } from "../scripts/services/TavernDataValidator.js";

const normalize = name => name.trim().toLocaleLowerCase("ru-RU");
function eligible(entry, {region, terrain, quality}) {
  return (!entry.regions || entry.regions.includes("common") || entry.regions.includes(region))
    && !entry.excludeRegions?.includes(region)
    && (!entry.terrains || entry.terrains.includes(terrain))
    && (!entry.quality || entry.quality.includes(quality));
}
const regional = entry => entry.regions?.length && !entry.regions.includes("common");

test("all regional hospitality pools respect filters, capacity and complete menu targets", () => {
  for (const region of Object.keys(TAVERN_OPTIONS.regions)) {
    for (const quality of Object.keys(TAVERN_OPTIONS.qualities)) {
      for (const size of Object.keys(TAVERN_OPTIONS.sizes)) {
        for (const terrain of Object.keys(TAVERN_OPTIONS.terrains)) {
          const params = {region, quality, size, terrain, priceMultiplier: 1};
          const label = `${region}/${quality}/${size}/${terrain}`;
          const inventory = TavernInventory.generate(params);
          const target = Math.max(4, SIZE_MODIFIERS[size].menu + QUALITY_MODIFIERS[quality].menu);
          const foodTarget = Math.max(2, Math.round(target * 0.68));
          assert.equal(inventory.food.length, foodTarget, label);
          assert.equal(inventory.drinks.length, target - foodTarget, label);
          for (const entries of Object.values(inventory)) {
            assert.equal(new Set(entries.map(e => normalize(e.name))).size, entries.length, label);
            assert.ok(entries.every(e => Number.isInteger(e.price) && e.price > 0), label);
          }
          for (const [key, table] of [["lodging", ROOM_TABLE], ["services", SERVICE_TABLE]]) {
            const pool = table.filter(e => eligible(e, params));
            const requested = key === "lodging" ? Math.max(1, SIZE_MODIFIERS[size].rooms + QUALITY_MODIFIERS[quality].rooms)
              : ({tiny: 1, small: 2, medium: 3, large: 4})[size];
            assert.equal(inventory[key].length, Math.min(requested, pool.length), `${label}/${key}`);
            for (const entry of inventory[key]) {
              assert.ok(pool.some(e => e.name === entry.name), `${label}: unexpected ${entry.name}`);
              if (key === "lodging" && !entry.unlimited) {
                assert.equal(entry.stock + entry.occupied, entry.total, label);
                assert.ok(entry.total > 0 && entry.stock >= 0, label);
              }
            }
            const local = pool.filter(regional);
            if (local.length) assert.ok(inventory[key].some(e => local.some(candidate => candidate.name === e.name)), `${label}: no regional ${key}`);
          }
          if (region !== "common" && region !== "izuaver") {
            for (const table of [FOOD_TABLE, DRINK_TABLE]) {
              assert.ok(table.some(e => e.local && eligible(e, params)), `${label}: empty regional menu pool`);
            }
          }
        }
      }
    }
  }
});

test("Izuaver keeps imported menus and gains its own hospitality", () => {
  for (const quality of Object.keys(TAVERN_OPTIONS.qualities)) {
    const params = {region: "izuaver", quality, size: "large", terrain: "city", priceMultiplier: 1};
    const inventory = TavernInventory.generate(params);
    for (const [key,table] of [["food",FOOD_TABLE],["drinks",DRINK_TABLE]]) {
      for (const entry of inventory[key]) {
        assert.equal(entry.local, false);
        assert.ok(table.some(e => e.name === entry.name && regional(e) && !e.regions.includes("izuaver") && !e.excludeRegions?.includes("izuaver") && (!e.quality || e.quality.includes(quality))));
      }
    }
    for (const [key,table] of [["lodging",ROOM_TABLE],["services",SERVICE_TABLE]]) {
      assert.ok(inventory[key].some(e => table.some(source => source.name === e.name && source.regions?.includes("izuaver"))));
    }
  }
});

test("initial and manually added lodging honor region, terrain, quality, exclusion and weight", () => {
  const original = [...ROOM_TABLE];
  const originalRandom = Math.random;
  const base = {min: 1, max: 2, totalMin: 2, totalMax: 4, desc: "Test room"};
  try {
    ROOM_TABLE.splice(0, ROOM_TABLE.length,
      {...base, name: "Wrong region", regions: ["naerder"]},
      {...base, name: "Wrong terrain", terrains: ["wilderness"]},
      {...base, name: "Wrong quality", quality: ["fine"]},
      {...base, name: "Excluded region", excludeRegions: ["tirabor"]},
      {...base, name: "Low weight", weight: 1},
      {...base, name: "High weight", weight: 100}
    );
    Math.random = () => 0.5;
    const params = {region: "tirabor", quality: "poor", size: "tiny", terrain: "mountain", priceMultiplier: 1};
    assert.equal(TavernInventory.generate(params).lodging[0].name, "High weight");
    const tavern = TavernGenerator.generate(params);
    tavern.inventory.lodging = [];
    const added = TavernInventory.addRandomEntry(tavern, "lodging");
    assert.equal(added.inventory.lodging[0].name, "High weight");
    const next = TavernInventory.addRandomEntry(added, "lodging");
    assert.deepEqual(next.inventory.lodging.map(e => e.name), ["High weight", "Low weight"]);
    const exhausted = TavernInventory.addRandomEntry(next, "lodging");
    assert.equal(exhausted.inventory.lodging.length, 2);
  } finally {
    ROOM_TABLE.splice(0, ROOM_TABLE.length, ...original);
    Math.random = originalRandom;
  }
});

test("validator checks lodging references and weights and common/regional name overlap", () => {
  const roomCount = ROOM_TABLE.length;
  const foodCount = FOOD_TABLE.length;
  try {
    ROOM_TABLE.push({name: "Invalid room", desc: "Test", min: 1, max: 2, totalMin: 1, totalMax: 2, regions: ["missing-region"], terrains: ["missing-terrain"], excludeRegions: ["missing-exclusion"], weight: 0});
    FOOD_TABLE.push({...FOOD_TABLE.find(e => e.regions?.includes("common")), regions: ["tirabor"]});
    const report = TavernDataValidator.validate({log: false});
    for (const field of ["regions", "terrains", "excludeRegions", "weight"]) assert.ok(report.errors.some(e => e.includes("Invalid room") && e.includes(field)), field);
    assert.ok(report.warnings.some(e => e.includes("FOOD_TABLE") && e.includes("tirabor")));
  } finally {
    ROOM_TABLE.length = roomCount;
    FOOD_TABLE.length = foodCount;
  }
  assert.deepEqual(TavernDataValidator.validate({log: false}), {errors: [], warnings: []});
});

test("regional beds use the existing finite booking and day-expiry model", () => {
  const tavern = TavernGenerator.generate({region: "naerder", quality: "poor", size: "small", terrain: "road", priceMultiplier: 1});
  const room = tavern.inventory.lodging.find(e => ROOM_TABLE.some(source => source.name === e.name && source.regions?.includes("naerder")));
  assert.ok(room);
  room.total = 3;
  room.stock = 3;
  room.maxStock = 3;
  room.occupied = 0;
  const purchase = TavernState.purchaseEntryInData(tavern, "lodging", room.id, {quantity: 2, days: 2});
  const booked = purchase.tavern.inventory.lodging.find(e => e.id === room.id);
  assert.equal(booked.stock, 1);
  assert.throws(() => TavernState.purchaseEntryInData(purchase.tavern, "lodging", room.id, {quantity: 2, days: 1}));
  const first = TavernState.advanceLodgingDayInData(purchase.tavern, 1);
  assert.equal(first.tavern.lodgingBookings[0].remainingDays, 1);
  const second = TavernState.advanceLodgingDayInData(first.tavern, 1);
  assert.equal(second.expired.length, 1);
  assert.equal(second.tavern.inventory.lodging.find(e => e.id === room.id).stock, 3);
});
