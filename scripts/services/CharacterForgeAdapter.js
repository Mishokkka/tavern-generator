import { MODULE_ID } from "../constants.js";
import { TAVERN_OPTIONS } from "../data/index.js";
import { TavernState } from "./TavernState.js";
import { FoundryDocumentUtils } from "./FoundryDocumentUtils.js";

const FORGE_MODULE_ID = "fbl-character-forge";
const DEFAULT_TAVERNKEEPER_FOLDER = "Тавернщики";
const DEFAULT_TAVERNKEEPER_PACK = "world.fbl-tavernkeepers";
const DEFAULT_TAVERNKEEPER_PACK_LABEL = "Таверны: тавернщики";

const REGION_TO_FORGE_NAME_SET = {
  common: "random",
  novandia: "novand",
  sangren: "sangren",
  flechenrand: "flechenrand",
  horslia: "horsliaOntakwa",
  ontakwa: "horsliaOntakwa",
  yaknizem: "yaknizem",
  tirabor: "tiribor",
  lezhnizem: "lezhnizem",
  sirost: "sirostyen",
  sarroyo: "seiku",
  royu_sageki: "royuSageki",
  royu_mideki: "royuMideki",
  naerder: "naerder",
  kaldvelg: "kaldvelg",
  izuaver: "izuaver",
  boltrask: "boltras",
  dichtbeir: "dikhtbeyr"
};

export class CharacterForgeAdapter {
  static registerSettings() {
    game.settings.register(MODULE_ID, "tavernkeeperFolderName", {
      name: "Папка актеров тавернщиков",
      hint: "Actor Folder, куда будут складываться случайные тавернщики, созданные через fbl-character-forge.",
      scope: "world",
      config: true,
      type: String,
      default: DEFAULT_TAVERNKEEPER_FOLDER
    });

    game.settings.register(MODULE_ID, "tavernkeeperArtSet", {
      name: "Набор артов тавернщиков",
      hint: "Ключ art set из fbl-character-forge. Пусто = использовать набор Character Forge по умолчанию.",
      scope: "world",
      config: true,
      type: String,
      default: ""
    });

    game.settings.register(MODULE_ID, "tavernkeeperCompendiumPack", {
      name: "Компендиум тавернщиков",
      hint: "World actor-compendium, куда будут архивироваться созданные тавернщики. Пример: world.fbl-tavernkeepers.",
      scope: "world",
      config: true,
      type: String,
      default: DEFAULT_TAVERNKEEPER_PACK
    });

    game.settings.register(MODULE_ID, "tavernkeeperArchiveByDefault", {
      name: "Архивировать тавернщиков по умолчанию",
      hint: "Если включено, новые тавернщики будут сохраняться в Actor-компендиум при создании.",
      scope: "world",
      config: true,
      type: Boolean,
      default: true
    });

    game.settings.register(MODULE_ID, "tavernkeeperPlaceTokenByDefault", {
      name: "Ставить токен тавернщика на сцену по умолчанию",
      hint: "Если включено, созданный тавернщик будет автоматически добавляться токеном на связанную сцену таверны, когда такая сцена уже есть.",
      scope: "world",
      config: true,
      type: Boolean,
      default: true
    });
  }

