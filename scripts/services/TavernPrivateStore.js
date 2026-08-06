import { MODULE_ID } from "../constants.js";

const STORE_FLAG = "privateState";
const STORE_MARKER = "privateStateStore";
const STORE_NAME = "FBL Tavern Generator · GM State";

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

    const configuredId = String(game.settings.get(MODULE_ID, "privateStateJournalId") ?? "").trim();
    let journal = configuredId ? game.journal.get?.(configuredId) : null;
    if (!journal) {
      journal = game.journal.find?.((entry) => entry.getFlag?.(MODULE_ID, STORE_MARKER) === true) ?? null;
    }

    if (!journal) {
      journal = await JournalEntry.create({
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

    if (!journal) throw new Error("Не удалось создать закрытое хранилище таверн ГМа.");
    const none = CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE;
    if (Number(journal.ownership?.default ?? none) !== none) {
      await journal.update({ "ownership.default": none });
    }
    this.#journal = journal;
    this.#active = true;
    this.#readFromJournal(journal);

    if (configuredId !== journal.id) await game.settings.set(MODULE_ID, "privateStateJournalId", journal.id);
    this.#registerHooks();
    return true;
  }

  static async write(state) {
    if (!this.#active || !this.#journal) return false;
    const next = this.#sanitize(state);
    this.#state = next;
    await this.#journal.setFlag(MODULE_ID, STORE_FLAG, foundry.utils.deepClone(next));
    return true;
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
