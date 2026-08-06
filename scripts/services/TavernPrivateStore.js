import { MODULE_ID } from "../constants.js";

const STORE_FLAG = "privateState";
const STORE_MARKER = "privateStateStore";
const STORE_NAME = "FBL Tavern Generator · GM State";
const STORE_WAIT_MS = 10_000;
const STORE_POLL_MS = 100;

export class TavernPrivateStore {
  static #active = false;
  static #journal = null;
  static #state = { current: null, saved: [] };
  static #hooksRegistered = false;

  static get active() {
    return this.#active;
  }

  static get state() {
    return foundry.utils.deepClone(this.#state);
  }

  static async initialize() {
    this.#active = false;
    this.#journal = null;
    this.#state = { current: null, saved: [] };

    if (!game.user?.isGM || typeof JournalEntry === "undefined" || !game.journal) return false;

    const { TavernSocket } = await import("./TavernSocket.js");
    let configuredId = String(game.settings.get(MODULE_ID, "privateStateJournalId") ?? "").trim();
    let journal = this.#findJournal(configuredId);

    if (!journal && !TavernSocket.isResponsibleGM()) {
      journal = await this.#waitForResponsibleStore(TavernSocket);
      configuredId = String(game.settings.get(MODULE_ID, "privateStateJournalId") ?? "").trim();
    }

    if (!journal && TavernSocket.isResponsibleGM()) journal = await this.#createJournal();
    if (!journal) {
      console.warn(`${MODULE_ID} | Private GM state store was not created by the responsible GM.`);
      return false;
    }

    const none = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
    const ownership = journal.ownership?.toObject?.() ?? journal.ownership ?? {};
    const ownershipUpdate = {};
    if (Number(ownership.default ?? none) !== none) ownershipUpdate["ownership.default"] = none;
    for (const userId of Object.keys(ownership)) {
      if (userId !== "default") ownershipUpdate[`ownership.-=${userId}`] = null;
    }
    if (Object.keys(ownershipUpdate).length) await journal.update(ownershipUpdate);

    this.#journal = journal;
    this.#active = true;
    this.#readFromJournal(journal);

    if (configuredId !== journal.id && TavernSocket.isResponsibleGM()) {
      await game.settings.set(MODULE_ID, "privateStateJournalId", journal.id);
    }
    this.#registerHooks();
    return true;
  }

  static async write(state) {
    if (!game.user?.isGM || !this.#active || !this.#journal) return false;
    const next = this.#sanitize(state);
    this.#state = next;
    await this.#journal.setFlag(MODULE_ID, STORE_FLAG, foundry.utils.deepClone(next));
    return true;
  }

  static #findJournal(configuredId = "") {
    const byId = configuredId ? game.journal.get?.(configuredId) : null;
    if (byId) return byId;
    return game.journal.find?.((entry) => entry.getFlag?.(MODULE_ID, STORE_MARKER) === true) ?? null;
  }

  static async #waitForResponsibleStore(TavernSocket) {
    const deadline = Date.now() + STORE_WAIT_MS;
    while (Date.now() < deadline) {
      const configuredId = String(game.settings.get(MODULE_ID, "privateStateJournalId") ?? "").trim();
      const journal = this.#findJournal(configuredId);
      if (journal) return journal;
      if (TavernSocket.isResponsibleGM()) return null;
      await new Promise((resolve) => globalThis.setTimeout(resolve, STORE_POLL_MS));
    }
    return null;
  }

  static async #createJournal() {
    return JournalEntry.create({
      name: STORE_NAME,
      ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
      flags: {
        [MODULE_ID]: {
          [STORE_MARKER]: true,
          [STORE_FLAG]: { current: null, saved: [] }
        }
      }
    }, { renderSheet: false });
  }

  static #registerHooks() {
    if (this.#hooksRegistered) return;
    this.#hooksRegistered = true;
    Hooks.on("updateJournalEntry", (journal) => {
      if (!this.#active || journal?.id !== this.#journal?.id) return;
      this.#journal = journal;
      this.#readFromJournal(journal);
      Hooks.callAll(`${MODULE_ID}.privateStateUpdated`, this.state);
    });
    Hooks.on("deleteJournalEntry", (journal) => {
      if (journal?.id !== this.#journal?.id) return;
      this.#active = false;
      this.#journal = null;
      this.#state = { current: null, saved: [] };
      console.warn(`${MODULE_ID} | Private GM state journal was deleted. It will be recreated after reload.`);
    });
  }

  static #readFromJournal(journal) {
    const raw = journal.getFlag?.(MODULE_ID, STORE_FLAG) ?? journal.flags?.[MODULE_ID]?.[STORE_FLAG];
    this.#state = this.#sanitize(raw);
  }

  static #sanitize(value) {
    return {
      current: value?.current ? foundry.utils.deepClone(value.current) : null,
      saved: Array.isArray(value?.saved) ? foundry.utils.deepClone(value.saved) : []
    };
  }
}