  static defaultConfig() {
    return {
      archiveToCompendium: Boolean(this.#setting("tavernkeeperArchiveByDefault", true)),
      placeTokenOnScene: Boolean(this.#setting("tavernkeeperPlaceTokenByDefault", true))
    };
  }

  static compendiumPackId() {
    const value = this.#setting("tavernkeeperCompendiumPack", DEFAULT_TAVERNKEEPER_PACK);
    return String(value || DEFAULT_TAVERNKEEPER_PACK).trim() || DEFAULT_TAVERNKEEPER_PACK;
  }

  static isModuleActive() {
    return Boolean(game.modules?.get?.(FORGE_MODULE_ID)?.active);
  }

  static api() {
    return game.fblCharacterForge ?? null;
  }

  static isAvailable() {
    return this.isModuleActive() && typeof this.api()?.createActor === "function";
  }

  static availabilityLabel() {
    if (!this.isModuleActive()) return "fbl-character-forge выключен";
    if (typeof this.api()?.createActor !== "function") return "нужен fbl-character-forge v1.4.0+";
    return "готов";
  }

  static mapRegionToNameSet(region) {
    const key = REGION_TO_FORGE_NAME_SET[region] || "random";
    const api = this.api();
    const nameSets = api?.getNameSets?.() ?? {};

    if (key === "random") return this.#randomNameSetKey(nameSets) || null;
    if (nameSets[key]) return key;

    // Compatibility fallback for older Character Forge settings that do not yet have izuaver.
    if (region === "izuaver" && nameSets.sirostyen) return "sirostyen";
    console.warn(`${MODULE_ID} | Character Forge name set '${key}' is unavailable for region '${region}', using a random set.`);
    return this.#randomNameSetKey(nameSets) || null;
  }

  static nameSetLabelForRegion(region, resolvedKey = null) {
    const api = this.api();
    const nameSets = api?.getNameSets?.() ?? {};
    const requestedKey = REGION_TO_FORGE_NAME_SET[region] || "random";
    if (resolvedKey) {
      const label = nameSets[resolvedKey]?.label || resolvedKey;
      return requestedKey === "random" ? `случайный набор (${label})` : label;
    }
    if (requestedKey === "random") return "случайный набор";
    if (nameSets[requestedKey]) return nameSets[requestedKey]?.label || requestedKey;
    if (region === "izuaver" && nameSets.sirostyen) return nameSets.sirostyen?.label || "sirostyen";
    return `нет набора (${requestedKey})`;
  }

  static getActorMeta(tavern) {
    const meta = tavern?.tavernkeeper ?? null;
    if (!meta?.actorId && !meta?.uuid) return null;

    const actor = meta.actorId ? game.actors?.get?.(meta.actorId) : null;
    return {
      ...meta,
      exists: Boolean(actor),
      archived: Boolean(meta.compendium?.id),
      currentName: actor?.name ?? meta.name ?? "Тавернщик удален",
      currentImg: actor?.img ?? meta.img ?? "icons/svg/mystery-man.svg"
    };
  }

  static async createTavernkeeper(tavern, { replace = true, archiveToCompendium = true } = {}) {
    if (!game.user?.isGM) throw new Error("Только ГМ может создавать тавернщиков.");
    if (!tavern) throw new Error("Сначала сгенерируй таверну.");
    if (!this.isAvailable()) throw new Error(`Character Forge недоступен: ${this.availabilityLabel()}.`);

    if (!replace && tavern.tavernkeeper?.actorId) {
      const existing = game.actors?.get?.(tavern.tavernkeeper.actorId);
      if (existing) return this.#metaFromActor(existing, tavern, tavern.tavernkeeper);
    }

    const api = this.api();
    const nameSetKey = this.mapRegionToNameSet(tavern.region);
    if (!nameSetKey) throw new Error("Character Forge не вернул подходящий набор имен.");

    const artSet = String(this.#setting("tavernkeeperArtSet", "") || "").trim() || null;
    const folderId = await this.#ensureWorldActorFolder(tavern.region);

    const result = await api.createActor({
      type: "character",
      nameSetKey,
      gender: "random",
      artSetKey: artSet || undefined,
      artSubsetKey: "tavern",
      fallbackArtSubset: true,
      folderId,
      createFolder: true,
      openSheet: true,
      assignArt: true,
      requireArt: false,
      sourceModule: MODULE_ID,
      purpose: "tavernkeeper",
      flags: {
        [MODULE_ID]: {
          role: "tavernkeeper",
          tavernId: tavern.id,
          tavernName: tavern.name,
          region: tavern.region,
          quality: tavern.quality,
          generatedAt: Date.now()
        }
      }
    });

    if (!result?.actor) throw new Error("Character Forge не создал актера.");

    let archive = null;
    if (archiveToCompendium !== false) {
      archive = await this.archiveActor(result.actor, tavern);
      try {
        await result.actor.setFlag(MODULE_ID, "compendium", archive);
      } catch (error) {
        console.debug(`${MODULE_ID} | Could not write tavernkeeper compendium flag`, error);
      }
    }

    return this.#metaFromActor(result.actor, tavern, {
      nameSet: result.nameDetails?.setKey || nameSetKey,
      nameSetLabel: this.nameSetLabelForRegion(tavern.region, result.nameDetails?.setKey || nameSetKey),
      resolvedGender: result.nameDetails?.gender || null,
      artSet: artSet || null,
      artSubset: result.art?.artSubsetKey || null,
      portrait: result.art?.portrait || null,
      token: result.art?.token || null,
      artError: result.artError?.message || null,
      compendium: archive
    });
  }

  static async archiveActor(actor, tavern) {
    if (!game.user?.isGM) throw new Error("Только ГМ может архивировать тавернщиков.");
    if (!actor) throw new Error("Актер тавернщика не найден.");

    const pack = await this.#ensureActorPack();
    const wasUnlocked = await this.#unlockPack(pack);

    try {
      const data = actor.toObject();
      delete data._id;
      delete data._stats;
      data.folder = await this.#ensurePackFolder(pack, this.#regionLabel(tavern?.region), "Actor");
      data.flags ??= {};
      data.flags[MODULE_ID] ??= {};
      data.flags[MODULE_ID].role = "tavernkeeper";
      data.flags[MODULE_ID].tavernId = tavern?.id ?? data.flags[MODULE_ID].tavernId;
      data.flags[MODULE_ID].tavernName = tavern?.name ?? data.flags[MODULE_ID].tavernName;
      data.flags[MODULE_ID].region = tavern?.region ?? data.flags[MODULE_ID].region;
      data.flags[MODULE_ID].sourceActorId = actor.id;
      data.flags[MODULE_ID].sourceActorUuid = actor.uuid;
      data.flags[MODULE_ID].archivedAt = Date.now();

      const existing = tavern?.id ? await this.#findArchivedActor(pack, tavern.id) : null;
      let archived;

      if (existing?._id) {
        const update = foundry.utils.deepClone(data);
        update._id = existing._id;
        const updated = await Actor.implementation.updateDocuments([update], { pack: pack.collection });
        archived = updated?.[0] ?? await pack.getDocument(existing._id);
      } else {
        const created = await Actor.implementation.createDocuments([data], { pack: pack.collection });
        archived = created?.[0];
      }

      if (!archived) throw new Error("Не удалось сохранить тавернщика в компендиум.");

      const archiveMeta = {
        pack: pack.collection,
        id: archived.id,
        uuid: archived.uuid,
        name: archived.name,
        archivedAt: Date.now()
      };

      try {
        await Actor.implementation.updateDocuments([{
          _id: archived.id,
          [`flags.${MODULE_ID}.compendium`]: archiveMeta
        }], { pack: pack.collection });
      } catch (error) {
        console.debug(`${MODULE_ID} | Could not write actor self compendium flag`, error);
      }

      return archiveMeta;
    } finally {
      await FoundryDocumentUtils.relockPack(pack, wasUnlocked);
    }
  }

  static async resolveTavernkeeperActor(metaOrTavern, { importFromCompendium = true } = {}) {
    const meta = metaOrTavern?.tavernkeeper ?? metaOrTavern;
    let actor = meta?.actorId ? game.actors?.get?.(meta.actorId) : null;
    if (!actor && importFromCompendium && meta?.compendium) {
      actor = await this.#importActorFromCompendium(meta.compendium, metaOrTavern?.region ?? meta?.region ?? null);
    }
    return actor ?? null;
  }

  static async openTavernkeeper(metaOrTavern) {
    const actor = await this.resolveTavernkeeperActor(metaOrTavern, { importFromCompendium: true });
    if (!actor) throw new Error("Актер тавернщика не найден. Возможно, он был удален.");
    actor.sheet?.render?.(true);
    return actor;
  }

  static async persistTavernkeeper(tavern, meta) {
    if (!game.user?.isGM) throw new Error("Только ГМ может сохранять тавернщиков.");
    if (!tavern) throw new Error("Таверна не выбрана.");

    const updated = foundry.utils.deepClone(tavern);
    updated.tavernkeeper = meta;
    updated.savedAt = Date.now();

    const saved = await TavernState.saveTavern(updated);
    const current = TavernState.getCurrent();
    if (current?.id === saved.id) await TavernState.setCurrent(saved);
    return saved;
  }

  static async #ensureActorPack() {
    const packId = this.compendiumPackId();
    let pack = game.packs.get(packId);
    if (pack) {
      this.#assertActorPack(pack);
      return pack;
    }

    if (!packId.startsWith("world.")) {
      throw new Error(`Компендиум ${packId} не найден. Создай его вручную или укажи world-compendium в настройках модуля.`);
    }

    const collectionName = this.#slugifyPackName(packId.split(".")[1] ?? "fbl-tavernkeepers");
    const CompendiumCollectionClass = globalThis.CompendiumCollection ?? foundry.documents?.collections?.CompendiumCollection;
    if (!CompendiumCollectionClass?.createCompendium) {
      throw new Error(`Компендиум ${packId} не найден, а API создания компендиума недоступен.`);
    }

    try {
      pack = await CompendiumCollectionClass.createCompendium({
        type: "Actor",
        label: DEFAULT_TAVERNKEEPER_PACK_LABEL,
        name: collectionName,
        package: "world"
      });
    } catch (_error) {
      pack = await CompendiumCollectionClass.createCompendium({
        documentName: "Actor",
        label: DEFAULT_TAVERNKEEPER_PACK_LABEL,
        name: collectionName,
        package: "world"
      });
    }

    this.#assertActorPack(pack);
    return pack;
  }

