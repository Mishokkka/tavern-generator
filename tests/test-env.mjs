let idCounter = 0;

function getProperty(object, path) {
  return String(path ?? "").split(".").filter(Boolean).reduce((value, key) => value?.[key], object);
}

function setProperty(object, path, value) {
  const keys = String(path ?? "").split(".").filter(Boolean);
  let target = object;
  for (const key of keys.slice(0, -1)) target = target[key] ??= {};
  if (keys.length) target[keys.at(-1)] = value;
  return true;
}

class ApplicationV2 {}
const HandlebarsApplicationMixin = (Base) => class extends Base {};

globalThis.foundry = {
  applications: {
    api: { ApplicationV2, HandlebarsApplicationMixin, DialogV2: { confirm: async () => true } }
  },
  utils: {
    deepClone: (value) => value == null ? value : structuredClone(value),
    randomID: (length = 16) => `test${String(++idCounter).padStart(Math.max(1, length - 4), "0")}`.slice(0, length),
    getProperty,
    setProperty,
    escapeHTML: (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[char]))
  }
};

const settings = new Map([
  ["fbl-tavern-generator.seasonalPricingEnabled", false],
  ["fbl-tavern-generator.dailyInventoryRefreshEnabled", false],
  ["fbl-tavern-generator.dailyMenuRotationEnabled", true],
  ["fbl-tavern-generator.calendariaIntegrationEnabled", false]
]);

globalThis.game = {
  settings: {
    get: (moduleId, key) => settings.get(`${moduleId}.${key}`),
    set: async (moduleId, key, value) => {
      settings.set(`${moduleId}.${key}`, value);
      return value;
    }
  },
  modules: new Map(),
  time: { worldTime: 0 },
  actors: [],
  users: [],
  scenes: new Map()
};

globalThis.Hooks = { on() {}, callAll() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };

export function setSetting(key, value) {
  settings.set(`fbl-tavern-generator.${key}`, value);
}

export function getSetting(key) {
  return settings.get(`fbl-tavern-generator.${key}`);
}

globalThis.canvas = { scene: null, tokens: { controlled: [] } };
globalThis.window = globalThis;
