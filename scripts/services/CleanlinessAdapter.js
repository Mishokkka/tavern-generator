import { MODULE_ID } from "../constants.js";

const EXPANDED_CONDITIONS_ID = "forbidden-lands-expanded-conditions";
const LEGACY_API_MODULE_IDS = [
  EXPANDED_CONDITIONS_ID,
  "fbl-expanded-conditions",
  "expanded-conditions",
  "fbl-expandedconditions",
  "expandedconditions"
];

const WASH_STATE_NAMES = Object.freeze([
  "Я в раю",
  "Хорошенько помытый",
  "Помытый",
  "Немытый",
  "Вонючка",
  "Грязнуля"
]);

const WASH_RANK = Object.freeze({
  "грязнуля": 0,
  "вонючка": 1,
  "немытый": 2,
  "помытый": 3,
  "хорошенько помытый": 4,
  "я в раю": 5
});

const WASH_CACHE_MISS_TTL_MS = 30_000;

const LEVEL_TO_WASH_STATE = Object.freeze({
  1: "Помытый",
  2: "Хорошенько помытый",
  3: "Я в раю"
});

export class CleanlinessAdapter {
  static customHandler = null;
  static #washSourceCache = new Map();

  static setHandler(handler) {
    this.customHandler = typeof handler === "function" ? handler : null;
  }

  static async applyFromEntry(actor, entry) {
    const cleanliness = entry?.cleanliness;
    const level = Number(cleanliness?.level ?? 0);
    if (!actor || !level) return null;

    const targetState = this.#resolveTargetState(cleanliness);
    const payload = {
      level,
      targetState,
      label: cleanliness?.label ?? targetState,
      source: MODULE_ID,
      serviceName: entry.name,
      updatedAt: Date.now()
    };

    if (this.customHandler) {
      await this.customHandler(actor, entry, payload);
      await actor.setFlag(MODULE_ID, "lastCleanlinessService", payload);
      return {
        applied: true,
        changed: true,
        method: "custom-handler",
        payload,
        message: `Помытость: ${payload.label}.`
      };
    }

    const expandedConditionsResult = await this.#tryExpandedConditionsWash(actor, payload);
    if (expandedConditionsResult) return expandedConditionsResult;

    const apiResult = await this.#tryLegacyApi(actor, payload);
    if (apiResult) return apiResult;

    const flagResult = await this.#tryFallbackFlags(actor, payload);
    if (flagResult) return flagResult;

    await actor.setFlag(MODULE_ID, "lastCleanlinessService", payload);
    Hooks.callAll(`${MODULE_ID}.cleanlinessPurchased`, actor, entry, payload);
    return {
      applied: true,
      changed: false,
      method: "module-fallback",
      payload,
      message: `Услуга помытости куплена: ${payload.label}. Expanded Conditions не найден.`
    };
  }

  static #resolveTargetState(cleanliness) {
    const explicit = String(cleanliness?.state ?? cleanliness?.targetState ?? "").trim();
    if (explicit) return this.#displayWashName(explicit) ?? explicit;

