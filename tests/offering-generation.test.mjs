import { getSetting, setSetting } from "./test-env.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { TAVERN_OPTIONS, FOOD_TABLE, DRINK_TABLE, ROOM_TABLE, SERVICE_TABLE } from "../scripts/data/index.js";
import { TavernGenerator } from "../scripts/services/TavernGenerator.js";
import { TavernInventory } from "../scripts/services/TavernInventory.js";
import { TavernOfferingModel as Model } from "../scripts/services/TavernOfferingModel.js";
import { TavernEditor } from "../scripts/services/TavernEditor.js";
import { TavernMigrations } from "../scripts/services/TavernMigrations.js";
import { TavernAtmosphereService } from "../scripts/services/TavernAtmosphereService.js";
import { TavernAvailabilityService } from "../scripts/services/TavernAvailabilityService.js";
import { TavernDailyService } from "../scripts/services/TavernDailyService.js";
import { TavernState } from "../scripts/services/TavernState.js";
import { TavernEntryEditorDialog } from "../scripts/apps/TavernEntryEditorDialog.js";

const params = { region: "novandia", quality: "modest", size: "tiny", terrain: "road", priceMultiplier: 1 };
function seeded(seed, task) {
  const previous = Math.random;
  Math.random = typeof seed === "function" ? seed : () => { seed += 0x6D2B79F5; let t = Math.imul(seed ^ seed >>> 15, seed | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  try { return task(); } finally { Math.random = previous; }
}
function eligible(entry, p) {
  return (!entry.regions || entry.regions.includes("common") || entry.regions.includes(p.region)) && !entry.excludeRegions?.includes(p.region)
    && (!entry.quality || entry.quality.includes(p.quality)) && (!entry.terrains || entry.terrains.includes(p.terrain));
}
const core = t => Model.status(t).missing.map(item => item.role);

test("reviewed catalogue has explicit meaning independent of price or renamed labels", () => {
  for (const [type, table] of [["food",FOOD_TABLE],["drink",DRINK_TABLE],["room",ROOM_TABLE],["service",SERVICE_TABLE]]) {
    for (const source of table) assert.ok(Model.profile(source, type).roles.length, `${type}/${source.name}`);
  }
  assert.ok(Model.has(FOOD_TABLE.find(e => e.name === "Сладкая каша с медом"), "meal"));
  assert.ok(!Model.has(FOOD_TABLE.find(e => e.name === "Миндальное печенье к вину"), "meal"));
  for (const name of ["Хлебная тюря", "Холодный суп с хлебом", "Суп-наварка"]) assert.equal(Model.profile(FOOD_TABLE.find(e=>e.name===name)).family,"soup",name);
  const soup = Model.annotate(FOOD_TABLE[0]);
  assert.deepEqual(Model.profile({ ...soup, name: "Наш домашний суп", min: 999, max: 999 }), soup.offering);
  assert.deepEqual(Model.profile({ type: "food", name: "Неизвестное авторское блюдо" }).roles, []);
});

test("all 2016 contexts retain complete coherent offers under four random sequences", () => {
  let cases = 0;
  for (const region of Object.keys(TAVERN_OPTIONS.regions)) for (const quality of Object.keys(TAVERN_OPTIONS.qualities))
    for (const size of Object.keys(TAVERN_OPTIONS.sizes)) for (const terrain of Object.keys(TAVERN_OPTIONS.terrains)) {
      const p = { region, quality, size, terrain, priceMultiplier: 1.75 };
      for (const seed of [() => 0, () => 1 - Number.EPSILON, 721, 98231]) seeded(seed, () => {
        const t = { ...p, inventory: TavernInventory.generate(p) }; t.offeringPlan = TavernInventory.planFor(t);
        const label = `${region}/${quality}/${size}/${terrain}`;
        assert.deepEqual(core(t), [], label);
        if (!["common", "izuaver"].includes(region) && FOOD_TABLE.some(e => e.local && eligible(e,p) && Model.has(e,"meal"))) assert.ok(Model.coverage(t).localMeal, label);
        for (const entries of Object.values(t.inventory)) assert.equal(new Set(entries.map(e => e.name)).size, entries.length, label);
        for (const entry of t.inventory.services) {
          assert.equal(entry.price, Math.max(1,Math.round(entry.basePrice*1.75)), label);
          assert.ok(entry.unlimited || (entry.stock >= 0 && entry.maxStock >= entry.stock), label);
        }
        if (t.inventory.lodging.some(e => Model.profile(e,"room").animals)) assert.ok(Model.coverage(t).animalBoarding && Model.coverage(t).animalFeed,label);
        cases++;
      });
    }
  assert.equal(cases, 8064);
});

test("small regional inn gets its local extra after basic washing, animals and supplies", () => {
  const t = seeded(31, () => TavernGenerator.generate(params));
  assert.deepEqual(core(t), []);
  const extras = t.inventory.services.filter(e => !e.resource && !e.offeringCore);
  assert.equal(extras.length, 1);
  assert.ok(extras[0].local);
  for (const role of ["wash","animalBoarding","animalFeed","foodSupply","waterSupply"]) assert.ok(Model.coverage(t)[role],role);
});

test("crowd and sold-out stock remain real limits rather than silently granting infinite basics", () => {
  const t = TavernGenerator.generate(params);
  const water = t.inventory.services.find(e => e.resource?.kind === "water"); water.stock=0;
  const upgraded = TavernInventory.ensureOfferings(t);
  assert.equal(upgraded.inventory.services.find(e=>e.id===water.id).stock,0);
  assert.equal(TavernAvailabilityService.forEntry(upgraded,"services",water).disabled,true);
  assert.ok(Model.coverage(upgraded).waterSupply);
  assert.ok(upgraded.inventory.services.filter(e=>e.offeringCore).every(e=>!e.unlimited));
});

test("reading legacy data is passive; explicit adoption preserves existing money, stock, bookings and links", () => {
  let t = seeded(7,()=>TavernGenerator.generate({ ...params, size:"medium" }));
  delete t.offeringPlan;
  for (const entries of Object.values(t.inventory)) for(const e of entries) { delete e.offering; delete e.offeringCore; }
  t.inventory.services = [];
  t.inventory.food[0].price=123; t.inventory.food[0].basePrice=99; t.inventory.food[0].stock=0;
  t.scene={id:"kept-scene",compendium:{id:"archive-scene"}}; t.tavernkeeper={id:"kept-actor"};
  const room = t.inventory.lodging.find(e=>e.stock>0);
  t=TavernState.purchaseEntryInData(t,"lodging",room.id,{quantity:1,days:3,actorId:"guest"}).tavern;
  const before=TavernMigrations.migrate(t);
  assert.equal(before.offeringPlan,undefined);
  assert.ok(before.inventory.food.every(e=>!e.offering));
  const next=seeded(9,()=>TavernInventory.ensureOfferings(before));
  assert.deepEqual(core(next),[]);
  for(const key of ["lodgingBookings","scene","tavernkeeper","atmosphere","refreshState"])assert.deepEqual(next[key],before[key],key);
  for(const category of Object.keys(before.inventory)) for(const old of before.inventory[category]) {
    const kept={...next.inventory[category].find(e=>e.id===old.id)};delete kept.offering;
    assert.deepEqual(kept,old,old.name);
  }
  assert.deepEqual(TavernInventory.ensureOfferings(next),next);
  assert.deepEqual(t,before);
});

test("adoption adds a missing lodging option before resolving its animal dependencies", () => {
  const t=TavernGenerator.generate({...params,terrain:"city"});t.inventory.lodging=[];t.inventory.services=[];delete t.offeringPlan;
  const next=seeded(()=>0,()=>TavernInventory.ensureOfferings(t));
  assert.ok(next.inventory.lodging.length);
  assert.deepEqual(core(next),[]);
  if(Model.context(next).animals)assert.ok(Model.coverage(next).animalBoarding&&Model.coverage(next).animalFeed);
});

test("legacy lodging is recognized by its category even if its old type label differs", () => {
  const t=TavernGenerator.generate(params);
  t.inventory.lodging=[{...t.inventory.lodging[0],type:"lodging"}];
  const next=TavernInventory.ensureOfferings(t);
  assert.equal(next.inventory.lodging.length,1);
  assert.equal(next.inventory.lodging[0].id,t.inventory.lodging[0].id);
  assert.equal(next.inventory.lodging[0].type,"lodging");
  assert.ok(Model.coverage(next).lodging);
});

test("a handmade dish or drink can fulfill the foundation and can be deliberately reclassified", () => {
  let t=TavernGenerator.generate(params);t.inventory.food=[];t.inventory.drinks=[];
  t=TavernEditor.upsertEntry(t,"food",null,{name:"Мамин обед",stock:8,maxStock:8,offering:{roles:["meal"],family:"house"},pinned:true});
  t=TavernEditor.upsertEntry(t,"drinks",null,{name:"Наш настой",stock:8,maxStock:8,offering:{roles:["tableDrink"]}});
  assert.ok(Model.coverage(t).meal&&Model.coverage(t).tableDrink);
  const id=t.inventory.food[0].id;
  t=TavernEditor.upsertEntry(t,"food",id,{name:"Обед с новым названием"});assert.ok(Model.coverage(t).meal);
  t=TavernEditor.upsertEntry(t,"food",id,{offering:{roles:["dessert"],family:"sweet"}});
  assert.equal(Model.coverage(t).meal,false);assert.equal(t.inventory.food[0].id,id);
});

test("custom washing has the cleanliness effect, and changing its meaning removes that effect", () => {
  let t=TavernGenerator.generate(params);
  t=TavernEditor.upsertEntry(t,"services",null,{name:"Таз для гостей",stock:6,maxStock:6,offering:{roles:["wash"]}});
  const custom=t.inventory.services.at(-1);assert.equal(custom.cleanliness.level,1);
  t=TavernEditor.upsertEntry(t,"services",custom.id,{offering:{roles:["extra"]}});
  assert.equal(t.inventory.services.find(e=>e.id===custom.id).cleanliness,undefined);
});

test("adding an animal-related custom room or service adds the missing counterpart once", () => {
  let t=TavernGenerator.generate({...params,terrain:"city"});t.inventory.services=[];t.inventory.lodging=[];delete t.offeringPlan;
  t=TavernEditor.upsertEntry(t,"lodging",null,{name:"Ночь над конным двором",stock:2,total:2,offering:{roles:["lodging"],animals:true}});
  assert.ok(Model.coverage(t).animalBoarding&&Model.coverage(t).animalFeed);
  const ids=t.inventory.services.map(e=>e.id);
  t=TavernEditor.upsertEntry(t,"lodging",t.inventory.lodging[0].id,{basePrice:9});
  assert.deepEqual(t.inventory.services.map(e=>e.id),ids);
});

test("rotation cannot remove the last meal when only side dishes are eligible replacements", () => {
  const source=[...FOOD_TABLE];
  try {
    FOOD_TABLE.splice(0,FOOD_TABLE.length,{name:"Зелень",type:"food",min:2,max:2,offering:{roles:["side"],family:"vegetable"}});
    const t=TavernGenerator.generate(params);
    t.inventory.food=[{id:"last-meal",name:"Авторский обед",type:"food",price:17,basePrice:17,stock:2,maxStock:9,offering:{roles:["meal"],family:"house"}}];
    const next=seeded(()=>0,()=>TavernInventory.rotateMenuEntry(t,"food","last-meal"));
    assert.deepEqual(next,TavernMigrations.migrate(t));
  } finally { FOOD_TABLE.splice(0,FOOD_TABLE.length,...source); }
});

test("pinned rows and an exhausted replacement pool keep IDs, prices and remaining stock", () => {
  const source=[...DRINK_TABLE];
  try {
    DRINK_TABLE.splice(0,DRINK_TABLE.length,{name:"Единственное питьё",type:"drink",min:2,max:2,offering:{roles:["tableDrink"]}});
    const t=TavernGenerator.generate(params);const e=t.inventory.drinks[0];e.stock=1;e.price=19;
    assert.deepEqual(TavernInventory.rotateMenuEntry(t,"drinks",e.id),TavernMigrations.migrate(t));
    e.pinned=true;
    DRINK_TABLE.push({name:"Второе питьё",type:"drink",min:2,max:2,offering:{roles:["tableDrink"]}});
    assert.deepEqual(TavernInventory.rotateMenuEntry(t,"drinks",e.id),TavernMigrations.migrate(t));
  } finally { DRINK_TABLE.splice(0,DRINK_TABLE.length,...source); }
});

test("30 day rotations preserve functional coverage, pins, atmosphere and paid lodging", () => {
  const settings = Object.fromEntries(["dailyInventoryRefreshEnabled","dailyMenuRotationEnabled","dailyAtmosphereRefreshEnabled"].map(key=>[key,getSetting(key)]));
  setSetting("dailyInventoryRefreshEnabled",true);setSetting("dailyMenuRotationEnabled",true);setSetting("dailyAtmosphereRefreshEnabled",true);
  try {
    for(const region of ["novandia","sangren","naerder","izuaver"]) {
      let t=seeded(53,()=>TavernGenerator.generate({...params,region,size:"medium"}));
      const pinned=t.inventory.food[0];pinned.pinned=true;pinned.price=45;pinned.basePrice=45;
      const room=t.inventory.lodging.find(e=>e.stock>0);
      t=TavernState.purchaseEntryInData(t,"lodging",room.id,{quantity:1,days:60,actorId:"long-stay"}).tavern;
      for(let day=1;day<=30;day++) {
        t=seeded(day,()=>TavernDailyService.refreshTavernForNewDay(t,{dayKey:`offering:${day}`}).tavern);
        assert.deepEqual(core(t),[],`${region}/${day}`);
        assert.equal(t.inventory.food.find(e=>e.id===pinned.id).price,45);
        assert.equal(t.lodgingBookings[0].remainingDays,60-day);
        assert.ok(t.inventory.lodging.find(e=>e.id===room.id).occupied>=1);
      }
    }
  } finally { for(const [key,value]of Object.entries(settings))setSetting(key,value); }
});

test("manual deletion stays deleted across new days; explicit restoration is separate", () => {
  let t=TavernGenerator.generate(params);
  t.inventory.services=t.inventory.services.filter(e=>!Model.has(e,"wash"));
  t=TavernDailyService.refreshTavernForNewDay(t,{dayKey:"manual-absence"}).tavern;
  assert.ok(core(t).includes("wash"));
  assert.equal(TavernInventory.ensureOfferings(t).inventory.services.filter(e=>Model.has(e,"wash")).length,1);
});

test("private save metadata survives public scene snapshots and category migrations", () => {
  const t=TavernGenerator.generate(params);const view=TavernAtmosphereService.publicView(t);
  assert.equal(view.atmosphere,undefined);assert.deepEqual(view.offeringPlan,t.offeringPlan);
  assert.deepEqual(core(TavernMigrations.migrate(view)),[]);
  for(const category of Object.keys(t.inventory))assert.deepEqual(view.inventory[category].map(e=>e.offering),t.inventory[category].map(e=>e.offering));
});

test("manual editor exposes readable meaning and safely pins a new authored row by default", async () => {
  for(const [category,role]of [["food","meal"],["drinks","tableDrink"],["services","wash"]]) {
    const app=new TavernEntryEditorDialog({category,entry:{type:category==="drinks"?"drink":category==="services"?"service":"food",offering:{roles:[role]}}});
    const c=await app._prepareContext();assert.equal(c.role,role);assert.ok(c.roleChoices[role]);assert.equal(c.entry.pinned,true);
  }
});

test("Izuaver exhausts strict imports before using the existing shortage fallback", () => {
  const previous=[...FOOD_TABLE];
  try {
    FOOD_TABLE.splice(0,FOOD_TABLE.length,
      {name:"Strict soup",type:"food",regions:["novandia"],terrains:["city"],min:2,max:2,weight:1,offering:{roles:["meal"],family:"soup"}},
      {name:"Strict bread",type:"food",regions:["sangren"],terrains:["city"],min:2,max:2,weight:1,offering:{roles:["side"],family:"baked"}},
      {name:"Fallback",type:"food",regions:["horslia"],terrains:["road"],min:2,max:2,weight:10000,offering:{roles:["meal"],family:"grain"}},
      {name:"Excluded",type:"food",regions:["horslia"],excludeRegions:["izuaver"],min:2,max:2,weight:10000,offering:{roles:["meal"],family:"grain"}}
    );
    const t=seeded(19,()=>TavernGenerator.generate({region:"izuaver",quality:"modest",size:"tiny",terrain:"city"}));
    assert.deepEqual(new Set(t.inventory.food.map(e=>e.name)),new Set(["Strict soup","Strict bread","Fallback"]));
    assert.ok(t.inventory.food.every(e=>!e.local));
  } finally {FOOD_TABLE.splice(0,FOOD_TABLE.length,...previous);}
});

test("restoration preserves a deliberately reclassified same-name row even if it blocks the only basic candidate", () => {
  const t=TavernGenerator.generate({...params,quality:"poor"});
  const wash=t.inventory.services.find(e=>e.cleanliness);
  delete wash.cleanliness;wash.offering={roles:["extra"]};wash.price=31;
  const next=TavernInventory.ensureOfferings(t);
  assert.ok(core(next).includes("wash"));
  assert.equal(next.inventory.services.find(e=>e.id===wash.id).price,31);
  assert.equal(next.inventory.services.filter(e=>e.name===wash.name).length,1);
  assert.deepEqual(TavernInventory.ensureOfferings(next),next);
});