  static #assertActorPack(pack) {
    return FoundryDocumentUtils.assertPackType(pack, "Actor");
  }

  static async #unlockPack(pack) {
    return FoundryDocumentUtils.unlockPack(pack);
  }

  static async #findArchivedActor(pack, tavernId) {
    return FoundryDocumentUtils.findIndexEntryByFlag(pack, `flags.${MODULE_ID}.tavernId`, tavernId);
  }

  static async #importActorFromCompendium(compendium, region = null) {
    if (!game.user?.isGM) throw new Error("Только ГМ может восстановить тавернщика из компендиума.");
    if (!compendium?.pack || !compendium?.id) return null;

    const pack = game.packs.get(compendium.pack);
    if (!pack) throw new Error(`Компендиум тавернщиков не найден: ${compendium.pack}`);

    const archived = await pack.getDocument(compendium.id);
    if (!archived) throw new Error("Архивный тавернщик не найден в компендиуме.");

    const archivedData = archived.toObject();
    const resolvedRegion = region ?? archivedData.flags?.[MODULE_ID]?.region ?? null;
    const worldFolder = await this.#ensureWorldActorFolder(resolvedRegion);

    let actor = null;
    if (typeof game.actors?.importFromCompendium === "function") {
      actor = await game.actors.importFromCompendium(pack, compendium.id, { folder: worldFolder ?? null }, { keepId: false, renderSheet: false });
      if (actor && worldFolder && actor.folder?.id !== worldFolder && actor.folder !== worldFolder) {
        try {
          await actor.update({ folder: worldFolder });
        } catch (error) {
          console.debug(`${MODULE_ID} | Could not move imported tavernkeeper to folder`, error);
        }
      }
    } else {
      const data = archivedData;
      delete data._id;
      data.folder = worldFolder ?? null;
      actor = await Actor.create(data, { renderSheet: false });
    }

    return actor;
  }

  static async #ensureWorldActorFolder(region) {
    const rootName = String(this.#setting("tavernkeeperFolderName", DEFAULT_TAVERNKEEPER_FOLDER) || DEFAULT_TAVERNKEEPER_FOLDER).trim() || DEFAULT_TAVERNKEEPER_FOLDER;
    const root = await this.#ensureWorldFolder(rootName, "Actor", null);
    if (!region) return root?.id ?? null;

    const regionFolder = await this.#ensureWorldFolder(this.#regionLabel(region), "Actor", root?.id ?? null);
    return regionFolder?.id ?? root?.id ?? null;
  }

  static async #ensureWorldFolder(name, type, parent = null) {
    return FoundryDocumentUtils.ensureWorldFolder({ name, type, parent, fallbackName: DEFAULT_TAVERNKEEPER_FOLDER });
  }

  static async #ensurePackFolder(pack, name, type) {
    return FoundryDocumentUtils.ensurePackFolder(pack, {
      name,
      type,
      fallbackName: "Нейтральная дорога",
      logLabel: "Actor pack"
    });
  }

  static #regionLabel(region) {
    return TAVERN_OPTIONS.regions?.[region] ?? "Нейтральная дорога";
  }

  static #slugifyPackName(value) {
    return FoundryDocumentUtils.slugifyPackName(value, "fbl-tavernkeepers");
  }

  static #setting(key, fallback) {
    try {
      return game.settings.get(MODULE_ID, key) ?? fallback;
    } catch (_error) {
      return fallback;
    }
  }

  static #metaFromActor(actor, tavern, extra = {}) {
    return {
      actorId: actor.id,
      uuid: actor.uuid,
      name: actor.name,
      img: actor.img,
      tokenImg: actor.prototypeToken?.texture?.src ?? null,
      tavernId: tavern?.id ?? null,
      tavernName: tavern?.name ?? null,
      createdAt: Date.now(),
      ...extra
    };
  }

  static #randomNameSetKey(nameSets) {
    const keys = Object.keys(nameSets || {});
    if (!keys.length) return null;
    return keys[Math.floor(Math.random() * keys.length)];
  }
}
