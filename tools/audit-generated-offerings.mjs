// Read-only, reproducible audit of actual generated taverns; no Foundry world is touched.
import "../tests/test-env.mjs";
import { writeFile } from "node:fs/promises";
import { TAVERN_OPTIONS, FOOD_TABLE, DRINK_TABLE, SERVICE_TABLE } from "../scripts/data/index.js";
import { TavernGenerator } from "../scripts/services/TavernGenerator.js";
import { TavernAvailabilityService } from "../scripts/services/TavernAvailabilityService.js";
import { TavernOfferingModel } from "../scripts/services/TavernOfferingModel.js";

if (process.argv.includes("--help")) {
  process.stdout.write("Usage: node tools/audit-generated-offerings.mjs [--samples=128] [--profile=region/quality/size/terrain,...] [--out=result.json]\nReplay: --replay=region/quality/size/terrain/sample\n");
  process.exit(0);
}
const allowedArgs = new Set(["--samples", "--profile", "--out", "--replay"]);
const args = new Map(process.argv.slice(2).map(arg => {
  const i = arg.indexOf("=");
  if (i < 0 || !allowedArgs.has(arg.slice(0, i))) throw new Error(`Unknown argument: ${arg}; see --help`);
  return [arg.slice(0, i), arg.slice(i + 1)];
}));
const samples = Number(args.get("--samples") ?? 128);
if (!Number.isSafeInteger(samples) || samples < 1 || samples > 10000) throw new Error("--samples must be 1..10000");
const hash = text => { let h = 2166136261; for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
function random(seed) {
  return () => { let t = seed += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function generate(region, quality, size, terrain, sample) {
  const key = `${region}/${quality}/${size}/${terrain}/${sample}`;
  Math.random = random(hash(`offering-audit-v1:${key}`));
  const idRandom = random(hash(`offering-audit-ids-v1:${key}`));
  foundry.utils.randomID = (length = 16) => Array.from({ length }, () => Math.floor(idRandom() * 36).toString(36)).join("");
  return TavernGenerator.generate({ region, quality, size, terrain, priceMultiplier: 1 });
}

// Human-reviewed exceptions. This is an intentionally generous main-meal proxy:
// cold bread-and-cheese/meat/fish plates and sweet grain porridge count as meals.
// Portions/calories are not modelled. Ambiguous sides are not proof of starvation.
const lightFood = new Set([
  "Запеченная луковица с хлебом", "Жареный лук с хлебной крошкой", "Сушеные яблоки и орехи", "Разведенный мясной бульон",
  "Хлеб Первого Зуба", "Дорожная лепешка с крупной солью", "Репа в золе с маслом", "Лесные ягоды с творогом",
  "Яблочный тарт", "Печеные яблоки в молодом вине", "Печеный сыр с виноградным соусом", "Маковый рулет", "Жареные грибы с луком",
  "Тофу с горными травами", "Грибные шашлычки с соевым соусом", "Паровые пирожки с фасолью", "Капуста с грибами быстрой обжарки",
  "Пшеничная лепешка с зеленью", "Лепешка с оливками", "Баклажаны в масле", "Миндальное печенье к вину", "Лепешка с зеленым луком",
  "Сладкие бобовые лепешки к чаю", "Миндальный пирог", "Ржаная лепешка с пищевой каменной солью"
]);
const coldFood = new Set([
  "Черный хлеб, сыр и соленья", "Соленая рыба с хлебом", "Холодная мясная доска", "Сухари с сыром", "Козий сыр с медом",
  "Солонина с горчицей", "Сушеные яблоки и орехи", "Копченая грудинка с хлебом", "Хлеб с рыночным сыром",
  "Холодный пирог для железной дороги", "Хлеб Первого Зуба", "Дорожная лепешка с крупной солью", "Вяленый улов с сухарями",
  "Консерва Ржавых Берегов", "Рыбная намазка на солодовом хлебе", "Сушеная рыба с маслом", "Копченая оленина",
  "Плоский хлеб с копченой рыбой", "Овсяный хлеб с сыром", "Пиратская доля с верфи", "Рыба под рассолом", "Лесные ягоды с творогом",
  "Сырная тарелка с хлебом", "Паштет с хлебом", "Винодельческий завтрак", "Копченая форель с хреном", "Тофу с горными травами",
  "Холодная гречневая лапша с редькой", "Холодный суп с хлебом", "Соленая треска с уксусом", "Тироборская солонина с оливками",
  "Ржаная лепешка с пищевой каменной солью", "Копченая форель из штолен", "Сушеная конина с лепешкой", "Сушеный творог с дорожной лепешкой"
]);
// Fermented kvass / kumis / birch drinks are separate, not asserted alcohol-free.
const fermented = new Set(["Кислый квас", "Ржаной квас ручной варки", "Хлебный квас", "Белый хлебный квас", "Тминный квас", "Кисломолочный напиток", "Кумыс Якнизема", "Березовый напиток"]);
// Fixed audit annotations refer to this exact reviewed catalogue, never to runtime
// selection. Exported output contains names, so these choices remain inspectable.
if (DRINK_TABLE.length !== 162 || FOOD_TABLE.length !== 341) throw new Error("Catalogue changed; review semantic annotations before rerunning");
const alcoholicNames = new Set(["Малое пиво","Темное пиво","Дешевое красное вино","Яблочный сидр","Крепкий зерновой спирт","Слабая медовуха","Крепкая медовуха","Дешевое белое вино","Разбавленное вино","Пряная настойка","Сливовая брага","Портовая ромовая порция","Горячее вино с пряностями","Простая брага","Крепкая рябиновая настойка","Болтраскский фабричный эль","Зерновой перегон Гринвейла","Темный портер Болтраска","Кукурузный бурбон фронтира","Выдержанный эль к воскресному обеду","Ячменное пиво очажной варки","Флеченрандское темное пиво","Тминная настойка","Пшеничное пиво Флеченранда","Яблочный шнапс","Можжевеловый шнапс","Ячменный эль","Горький травяной биттер","Медовая паленка","Светлое пшеничное пиво","Медовое пиво","Северное кислое пиво","Можжевеловая настойка","Северное копченое пиво","Брусничная наливка","Каперская горячая брага","Медовая брага","Ржаная водка","Малиновая наливка","Арак","Сорговая брага саванных дворов","Новандский сидр","Столовое вино Нованда","Белое вино Нованда","Грушевый сидр Нованда","Белое вино на травах","Наливка из черной смородины","Вино Последней Грозди","Восточное новандское белое","Горная сливовица","Темное пиво с дымком","Онтаквское вино","Сакэ низкой очистки","Сакэ Ройу Мидеки","Сливовая настойка Мидеки","Рисовое вино Сагеки","Рисовая брага","Выдержанное янтарное рисовое вино","Сангренское красное вино","Травяная граппа","Белое вино Сангрена","Лимонная вода с вином","Горький травяной вермут","Вино долины Уми","Рисовое вино Сарройо","Сиростьенский херес","Красное вино Сиростьена","Анисовая настойка","Республиканская горькая","Тироборское крепкое пиво","Сухое вино тироборских равнин","Виноградная настойка с анисом","Каменный портер","Медный шнапс","Рамбаров отдых","Дрыгвяная картофельная брага","Хорслийское светлое пиво","Темное пиво Хорслии","Сливовая паленка"]);
const strongNames = new Set(["Крепкий зерновой спирт","Крепкая медовуха","Пряная настойка","Портовая ромовая порция","Крепкая рябиновая настойка","Зерновой перегон Гринвейла","Кукурузный бурбон фронтира","Тминная настойка","Яблочный шнапс","Можжевеловый шнапс","Горький травяной биттер","Медовая паленка","Можжевеловая настойка","Брусничная наливка","Ржаная водка","Малиновая наливка","Арак","Наливка из черной смородины","Горная сливовица","Сливовая настойка Мидеки","Травяная граппа","Горький травяной вермут","Сиростьенский херес","Анисовая настойка","Республиканская горькая","Виноградная настойка с анисом","Медный шнапс","Сливовая паленка"]);
const alcoholic = entry => alcoholicNames.has(entry.name);
const strong = entry => strongNames.has(entry.name);
const drinkSource = new Map(DRINK_TABLE.map(entry => [entry.name, entry]));
for (const name of [...lightFood, ...coldFood]) {
  if (!FOOD_TABLE.some(entry => entry.name === name)) throw new Error(`Unknown food annotation: ${name}`);
}
for (const name of [...fermented, ...alcoholicNames, ...strongNames]) {
  if (!drinkSource.has(name)) throw new Error(`Unknown drink annotation: ${name}`);
}
if ([...strongNames].some(name => !alcoholicNames.has(name))) throw new Error("Strong drink annotation must also be alcoholic");
const matches = (entry, t) => (!entry.regions || entry.regions.includes(t.region) || entry.regions.includes("common"))
  && !entry.excludeRegions?.includes(t.region) && (!entry.terrains || entry.terrains.includes(t.terrain)) && (!entry.quality || entry.quality.includes(t.quality));
const twoBeds = new Set(["Комната на двоих", "Двухместная комната с печью", "Малый семейный покой"]);

function inspect(tavern) {
  const { food, drinks, lodging, services } = tavern.inventory;
  const available = (items, category) => items.filter(entry => !TavernAvailabilityService.forEntry(tavern, category, entry).disabled);
  const aFood = available(food, "food"), aDrinks = available(drinks, "drinks"), aServices = available(services, "services");
  const main = entry => !lightFood.has(entry.name);
  const neutral = entry => !alcoholic(drinkSource.get(entry.name)) && !fermented.has(entry.name);
  const cold = entry => coldFood.has(entry.name);
  const freeBeds = lodging.reduce((sum, entry) => sum + (entry.unlimited ? 99 : entry.stock * (twoBeds.has(entry.name) ? 2 : 1)), 0);
  const totalBeds = lodging.reduce((sum, entry) => sum + (entry.unlimited ? 99 : entry.total * (twoBeds.has(entry.name) ? 2 : 1)), 0);
  const hasStall = services.some(entry => entry.name === "Место в стойле");
  const hasFeed = services.some(entry => ["Корм для верхового животного", "Уход за лошадью"].includes(entry.name));
  const wash = entry => entry.cleanliness;
  const eligibleLocal = FOOD_TABLE.some(entry => entry.local && matches(entry, tavern));
  const eligibleWash = SERVICE_TABLE.some(entry => wash(entry) && matches(entry, tavern));
  const roomNeedsStable = lodging.some(entry => /конюшн|конн|лошад/.test(entry.name + " " + entry.desc));
  return {
    missingRequired: !TavernOfferingModel.status(tavern).complete,
    food: food.length, drinks: drinks.length, lodging: lodging.length, regularServices: services.filter(entry => !entry.resource).length,
    allServices: services.length, freeBeds, totalBeds, crowd: tavern.atmosphere.crowd,
    noMainMeal: !food.some(main), noAvailableMainMeal: !aFood.some(main), noHotMainMeal: !food.some(entry => main(entry) && !cold(entry)),
    noNeutralDrink: !drinks.some(neutral), noNeutralOrFermentedDrink: !drinks.some(entry => neutral(entry) || fermented.has(entry.name)),
    onlyStrongDrinks: drinks.length > 0 && drinks.every(entry => strong(drinkSource.get(entry.name))),
    noAlcoholicDrink: !drinks.some(entry => alcoholic(drinkSource.get(entry.name))),
    noLocalFood: !food.some(entry => entry.local), eligibleLocalFood: eligibleLocal,
    noLocalFoodDespitePool: eligibleLocal && !food.some(entry => entry.local), noLocalDrink: !drinks.some(entry => entry.local),
    noWashService: !services.some(wash), noAvailableWashService: !aServices.some(wash), eligibleWash,
    noWashDespitePool: eligibleWash && !services.some(wash),
    noWashFacilityListed: !services.some(wash) && !lodging.some(entry => /умыв|кувшин воды/.test(entry.name + " " + entry.desc)),
    noStall: !hasStall, noFeed: !hasFeed, stallWithoutFeed: hasStall && !hasFeed, roomNeedsStableWithoutStall: roomNeedsStable && !hasStall,
    noFoodResource: !services.some(entry => entry.resource?.kind === "food"), noWaterResource: !services.some(entry => entry.resource?.kind === "water"),
    noWaterCupOrResource: !drinks.some(neutral) && !services.some(entry => entry.resource?.kind === "water"),
    noAvailableWaterCupOrResource: !aDrinks.some(neutral) && !aServices.some(entry => entry.resource?.kind === "water"),
    noFreeLodging: freeBeds === 0, cannotSleepFour: freeBeds < 4,
    regionalOnlyServices: services.filter(entry => !entry.resource).every(entry => entry.local),
    fishOnlyFood: food.every(entry => /рыб|форел|треск|сардин|сельд|селед|улов/.test(entry.name)),
    soupOnlyFood: food.every(entry => /суп|похлеб|похлёб|^щи|бульон|тюря|^уха|наварка/i.test(entry.name)),
    noPrivateLodging: !lodging.some(entry => /отдельн(?:ая|ой|ую|ом|ый)\s+(?:комнат|поко|светел|каморк|спальн|кибитк|гостев)|всю комнату/.test(entry.desc)),
    cheapestFood: Math.min(...food.map(entry => entry.price)), cheapestDrink: Math.min(...drinks.map(entry => entry.price)),
    fourCanEat: aFood.filter(main).reduce((sum, entry) => sum + TavernAvailabilityService.forEntry(tavern, "food", entry).maxPurchaseQuantity, 0) >= 4,
    availableFoodPortions: aFood.reduce((sum, entry) => sum + TavernAvailabilityService.forEntry(tavern, "food", entry).maxPurchaseQuantity, 0),
    listedFoodPortions: food.reduce((sum, entry) => sum + (entry.stock ?? 0), 0),
    roomUnits: lodging.reduce((sum, entry) => sum + (entry.total ?? 0), 0)
  };
}
const brief = (tavern, sample, metrics) => ({ replay: `${tavern.region}/${tavern.quality}/${tavern.size}/${tavern.terrain}/${sample}`, metrics,
  food: tavern.inventory.food.map(({name,price,stock}) => ({name,price,stock})), drinks: tavern.inventory.drinks.map(({name,price,stock}) => ({name,price,stock})),
  lodging: tavern.inventory.lodging.map(({name,price,stock,total}) => ({name,price,stock,total})),
  services: tavern.inventory.services.map(({name,price,stock}) => ({name,price,stock})) });
if (args.has("--replay")) {
  const [region, quality, size, terrain, sample] = args.get("--replay").split("/");
  if (!Object.hasOwn(TAVERN_OPTIONS.regions, region) || !Object.hasOwn(TAVERN_OPTIONS.qualities, quality)
    || !Object.hasOwn(TAVERN_OPTIONS.sizes, size) || !Object.hasOwn(TAVERN_OPTIONS.terrains, terrain)
    || !/^\d+$/.test(sample ?? "") || args.get("--replay").split("/").length !== 5) throw new Error("Invalid replay key; see --help");
  const t = generate(region, quality, size, terrain, Number(sample));
  process.stdout.write(JSON.stringify(brief(t, Number(sample), inspect(t)), null, 2));
} else {
  const all = {}, groups = {}, examples = {}, frequency = { food: {}, drinks: {}, lodging: {}, services: {} }, combinations = [];
  function aggregate(group, metrics) {
    group.n = (group.n ?? 0) + 1;
    for (const [key,value] of Object.entries(metrics)) group[key] = (group[key] ?? 0) + Number(value);
  }
  let total = 0;
  for (const region of Object.keys(TAVERN_OPTIONS.regions)) {
    for (const quality of Object.keys(TAVERN_OPTIONS.qualities)) for (const size of Object.keys(TAVERN_OPTIONS.sizes)) for (const terrain of Object.keys(TAVERN_OPTIONS.terrains)) {
      if (args.has("--profile") && !args.get("--profile").split(",").includes(`${region}/${quality}/${size}/${terrain}`)) continue;
      const cell = { region, quality, size, terrain, totals: {} };
      for (let sample = 0; sample < samples; sample++) {
        const tavern = generate(region, quality, size, terrain, sample), metrics = inspect(tavern);
        aggregate(all, metrics); aggregate(cell.totals, metrics);
        for (const key of [`region:${region}`, `quality:${quality}`, `size:${size}`, `terrain:${terrain}`, `sizeQuality:${size}/${quality}`, `sizeTerrain:${size}/${terrain}`, `regionSize:${region}/${size}`]) aggregate(groups[key] ??= {}, metrics);
        for (const category of Object.keys(frequency)) for (const item of tavern.inventory[category]) frequency[category][item.name] = (frequency[category][item.name] ?? 0) + 1;
        for (const flag of ["noMainMeal", "noHotMainMeal", "onlyStrongDrinks", "noFreeLodging", "roomNeedsStableWithoutStall", "stallWithoutFeed", "noWaterCupOrResource", "soupOnlyFood", "noPrivateLodging"]) {
          if (metrics[flag] && (examples[flag] ??= []).length < 3) examples[flag].push(brief(tavern, sample, metrics));
        }
        // Targeted examples avoid reporting only the first neutral-region samples.
        if (size === "tiny" && terrain === "road" && quality === "modest" && (examples[region] ??= []).length < 1) examples[region].push(brief(tavern, sample, metrics));
        total++;
      }
      combinations.push(cell);
    }
    process.stderr.write(`${region}: ${total} taverns\n`);
  }
  if (!total) throw new Error("No matching profile; use region/quality/size/terrain catalogue keys");
  const output = { schema: 1, seed: "offering-audit-v1 + offering-audit-ids-v1; FNV-1a + mulberry32", samplesPerCombination: samples,
    settings: { seasonalPricingEnabled: false, priceMultiplier: 1, worldTime: 0, purchases: 0 },
    classification: { lightFood: [...lightFood], coldFood: [...coldFood], fermented: [...fermented], strong: [...strongNames], alcoholic: [...alcoholicNames], twoBeds: [...twoBeds] },
    all, groups, combinations, frequency, examples };
  if (args.has("--out")) await writeFile(args.get("--out"), JSON.stringify(output, null, 2), "utf8");
  process.stdout.write(JSON.stringify({ total, combinations: combinations.length, samples, all }, null, 2) + "\n");
}
