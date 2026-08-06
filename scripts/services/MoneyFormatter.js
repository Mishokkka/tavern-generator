import { CURRENCY } from "../constants.js";

export class MoneyFormatter {
  static format(value) {
    return this.partsFromCopper(value).map((part) => `${part.amount} ${part.label}`).join(" ");
  }

  static formatHtml(value) {
    return this.partsFromCopper(value)
      .map((part) => `<span class="tg-money"><span class="tg-money__amount">${part.amount}</span><span class="tg-coin tg-coin--${part.code}">${part.label}</span></span>`)
      .join(" ");
  }

  static partsFromCopper(value) {
    const copper = Math.max(0, Math.trunc(Number(value) || 0));
    const gold = Math.floor(copper / CURRENCY.gold.rate);
    const silver = Math.floor((copper % CURRENCY.gold.rate) / CURRENCY.silver.rate);
    const cp = copper % CURRENCY.silver.rate;
    const parts = [];

    if (gold) parts.push(this.#part("gold", gold));
    if (silver) parts.push(this.#part("silver", silver));
    if (cp || !parts.length) parts.push(this.#part("copper", cp));

    return parts;
  }

  static partsFromCoins(coins = {}) {
    const parts = [];
    const gold = Math.max(0, Math.trunc(Number(coins.gold) || 0));
    const silver = Math.max(0, Math.trunc(Number(coins.silver) || 0));
    const copper = Math.max(0, Math.trunc(Number(coins.copper) || 0));

    if (gold) parts.push(this.#part("gold", gold));
    if (silver) parts.push(this.#part("silver", silver));
    if (copper || !parts.length) parts.push(this.#part("copper", copper));

    return parts;
  }

  static #part(code, amount) {
    const currency = CURRENCY[code] ?? CURRENCY.copper;
    return { code, amount, label: currency.label };
  }
}
