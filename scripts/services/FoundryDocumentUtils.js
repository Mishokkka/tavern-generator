import { MODULE_ID } from "../constants.js";
import { AsyncLock } from "./AsyncLock.js";

export class FoundryDocumentUtils {
  static #packUnlocks = new Map();

  static async ensureWorldFolder(options = {}) {
    return AsyncLock.run(`world-folder:${options.type}`, () => this.#ensureFolder(game.folders, options));
  }

  static async ensurePackFolder(pack, options = {}) {
    if (!pack?.collection) return null;
    const folder = await AsyncLock.run(`pack-folder:${pack.collection}`, () =>
      this.#ensureFolder(pack.folders, options, { pack: pack.collection })
    );
    return folder?.id ?? folder?._id ?? null;
  }

  static async #ensureFolder(folders, { name, type, parent = null, fallbackName = "Папка", nameKey = String }, documentOptions = {}) {
    const normalizedName = String(name || fallbackName).trim() || fallbackName;
    const parentId = parent || null;
    const key = nameKey(normalizedName);
    const existing = folders?.find?.((folder) => (
      folder.type === type
      && nameKey(folder.name) === key
      && (folder._source?.folder ?? folder.folder?.id ?? folder.folder ?? null) === parentId
    ));
    if (existing) return existing;

    const FolderClass = globalThis.Folder?.implementation ?? globalThis.Folder;
    if (!FolderClass) return null;

    const data = { name: normalizedName, type, folder: parentId, sorting: "a" };
    const options = { ...documentOptions, renderSheet: false };
    try {
      if (FolderClass.create) return await FolderClass.create(data, options);

      const created = await FolderClass.createDocuments?.([data], options);
      return created?.[0] ?? null;
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not create ${type} folder "${normalizedName}" in ${options.pack ?? "world"}`, error);
      return null;
    }
  }

  static assertPackType(pack, expectedType) {
    const documentName = pack?.documentName ?? pack?.metadata?.type ?? pack?.metadata?.documentName;
    if (documentName && documentName !== expectedType) {
      throw new Error(`Компендиум ${pack.collection} хранит ${documentName}, а нужен ${expectedType}.`);
    }
  }

  static async unlockPack(pack) {
    const key = String(pack?.collection ?? "").trim();
    if (!key) return false;

    const existing = this.#packUnlocks.get(key);
    if (existing) {
      if (existing.relocking) {
        try {
          await existing.relocking;
        } catch (_error) {
          // A failed relock leaves the pack available and the record retryable.
        }
        return this.unlockPack(pack);
      }
      if (existing.count === 0 && pack.locked) {
        this.#packUnlocks.delete(key);
        return this.unlockPack(pack);
      }
      existing.count += 1;
      await existing.ready;
      return true;
    }
    if (!pack.locked) return false;

    const record = { count: 1, ready: null, relocking: null };
    record.ready = (async () => {
      if (typeof pack.configure === "function") await pack.configure({ locked: false });
      else pack.locked = false;
    })();
    this.#packUnlocks.set(key, record);

    try {
      await record.ready;
      return true;
    } catch (error) {
      if (this.#packUnlocks.get(key) === record) this.#packUnlocks.delete(key);
      throw error;
    }
  }

  static async relockPack(pack, wasUnlocked = false) {
    if (!pack || !wasUnlocked) return false;
    const key = String(pack.collection ?? "").trim();
    const record = key ? this.#packUnlocks.get(key) : null;
    if (!record) return false;

    await record.ready;
    if (record.relocking) return record.relocking;

    if (record.count > 0) record.count -= 1;
    if (record.count > 0) return true;

    record.relocking = (async () => {
      if (typeof pack.configure === "function") await pack.configure({ locked: true });
      else pack.locked = true;
      if (this.#packUnlocks.get(key) === record) this.#packUnlocks.delete(key);
      return true;
    })();

    try {
      return await record.relocking;
    } finally {
      if (this.#packUnlocks.get(key) === record) record.relocking = null;
    }
  }

  static async findIndexEntryByFlag(pack, flagPath, expectedValue) {
    if (!pack || expectedValue == null) return null;
    try {
      const index = await pack.getIndex({ fields: [flagPath] });
      return index.find((entry) => foundry.utils.getProperty(entry, flagPath) === expectedValue) ?? null;
    } catch (_error) {
      return null;
    }
  }

  static slugifyPackName(value, fallback = "pack") {
    return String(value ?? fallback)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || fallback;
  }
}