    const level = Math.max(1, Math.min(3, Math.trunc(Number(cleanliness?.level ?? 1))));
    return LEVEL_TO_WASH_STATE[level] ?? "Помытый";
  }

  static async #tryExpandedConditionsWash(actor, payload) {
    const module = game.modules.get(EXPANDED_CONDITIONS_ID);
    if (!module?.active) return null;

    const featureEnabled = this.#getSetting(EXPANDED_CONDITIONS_ID, "featureWash", true);
    if (!featureEnabled) {
      await actor.setFlag(MODULE_ID, "lastCleanlinessService", payload);
      return {
        applied: false,
        changed: false,
        method: "expanded-conditions-disabled",
        payload,
        message: "Помытость куплена, но функция помытости в Expanded Conditions отключена."
      };
    }

    const targetState = this.#displayWashName(payload.targetState) ?? "Помытый";
    const currentItem = this.#getCurrentWashItem(actor);
    const currentState = currentItem ? this.#displayWashName(currentItem.name) : null;

    const currentRank = this.#washRank(currentState);
    const targetRank = this.#washRank(targetState);

    if (currentState && currentRank >= targetRank) {
      await actor.setFlag(MODULE_ID, "lastCleanlinessService", {
        ...payload,
        targetState,
        resultingState: currentState,
        changed: false
      });
      return {
        applied: true,
        changed: false,
        method: "expanded-conditions-no-downgrade",
        payload: { ...payload, targetState, resultingState: currentState },
        message: `Помытость уже не ниже: ${currentState}.`
      };
    }

    const oldWashIds = actor.items
      .filter((item) => item.type === "criticalInjury" && this.#isWashName(item.name))
      .map((item) => item.id);

    const source = await this.#findWashConditionSource(targetState);
    const itemData = source ? source.toObject() : this.#makeFallbackWashItem(targetState);
    delete itemData._id;

    const created = await actor.createEmbeddedDocuments("Item", [itemData]);
    const createdId = created?.[0]?.id;
    try {
      if (oldWashIds.length) await actor.deleteEmbeddedDocuments("Item", oldWashIds);
    } catch (error) {
      if (createdId) {
        try {
          await actor.deleteEmbeddedDocuments("Item", [createdId]);
        } catch (rollbackError) {
          console.warn(`${MODULE_ID} | Failed to roll back new wash condition`, rollbackError);
        }
      }
      throw error;
    }
    const resultingState = created?.[0]?.name ?? targetState;
    const finalPayload = {
      ...payload,
      targetState,
      resultingState,
      changed: true
    };

    await actor.setFlag(MODULE_ID, "lastCleanlinessService", finalPayload);
    Hooks.callAll(`${MODULE_ID}.cleanlinessPurchased`, actor, null, finalPayload);

    return {
      applied: true,
      changed: true,
      method: source ? "expanded-conditions-critical-injury" : "expanded-conditions-fallback-item",
      payload: finalPayload,
      message: `Помытость: ${resultingState}.`
    };
  }

  static async #tryLegacyApi(actor, payload) {
    const apis = [];
    for (const id of LEGACY_API_MODULE_IDS) {
      const module = game.modules.get(id);
      if (module?.active && module.api) apis.push(module.api);
    }
    if (game.fblExpandedConditions) apis.push(game.fblExpandedConditions);
    if (game.expandedConditions) apis.push(game.expandedConditions);

    for (const api of apis) {
      for (const methodName of ["setCleanliness", "applyCleanliness", "setWashState", "applyWashState", "setWashed", "setWashLevel"]) {
        const method = api?.[methodName];
        if (typeof method !== "function") continue;
        try {
          await method.call(api, actor, payload.level, payload);
          Hooks.callAll(`${MODULE_ID}.cleanlinessPurchased`, actor, null, payload);
          return {
            applied: true,
            changed: true,
            method: `api.${methodName}`,
            payload,
            message: `Помытость: ${payload.label}.`
          };
        } catch (error) {
          console.warn(`${MODULE_ID} | Cleanliness API call failed: ${methodName}`, error);
        }
      }
    }

    return null;
  }

  static async #tryFallbackFlags(actor, payload) {
    const activeModuleId = LEGACY_API_MODULE_IDS.find((id) => game.modules.get(id)?.active);
    if (!activeModuleId) return null;

    await actor.update({
      [`flags.${activeModuleId}.washState`]: payload.targetState,
      [`flags.${activeModuleId}.cleanliness`]: payload.level,
      [`flags.${activeModuleId}.cleanlinessSource`]: payload.source,
      [`flags.${MODULE_ID}.lastCleanlinessService`]: payload
    });
    Hooks.callAll(`${MODULE_ID}.cleanlinessPurchased`, actor, null, payload);
    return {
      applied: true,
      changed: true,
      method: `flags.${activeModuleId}`,
      payload,
      message: `Помытость: ${payload.label}.`
    };
  }

  static #getCurrentWashItem(actor) {
    return actor.items.find((item) => item.type === "criticalInjury" && this.#isWashName(item.name)) ?? null;
  }

  static async #findWashConditionSource(name) {
    const normalized = this.#normalize(name);
    const cachedEntry = this.#washSourceCache.get(normalized);
    const cachedUuid = typeof cachedEntry === "string" ? cachedEntry : cachedEntry?.uuid;
    if (cachedEntry?.missUntil) {
      if (cachedEntry.missUntil > Date.now()) return null;
      this.#washSourceCache.delete(normalized);
    } else if (cachedUuid) {
      try {
        const cached = await globalThis.fromUuid?.(cachedUuid);
        if (cached?.type === "criticalInjury") return cached;
        this.#washSourceCache.delete(normalized);
      } catch (_error) {
        this.#washSourceCache.delete(normalized);
      }
    }

    const configuredUuids = this.#getSetting(EXPANDED_CONDITIONS_ID, "washStateUuids", {}) ?? {};
    const configuredUuid = configuredUuids[name] || configuredUuids[this.#displayWashName(name)] || configuredUuids[normalized];

    if (configuredUuid) {
      try {
        const document = await globalThis.fromUuid?.(configuredUuid);
        if (document?.type === "criticalInjury") return this.#cacheWashSource(normalized, document);
      } catch (error) {
        console.warn(`${MODULE_ID} | Failed to resolve wash UUID ${configuredUuid}`, error);
      }
    }

    const worldItem = game.items.find((item) => item.type === "criticalInjury" && this.#normalize(item.name) === normalized);
    if (worldItem) return this.#cacheWashSource(normalized, worldItem);

    const packs = Array.from(game.packs ?? [])
      .filter((pack) => pack.documentName === "Item")
      .sort((left, right) => this.#packPriority(right) - this.#packPriority(left));

    for (const pack of packs) {
      try {
        const index = await pack.getIndex({ fields: ["name", "type"] });
        const entry = index.find((item) => item.type === "criticalInjury" && this.#normalize(item.name) === normalized);
        if (!entry) continue;
        const document = await pack.getDocument(entry._id);
        if (document?.type === "criticalInjury") return this.#cacheWashSource(normalized, document);
      } catch (error) {
        console.debug(`${MODULE_ID} | Could not scan wash conditions in ${pack.collection}`, error);
      }
    }

    this.#washSourceCache.set(normalized, { missUntil: Date.now() + WASH_CACHE_MISS_TTL_MS });
    return null;
  }

  static #cacheWashSource(normalizedName, document) {
    if (document?.uuid) this.#washSourceCache.set(normalizedName, { uuid: document.uuid });
    return document;
  }

  static #packPriority(pack) {
    const haystack = `${pack?.collection ?? ""} ${pack?.metadata?.packageName ?? ""} ${pack?.metadata?.label ?? ""}`.toLocaleLowerCase("en-US");
    return haystack.includes(EXPANDED_CONDITIONS_ID) || haystack.includes("expanded-condition") ? 1 : 0;
  }

  static #makeFallbackWashItem(name) {
    return {
      name,
      type: "criticalInjury",
      system: {
        healingTime: "0",
        lethal: false,
        effect: "Состояние помытости.",
        timeLimit: "",
        description: "Состояние помытости, созданное модулем таверн."
      },
      flags: {
        [MODULE_ID]: {
          generatedWashState: true
        }
      }
    };
  }

  static #getSetting(moduleId, key, fallback) {
    try {
      return game.settings.get(moduleId, key);
    } catch (_error) {
      return fallback;
    }
  }

  static #displayWashName(name) {
    const normalized = this.#normalize(name);
    return WASH_STATE_NAMES.find((candidate) => this.#normalize(candidate) === normalized) ?? null;
  }

  static #isWashName(name) {
    return Boolean(this.#displayWashName(name));
  }

  static #washRank(name) {
    if (!name) return -1;
    return WASH_RANK[this.#normalize(name)] ?? -1;
  }

  static #normalize(value) {
    return String(value ?? "").trim().toLocaleLowerCase("ru-RU");
  }
}
