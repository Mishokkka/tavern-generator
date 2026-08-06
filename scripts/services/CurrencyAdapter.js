import { CURRENCY, MODULE_ID } from "../constants.js";
import { MoneyFormatter } from "./MoneyFormatter.js";

const KNOWN_PATHS = [
  { gold: "system.currency.gold.value", silver: "system.currency.silver.value", copper: "system.currency.copper.value" },
  { gold: "system.currency.gold", silver: "system.currency.silver", copper: "system.currency.copper" },
  { gold: "system.coins.gold.value", silver: "system.coins.silver.value", copper: "system.coins.copper.value" },
  { gold: "system.coins.gold", silver: "system.coins.silver", copper: "system.coins.copper" },
  { gold: "system.money.gold.value", silver: "system.money.silver.value", copper: "system.money.copper.value" },
  { gold: "system.money.gold", silver: "system.money.silver", copper: "system.money.copper" }
];

export class CurrencyAdapter {
  static getWallet(actor) {
    const mode = game.settings.get(MODULE_ID, "currencyMode");
    const detected = mode === "auto" ? this.#detectPaths(actor) : null;
    if (detected) return { source: "actor", paths: detected, coins: this.#readPathWallet(actor, detected) };

    const flags = actor.getFlag(MODULE_ID, "wallet") ?? { gold: 0, silver: 0, copper: 0 };
    return { source: "flags", paths: null, coins: this.#sanitizeWallet(flags) };
  }

  static getTotal(actor) {
    return this.#total(this.getWallet(actor).coins);
  }

  static totalFromCoins(coins) {
    return this.#total(this.#sanitizeWallet(coins));
  }

  static canAfford(actor, price) {
    return this.getTotal(actor) >= price;
  }

  static assertCanAfford(actor, price) {
    const total = this.getTotal(actor);
    if (total < price) {
      throw new Error(`${actor.name}: не хватает денег. Нужно ${MoneyFormatter.format(price)}, есть ${MoneyFormatter.format(total)}.`);
    }
    return true;
  }

  static snapshot(actor) {
    const wallet = this.getWallet(actor);
    return {
      source: wallet.source,
      paths: wallet.paths ? foundry.utils.deepClone(wallet.paths) : null,
      coins: foundry.utils.deepClone(wallet.coins)
    };
  }

  static async restore(actor, snapshot) {
    if (!snapshot?.coins) throw new Error("Снимок кошелька поврежден.");
    const wallet = {
      source: snapshot.source === "actor" ? "actor" : "flags",
      paths: snapshot.paths ? foundry.utils.deepClone(snapshot.paths) : null
    };
    await this.#writeWallet(actor, wallet, this.#sanitizeWallet(snapshot.coins));
    return this.#sanitizeWallet(snapshot.coins);
  }

  static async spend(actor, price) {
    const wallet = this.getWallet(actor);
    const total = this.#total(wallet.coins);
    if (total < price) {
      throw new Error(`${actor.name}: не хватает денег. Нужно ${MoneyFormatter.format(price)}, есть ${MoneyFormatter.format(total)}.`);
    }

    const coins = this.#subtractPreservingDenominations(wallet.coins, price);
    await this.#writeWallet(actor, wallet, coins);
    return coins;
  }

  static async addFlagWallet(actor, coins = {}) {
    return this.#addToWallet(actor, coins, { forceFlags: true });
  }

  static async addMoney(actor, coins = {}) {
    return this.#addToWallet(actor, coins);
  }

  static async #addToWallet(actor, coins, { forceFlags = false } = {}) {
    const wallet = forceFlags
      ? {
          source: "flags",
          paths: null,
          coins: this.#sanitizeWallet(actor.getFlag(MODULE_ID, "wallet") ?? {})
        }
      : this.getWallet(actor);
    const delta = this.#sanitizeWallet(coins);
    const next = {
      gold: wallet.coins.gold + delta.gold,
      silver: wallet.coins.silver + delta.silver,
      copper: wallet.coins.copper + delta.copper
    };
    await this.#writeWallet(actor, wallet, next);
    return next;
  }

  static #detectPaths(actor) {
    for (const paths of KNOWN_PATHS) {
      const values = Object.values(paths).map((path) => foundry.utils.getProperty(actor, path));
      if (values.every((v) => v !== undefined && v !== null && !Number.isNaN(Number(v)))) return paths;
    }
    return null;
  }

  static #readPathWallet(actor, paths) {
    return this.#sanitizeWallet({
      gold: foundry.utils.getProperty(actor, paths.gold),
      silver: foundry.utils.getProperty(actor, paths.silver),
      copper: foundry.utils.getProperty(actor, paths.copper)
    });
  }

  static async #writeWallet(actor, wallet, coins) {
    if (wallet.source === "actor") {
      await actor.update({
        [wallet.paths.gold]: coins.gold,
        [wallet.paths.silver]: coins.silver,
        [wallet.paths.copper]: coins.copper
      });
      return;
    }

    await actor.setFlag(MODULE_ID, "wallet", coins);
  }

  static #sanitizeWallet(wallet) {
    return {
      gold: Math.max(0, Math.trunc(Number(wallet.gold) || 0)),
      silver: Math.max(0, Math.trunc(Number(wallet.silver) || 0)),
      copper: Math.max(0, Math.trunc(Number(wallet.copper) || 0))
    };
  }

  static #total(coins) {
    return (coins.gold * CURRENCY.gold.rate) + (coins.silver * CURRENCY.silver.rate) + coins.copper;
  }

  static #subtractPreservingDenominations(coins, price) {
    const next = { ...coins };
    let remaining = Math.trunc(price);

    const copperUsed = Math.min(next.copper, remaining);
    next.copper -= copperUsed;
    remaining -= copperUsed;
    if (remaining <= 0) return next;

    const silverNeeded = Math.ceil(remaining / CURRENCY.silver.rate);
    const silverUsed = Math.min(next.silver, silverNeeded);
    next.silver -= silverUsed;
    remaining -= silverUsed * CURRENCY.silver.rate;
    if (remaining <= 0) {
      this.#giveChange(next, Math.abs(remaining));
      return next;
    }

    const goldNeeded = Math.ceil(remaining / CURRENCY.gold.rate);
    if (next.gold < goldNeeded) throw new Error("Внутренняя ошибка кошелька: проверка достатка прошла, списание нет.");
    next.gold -= goldNeeded;
    remaining -= goldNeeded * CURRENCY.gold.rate;
    this.#giveChange(next, Math.abs(remaining));
    return next;
  }

  static #giveChange(coins, change) {
    if (!change) return;
    coins.silver += Math.floor(change / CURRENCY.silver.rate);
    coins.copper += change % CURRENCY.silver.rate;
  }
}
