import { MODULE_ID } from "../constants.js";

export const PURCHASE_SOUND_CATEGORIES = {
  food: {
    setting: "purchaseSoundFood",
    label: "Еда",
    hint: "Звук, который услышит покупатель после успешной покупки еды."
  },
  drinks: {
    setting: "purchaseSoundDrinks",
    label: "Напитки",
    hint: "Звук, который услышит покупатель после успешной покупки напитка."
  },
  lodging: {
    setting: "purchaseSoundLodging",
    label: "Ночлег",
    hint: "Звук, который услышит покупатель после успешной оплаты ночлега."
  },
  services: {
    setting: "purchaseSoundServices",
    label: "Услуги",
    hint: "Звук, который услышит покупатель после успешной покупки услуги."
  }
};

const CATEGORY_ALIASES = {
  food: "food",
  meal: "food",
  meals: "food",
  drink: "drinks",
  drinks: "drinks",
  lodging: "lodging",
  room: "lodging",
  rooms: "lodging",
  service: "services",
  services: "services"
};

export class PurchaseSoundService {
  static registerSettings() {
    for (const [category, config] of Object.entries(PURCHASE_SOUND_CATEGORIES)) {
      game.settings.register(MODULE_ID, config.setting, {
        name: `Tavern Purchase Sound: ${config.label}`,
        hint: config.hint,
        scope: "world",
        config: false,
        type: String,
        default: ""
      });
    }

    game.settings.register(MODULE_ID, "purchaseSoundVolume", {
      name: "Tavern Purchase Sound Volume",
      hint: "Volume for tavern purchase sounds, from 0 to 1.",
      scope: "world",
      config: false,
      type: Number,
      default: 0.55
    });
  }

  static categories() {
    return foundry.utils.deepClone(PURCHASE_SOUND_CATEGORIES);
  }

  static settingKey(category) {
    const normalized = this.normalizeCategory(category);
    return normalized ? PURCHASE_SOUND_CATEGORIES[normalized]?.setting ?? null : null;
  }

  static normalizeCategory(category) {
    return CATEGORY_ALIASES[String(category ?? "").trim().toLocaleLowerCase("en-US")] ?? null;
  }

  static getPath(category) {
    const key = this.settingKey(category);
    if (!key) return "";
    return this.normalizePath(this.#setting(key, ""));
  }

  static getVolume() {
    const raw = Number(this.#setting("purchaseSoundVolume", 0.55));
    if (!Number.isFinite(raw)) return 0.55;
    return Math.min(1, Math.max(0, raw));
  }

  static normalizePath(path) {
    return String(path ?? "")
      .trim()
      .replace(/\\+/g, "/")
      .replace(/^Data\//i, "")
      .replace(/^data\//i, "")
      .replace(/^\/+/, "")
      .replace(/\/+$/, "");
  }

  static async setPath(category, path) {
    const key = this.settingKey(category);
    if (!key) throw new Error(`Unknown purchase sound category: ${category}`);
    return game.settings.set(MODULE_ID, key, this.normalizePath(path));
  }

  static async setVolume(volume) {
    const raw = Number(volume);
    const normalized = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.55;
    return game.settings.set(MODULE_ID, "purchaseSoundVolume", normalized);
  }

  static async playForCategory(category) {
    const src = this.getPath(category);
    if (!src) return null;
    try {
      return await this.play(src, this.getVolume());
    } catch (error) {
      console.debug(`${MODULE_ID} | Purchase sound playback failed`, error);
      return null;
    }
  }

  static async play(src, volume = 0.55) {
    try {
      const normalizedSrc = this.normalizePath(src);
      if (!normalizedSrc) return null;

      const audioHelper = foundry.audio?.AudioHelper ?? globalThis.AudioHelper;
      if (audioHelper?.play) {
        return await audioHelper.play({ src: normalizedSrc, volume, autoplay: true, loop: false }, false);
      }

      const audio = new Audio(normalizedSrc);
      audio.volume = volume;
      await audio.play();
      return audio;
    } catch (error) {
      console.debug(`${MODULE_ID} | Purchase sound playback failed`, error);
      return null;
    }
  }

  static #setting(key, fallback) {
    try {
      return game.settings.get(MODULE_ID, key) ?? fallback;
    } catch (_error) {
      return fallback;
    }
  }
}
