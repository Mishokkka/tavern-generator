import { FOOD_TABLE, DRINK_TABLE, SERVICE_TABLE } from "../data/index.js";

// Daily portions / customer visits, not the number of pots, tubs or employees.
const RANGES = {
  meal: [[6, 10], [10, 18], [16, 28], [28, 48]],
  batch: [[10, 16], [16, 28], [26, 44], [44, 72]],
  delicacy: [[3, 5], [4, 8], [6, 12], [10, 20]],
  drink: [[16, 28], [28, 48], [48, 80], [80, 140]],
  bottle: [[4, 8], [6, 12], [10, 20], [16, 32]],
  quick: [[8, 14], [12, 22], [20, 36], [32, 56]],
  bath: [[4, 8], [6, 12], [10, 18], [16, 28]],
  labor: [[2, 4], [3, 6], [5, 10], [8, 16]],
  space: [[2, 4], [4, 7], [6, 12], [10, 20]],
  provisions: [[6, 12], [12, 24], [24, 40], [40, 72]]
};

export class TavernStockService {
  static profile(entry) {
    if (entry.resource) return "provisions";
    if (entry.stockProfile && RANGES[entry.stockProfile]) return entry.stockProfile;
    const name = String(entry.name ?? "").toLocaleLowerCase("ru");
    if (entry.type === "drink") return /бутыл|кувшин/.test(name) ? "bottle" : "drink";
    if (entry.type === "food") {
      if (/икр|устриц|трюфел|дичь|перепел/.test(name)) return "delicacy";
      if (/суп|похлеб|похлёб|каша|рагу|хлеб|лепеш|лепёш|капуст|чечевиц|фасол/.test(name)) return "batch";
      return "meal";
    }
    if (/ванн|бадь|баня|бане|парная|купаль|массаж/.test(name) || Number(entry.cleanliness?.level) >= 2) return "bath";
    if (/стол|уголок|полка|полки|кладов|хранение|одеяло|стойл|чулан|сарае|аренда фонаря|грелка|сменная рубаха/.test(name)) return "space";
    if (/брить|почин|ремонт|заплат|перепис|перепись|копия|диктов|запись|проводник|носильщик|багаж до|заточ|стирка|полная чистка|чистка доспеха|ночной сторож|посыльн|заверка/.test(name)) return "labor";
    return "quick";
  }

  static range(entry, { size = "medium", quality = "modest", region = "common" } = {}) {
    const requestedIndex = ["tiny", "small", "medium", "large"].indexOf(size);
    const index = requestedIndex < 0 ? 2 : requestedIndex;
    const profile = this.profile(entry);
    const factor = ({ poor: 0.85, modest: 1, good: 1.1, fine: 1.15 })[quality] ?? 1;
    const waterFactor = entry.resource?.kind === "water" && region === "naerder" ? 0.5 : 1;
    const [min, max] = RANGES[profile][index].map((n) => Math.max(2, Math.round(n * factor * waterFactor)));
    return { profile, min, max };
  }

  static roll(entry, params) {
    const { min, max, profile } = this.range(entry, params);
    return { stock: min + Math.floor(Math.random() * (max - min + 1)), stockProfile: profile, stockModel: 1 };
  }

  static renewCapacities(tavern) {
    const clone = foundry.utils.deepClone(tavern);
    for (const [category, table] of [["food", FOOD_TABLE], ["drinks", DRINK_TABLE], ["services", SERVICE_TABLE]]) {
      for (const entry of clone.inventory?.[category] ?? []) {
        const catalogName = category === "services" && entry.name === "Путевой паек на день"
          ? "Дорожный обед в свёртке" : entry.name;
        const source = table.find((item) => item.name === entry.name)
          ?? table.find((item) => item.name === catalogName);
        if (!source || entry.unlimited) continue;
        const stock = this.roll(source, clone);
        Object.assign(entry, stock, { maxStock: stock.stock });
      }
    }
    return clone;
  }
}
