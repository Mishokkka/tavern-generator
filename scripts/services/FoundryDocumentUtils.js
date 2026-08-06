import { MODULE_ID } from "../constants.js";

export class FoundryDocumentUtils {
  static #packUnlocks = new Map();
  static async ensureWorldFolder({ name, type, parent = null, fallbackName = "Папка" } = {}) {
    const normalizedName = String(name || fallbackName).trim() || fallbackName;
    const parentId = parent || null;
    const existing = game.folders?.find?.((folder) => (
      folder.type === type
      && folder.name === normalizedName
      && (folder.folder?.id ?? folder.parent ?? null) === parentId
    ));
    if (existing) return existing;

    const FolderClass = globalThis.Folder?.implementation ?? globalThis.Folder;
    if (!FolderClass?.create) return null;

    try {
      return await FolderClass.create({ name: normalizedName, type, folder: parentId, parent: parentId }, { renderSheet: false });
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not create ${type} folder "${normalizedName}"`, error);
      return null;
    }
  }

  static async ensurePackFolder(pack, { name, type, fallbackName = "Папка", logLabel = "pack" } = {}) {
    if (!pack?.collection) return null;
    const normalizedName = String(name || fallbackName).trim() || fallbackName;

    try {
      const index = await pack.getIndex({ fields: ["type", "folder", "name"] });
      const existing = index?.find?.((entry) => entry.type === "Folder" && entry.name === normalizedName) ?? null;
      if (existing?._id) return existing._id;
    } catch (_error) {
      // Some Foundry builds do not expose compendium folders in the pack index.
    }

    const FolderClass = globalThis.Folder?.implementation ?? globalThis.Folder;
    if (!FolderClass) return null;

    const folderData = { name: normalizedName, type, sorting: "a" };
    const attempts = [
      async () => FolderClass.createDocuments?.([folderData], { pack: pack.collection }),
      async () => FolderClass.create?.(folderData, { pack: pack.collection, renderSheet: false })
    ];

    for (const attempt of attempts) {
      try {
        const result = await attempt();
        const folder = Array.isArray(result) ? result[0] : result;
        if (folder?.id) return folder.id;
        if (folder?._id) return folder._id;
      } catch (error) {
        console.debug(`${MODULE_ID} | ${logLabel} folder creation attempt failed for ${pack.collection}`, error);
      }
    }

    return null;
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
      existing.count += 1;
      await existing.ready;
      return true;
    }
    if (!pack.locked) return false;

    const record = { count: 1, ready: null };
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
    record.count -= 1;
    if (record.count > 0) return true;
    this.#packUnlocks.delete(key);

    if (typeof pack.configure === "function") await pack.configure({ locked: true });
    else pack.locked = true;
    return true;
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
