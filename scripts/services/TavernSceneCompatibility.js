import { MODULE_ID } from "../constants.js";

const ALWAYS_ALLOWED = new Set(["core", MODULE_ID]);

export class TavernSceneCompatibility {
  static filterFlags(flags, profile = "active") {
    const source = flags && typeof flags === "object" ? flags : {};
    if (profile === "all") return foundry.utils.deepClone(source);

    const result = {};
    for (const [moduleId, value] of Object.entries(source)) {
      if (ALWAYS_ALLOWED.has(moduleId)) {
        result[moduleId] = foundry.utils.deepClone(value);
        continue;
      }
      if (profile === "active" && game.modules.get(moduleId)?.active) {
        result[moduleId] = foundry.utils.deepClone(value);
      }
    }
    return result;
  }
}
