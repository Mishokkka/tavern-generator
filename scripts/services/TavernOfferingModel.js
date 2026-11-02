import { FOOD_OFFERINGS, DRINK_OFFERINGS, ROOM_OFFERINGS, SERVICE_OFFERINGS } from "../data/offerings.js";

const TABLES = { food: FOOD_OFFERINGS, drink: DRINK_OFFERINGS, room: ROOM_OFFERINGS, service: SERVICE_OFFERINGS };
const ALLOWED = {
  food: new Set(["meal", "side", "dessert"]), drink: new Set(["tableDrink", "fermentedDrink", "alcohol"]),
  room: new Set(["lodging"]), service: new Set(["wash", "animalBoarding", "animalFeed", "foodSupply", "waterSupply", "extra"])
};
const TRAVEL = new Set(["road", "port", "mountain", "wilderness"]);
const ANIMALS = new Set(["road", "village", "mountain", "wilderness"]);
const LABELS = {
  meal: "основное блюдо", tableDrink: "повседневный напиток", lodging: "вариант ночлега", localMeal: "местное основное блюдо", foodVariety: "разные виды еды",
  wash: "простое мытьё", animalBoarding: "место для животного", animalFeed: "корм или уход за животным",
  foodSupply: "пайки в дорогу", waterSupply: "вода в дорогу"
};

/** Meaning is independent of money, stock, translated labels and random rolls. */
export class TavernOfferingModel {
  static VERSION = 1;
  static labels = LABELS;

  static profile(entry = {}, type = entry.type) {
    const table = TABLES[type] ?? {};
    const source = entry.offering && typeof entry.offering === "object" ? entry.offering : Object.hasOwn(table, entry.name) ? table[entry.name] : {};
    const roles = [...new Set((Array.isArray(source.roles) ? source.roles : []).filter(role => ALLOWED[type]?.has(role)))];
    if (type === "service" && entry.resource?.kind === "food") roles.push("foodSupply");
    if (type === "service" && entry.resource?.kind === "water") roles.push("waterSupply");
    if (type === "service" && entry.cleanliness?.level) roles.push("wash");
    return { roles: [...new Set(roles)], ...(type === "food" ? { family: String(source.family || "house") } : {}),
      ...(type === "room" ? { beds: Math.max(1, Math.trunc(Number(source.beds) || 1)) } : {}),
      ...(source.animals ? { animals: true } : {}), ...(source.basic ? { basic: true } : {}) };
  }

  static has(entry, role, type = entry.type) { return this.profile(entry, type).roles.includes(role); }
  static annotate(entry, type = entry.type) { return { ...entry, offering: this.profile(entry, type) }; }
  static families(food = []) { return new Set(food.map(entry => this.profile(entry, "food")).filter(profile => profile.roles.length).map(profile => profile.family)); }

  static context(tavern, { preserve = true } = {}) {
    const inventory = tavern.inventory ?? {};
    const animals = (preserve && tavern.offeringPlan?.facilities?.animals === true) || ANIMALS.has(tavern.terrain)
      || (inventory.lodging ?? []).some(entry => this.profile(entry, "room").animals)
      || (inventory.services ?? []).some(entry => this.profile(entry, "service").animals
        || this.has(entry, "animalBoarding", "service") || this.has(entry, "animalFeed", "service"));
    return { animals, travelSupplies: TRAVEL.has(tavern.terrain) };
  }

  static coverage(tavern) {
    const inventory = tavern?.inventory ?? {}, food = inventory.food ?? [], drinks = inventory.drinks ?? [], services = inventory.services ?? [];
    return {
      meal: food.some(entry => this.has(entry, "meal", "food")),
      localMeal: food.some(entry => entry.local && this.has(entry, "meal", "food")),
      foodVariety: this.families(food).size >= 2,
      tableDrink: drinks.some(entry => this.has(entry, "tableDrink", "drink")),
      lodging: (inventory.lodging ?? []).some(entry => entry && typeof entry === "object"),
      ...Object.fromEntries(["wash", "animalBoarding", "animalFeed", "foodSupply", "waterSupply"]
        .map(role => [role, services.some(entry => this.has(entry, role, "service"))]))
    };
  }

  static required(tavern) {
    const context = this.context(tavern);
    return [...new Set(["meal", "tableDrink", "lodging", "wash", ...(context.animals ? ["animalBoarding", "animalFeed"] : []),
      ...(context.travelSupplies ? ["foodSupply", "waterSupply"] : []), ...(Array.isArray(tavern.offeringPlan?.required) ? tavern.offeringPlan.required : [])])].filter(role => Object.hasOwn(LABELS, role));
  }

  static status(tavern) {
    if (!tavern) return { complete: false, missing: [], summary: "Сначала создай таверну." };
    const covered = this.coverage(tavern);
    const missing = this.required(tavern).filter(role => !covered[role]).map(role => ({ role, label: LABELS[role] }));
    return { complete: missing.length === 0, missing, summary: missing.length ? `Не хватает: ${missing.map(item => item.label).join(", ")}` : "Еда, питьё и бытовые услуги обеспечены." };
  }

  static preservesMenu(before, after) {
    const previous = this.coverage(before), next = this.coverage(after);
    return ["meal", "tableDrink", "localMeal", "foodVariety"].every(role => !previous[role] || next[role]);
  }
}
