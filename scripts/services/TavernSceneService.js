import { MODULE_ID } from "../constants.js";
import { TAVERN_OPTIONS } from "../data/index.js";
import { TavernState } from "./TavernState.js";
import { TavernPlayerApp } from "../apps/TavernPlayerApp.js";
import { CharacterForgeAdapter } from "./CharacterForgeAdapter.js";
import { TavernSocket } from "./TavernSocket.js";
import { TavernSceneCompatibility } from "./TavernSceneCompatibility.js";
import { FoundryDocumentUtils } from "./FoundryDocumentUtils.js";
import { TavernAtmosphereService } from "./TavernAtmosphereService.js";

const IMAGE_EXTENSIONS = /\.(avif|gif|jpe?g|png|webp)$/i;
const DEFAULT_ART_ROOT = "3_F00L/Scenes/Interior/Taverns";
const DEFAULT_SCENE_PACK = "world.fbl-tavern-scenes";
const DEFAULT_SCENE_PACK_LABEL = "Таверны: сцены";
const WORLD_SCENE_ROOT_FOLDER = "ТАВЕРНЫ";

const REGION_FOLDERS = {
  common: "common",
  novandia: "novandia",
  sangren: "sangren",
  flechenrand: "flechenrand",
  horslia: "horslia",
  ontakwa: "ontakwa",
  yaknizem: "yaknizem",
  tirabor: "tirabor",
  lezhnizem: "lezhnizem",
  sirost: "sirost",
  sarroyo: "sarroyo",
  royu_sageki: "royu_sageki",
  royu_mideki: "royu_mideki",
  naerder: "naerder",
  kaldvelg: "kaldvelg",
  izuaver: "izuaver",
  boltrask: "boltrask",
  dichtbeir: "dichtbeir"
};

const QUALITY_FOLDERS = {
  poor: "poor",
  modest: "modest",
  good: "good",
  fine: "fine"
};

const QUALITY_FALLBACK_ORDER = ["poor", "modest", "good", "fine"];

const QUALITY_FOLDER_ALIASES = {
  poor: ["poor", "cheap"],
  modest: ["modest", "ordinary"],
  good: ["good", "decent"],
  fine: ["fine", "expensive", "luxury", "good"]
};

const TEMPLATE_CHOICES = {
  standard: "Типовая таверна"
};

const NOTE_TYPES = {
  shop: "shop"
};

const STANDARD_TEMPLATE = {
  folder: null,
  name: "Таверна",
  navigation: false,
  navOrder: 8100000,
  navName: "Таверна",
  background: {
    src: "",
    scaleX: 1,
    scaleY: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    tint: "#ffffff",
    anchorX: 0,
    anchorY: 0,
    fit: "fill",
    alphaThreshold: 0
  },
  foreground: null,
  foregroundElevation: 4,
  width: 1456,
  height: 816,
  padding: 0.25,
  initial: {
    x: null,
    y: null,
    scale: null
  },
  backgroundColor: "#16191d",
  grid: {
    type: 0,
    size: 125,
    color: "#000000",
    alpha: 0.2,
    distance: 2,
    units: "m",
    style: "solidLines",
    thickness: 1
  },
  tokenVision: false,
  drawings: [],
  tokens: [],
  lights: [],
  notes: [],
  sounds: [],
  templates: [],
  tiles: [],
  walls: [],
  playlist: null,
  playlistSound: null,
  journal: null,
  journalEntryPage: null,
  weather: "",
  flags: {
    smalltime: {
      "darkness-link": false,
      "player-vis": "2",
      moonlight: false
    },
    weatherblock: {
      invertMask: false
    },
    "world-explorer": {
      enabled: false,
      color: "#000000",
      image: "",
      revealRadius: 0,
      gridRevealRadius: 0,
      opacityGM: 0.7,
      opacityPlayer: 1,
      persistExploredAreas: false,
      schemaVersion: "2.1.0",
      position: "behindDrawings",
      partialColor: "",
      partialOpacityPlayer: 0.4
    },
    LockView: {
      lockPan: true,
      lockPanInit: true,
      lockZoom: true,
      lockZoomInit: true,
      autoScale: "3",
      forceInit: false,
      boundingBox: false,
      boundingBoxInit: false,
      excludeSidebar: false,
      blackenSidebar: false,
      hideUI: false,
      collapseSidebar: false,
      editViewbox: false,
      hideUIelements: {
        logo: true,
        navigation: true,
        controls: true,
        players: true,
        hotbar: true,
        sidebar: false
      },
      rotation: 0,
      sidebar: {
        sceneLoad: "noChange",
        exclude: false,
        blacken: false
      },
      locks: {
        pan: true,
        zoom: true,
        boundingBox: false
      },
      ui: {
        hideOn: "off",
        "scene-controls": true,
        hotbar: true,
        "scene-navigation": true,
        players: true,
        sidebar: false,
        "chat-notifications": false,
        "camera-views": false
      },
      autoscale: "autoInside",
      forceInitialView: false
    },
    core: {},
    "token-attacher": {},
    "about-face": {
      lockRotation: true
    },
    fxmaster: {
      effects: {}
    },
    calendaria: {
      darknessSync: "default",
      brightnessMultiplier: 1,
      hudHideForPlayers: false,
      climateZoneOverride: "",
      weatherFxDisabled: true,
      fxmasterTopDownOverride: "default",
      weatherSoundDisabled: true
    }
  },
  regions: [],
  environment: {
    globalLight: {
      luminosity: 0,
      enabled: true,
      darkness: {
        max: 1,
        min: 0
      },
      alpha: 0.5,
      bright: false,
      color: null,
      coloration: 1,
      saturation: 0,
      contrast: 0,
      shadows: 0
    },
    darknessLevel: 0,
    darknessLock: true,
    cycle: true,
    base: {
      hue: 0,
      intensity: 0,
      luminosity: 0,
      saturation: 0,
      shadows: 0
    },
    dark: {
      hue: 0.7138888888888889,
      intensity: 0,
      luminosity: -0.25,
      saturation: 0,
      shadows: 0
    }
  },
  fog: {
    exploration: false,
    reset: 1683738480395,
    overlay: null,
    colors: {
      explored: null,
      unexplored: null
    }
  },
  ownership: {
    default: 0
  }
};

export class TavernSceneService {
  static #socketHandlersRegistered = false;
  static #sceneMenuButton = null;

  static registerSettings() {
    game.settings.register(MODULE_ID, "sceneArtRoot", {
      name: "Tavern Scene Art Root",
      hint: "Base Data path for tavern background images. Use Foundry paths without the Data/ prefix.",
      scope: "world",
      config: true,
      type: String,
      default: DEFAULT_ART_ROOT
    });

    game.settings.register(MODULE_ID, "sceneDefaultImageMode", {
      name: "Tavern Scene Default Image Mode",
      hint: "Default scene creation mode in the GM tavern window.",
      scope: "client",
      config: true,
      type: String,
      choices: this.sceneModeChoices(),
      default: "random"
    });

    game.settings.register(MODULE_ID, "sceneCompendiumPack", {
      name: "Tavern Scene Compendium Pack",
      hint: "World compendium used as archive for generated tavern scenes. Example: world.fbl-tavern-scenes.",
      scope: "world",
      config: true,
      type: String,
      default: DEFAULT_SCENE_PACK
    });

    game.settings.register(MODULE_ID, "sceneArchiveByDefault", {
      name: "Archive Tavern Scenes by Default",
      hint: "When enabled, generated tavern scenes are copied to a world Scene compendium.",
      scope: "world",
      config: true,
      type: Boolean,
      default: true
    });


    game.settings.register(MODULE_ID, "sceneCompatibilityProfile", {
      name: "Профиль совместимости сцен таверн",
      hint: "Определяет, какие флаги сторонних модулей добавляются в создаваемые сцены.",
      scope: "world",
      config: true,
      type: String,
      choices: {
        minimal: "Минимальный: только core и модуль таверн",
        active: "Активные модули: только установленные и включенные",
        all: "Все встроенные флаги совместимости"
      },
      default: "active"
    });
  }

  static registerCanvasHooks() {
    Hooks.on("canvasReady", () => {
      this.refreshSceneMenuButton();
      window.setTimeout(() => this.refreshSceneMenuButton(), 250);
      window.setTimeout(() => this.refreshSceneMenuButton(), 1500);
    });
    Hooks.on("canvasTearDown", () => this.#removeSceneMenuButton());
    Hooks.on("updateScene", (scene) => {
      if (scene?.id !== globalThis.canvas?.scene?.id) return;
      this.refreshSceneMenuButton();
    });
  }

  static registerSocketHandlers() {
    if (this.#socketHandlersRegistered) return;
    this.#socketHandlersRegistered = true;

    TavernSocket.on("tavern-link-request", async (payload) => {
      if (!game.user?.isGM) return;
      await this.#handleTavernLinkRequest(payload);
    });

    TavernSocket.on("tavern-link-result", async (payload) => {
      if (payload.userId !== game.user.id) return;
      await this.#handleTavernLinkResult(payload);
    });
  }

  static sceneModeChoices() {
    return {
      none: "Не создавать сцену",
      random: "Случайный фон",
      manual: "Выбрать фон вручную"
    };
  }

  static templateChoices() {
    return foundry.utils.deepClone(TEMPLATE_CHOICES);
  }

  static regionFolders() {
    return foundry.utils.deepClone(REGION_FOLDERS);
  }

  static qualityFolders() {
    return foundry.utils.deepClone(QUALITY_FOLDERS);
  }

  static compendiumPackId() {
    const value = this.#setting("sceneCompendiumPack", DEFAULT_SCENE_PACK);
    return String(value || DEFAULT_SCENE_PACK).trim() || DEFAULT_SCENE_PACK;
  }

  static defaultConfig() {
    const mode = this.#setting("sceneDefaultImageMode", "random");
    return {
      mode,
      manualImagePath: "",
      templateId: "standard",
      openAfterCreate: true,
      activateScene: false,
      showPlayers: false,
      archiveToCompendium: Boolean(this.#setting("sceneArchiveByDefault", true)),
      createShopNote: true
    };
  }

  static artRoot() {
    return this.normalizePath(this.#setting("sceneArtRoot", DEFAULT_ART_ROOT)) || DEFAULT_ART_ROOT;
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

  static async browseForImage({ current = "", callback } = {}) {
    const FilePickerClass = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    if (!FilePickerClass) return ui.notifications.error("FilePicker недоступен.");

    const picker = new FilePickerClass({
      type: "image",
      current: this.normalizePath(current) || this.artRoot(),
      allowUpload: true,
      callback: (path) => callback?.(this.normalizePath(path))
    });

    return picker.render(true);
  }

  static async createSceneForTavern(tavern, config = {}) {
    if (!game.user.isGM) throw new Error("Только ГМ может создавать сцены таверн.");
    if (!tavern) throw new Error("Сначала сгенерируй таверну.");

    const mode = config.mode ?? "random";
    if (mode === "none") throw new Error("Создание сцены выключено.");

    const imagePath = mode === "manual"
      ? this.normalizePath(config.manualImagePath)
      : await this.randomImagePath({ region: tavern.region, quality: tavern.quality });

    if (!imagePath) throw new Error("Фон сцены не выбран.");

    const template = this.#template(config.templateId ?? "standard");
    const sceneData = foundry.utils.deepClone(template);
    const compatibilityProfile = this.#setting("sceneCompatibilityProfile", "active");
    sceneData.flags = TavernSceneCompatibility.filterFlags(sceneData.flags, compatibilityProfile);
    const dimensions = await this.#imageDimensions(imagePath);
    const sceneName = tavern.name;

    sceneData.name = sceneName;
    sceneData.navName = tavern.name;
    sceneData.folder = await this.#ensureWorldSceneFolder(tavern.region);
    sceneData.background ??= {};
    sceneData.background.src = imagePath;
    sceneData.thumb = null;

    if (dimensions?.width && dimensions?.height) {
      sceneData.width = dimensions.width;
      sceneData.height = dimensions.height;
    }

    const tavernPublicView = TavernAtmosphereService.publicView(tavern);
    sceneData.flags ??= {};
    sceneData.flags[MODULE_ID] = {
      tavernId: tavern.id,
      tavernName: tavern.name,
      region: tavern.region,
      quality: tavern.quality,
      imagePath,
      tavernPublicView,
      createdAt: Date.now()
    };

    const scene = await Scene.create(sceneData);

    let shopNote = null;
    if (config.createShopNote !== false) {
      shopNote = await this.createShopButton(scene, tavern, { imagePath });
    } else {
      await scene.setFlag(MODULE_ID, "shopButtonEnabled", false);
    }

    let tavernkeeperToken = null;
    try {
      tavernkeeperToken = await this.placeTavernkeeperToken(scene, tavern, { replaceExisting: true, importActor: false });
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not place tavernkeeper token on created scene`, error);
    }

    let archive = null;
    if (config.archiveToCompendium !== false) {
      archive = await this.archiveScene(scene, tavern);
      await scene.setFlag(MODULE_ID, "compendium", archive);
    }

    const meta = {
      id: scene.id,
      uuid: scene.uuid,
      name: scene.name,
      img: imagePath,
      createdAt: Date.now(),
      shopNoteId: shopNote?.id ?? null,
      tavernkeeperTokenId: tavernkeeperToken?.id ?? null,
      compendium: archive
    };

    if (config.activateScene || config.showPlayers) await scene.activate();
    if (config.openAfterCreate) await scene.view();
    if (config.showPlayers) game.socket?.emit("pullToScene", scene.id);

    return { scene, meta, archive, shopNote };
  }

  static async syncLinkedTavernData(tavern) {
    if (!game.user?.isGM) throw new Error("Только ГМ может обновлять данные таверны на сцене.");
    if (!tavern?.id) return { updated: false, scene: null };

    const sceneId = tavern.scene?.id ?? null;
    const scene = sceneId ? game.scenes?.get(sceneId) : null;
    if (!scene) return { updated: false, scene: null };

    const publicData = TavernAtmosphereService.publicView(tavern);
    const update = {
      [`flags.${MODULE_ID}.tavernPublicView`]: publicData,
      [`flags.${MODULE_ID}.-=tavernData`]: null
    };

    const existingLink = scene.getFlag?.(MODULE_ID, "shopButton") ?? scene.flags?.[MODULE_ID]?.shopButton;
    if (existingLink) {
      const nextLink = foundry.utils.deepClone(existingLink);
      nextLink.tavernId = tavern.id;
      nextLink.tavernName = tavern.name;
      nextLink.tavernPublicView = publicData;
      delete nextLink.tavernData;
      nextLink.updatedAt = Date.now();
      update[`flags.${MODULE_ID}.shopButton`] = nextLink;
    }
    await scene.update(update);

    if (globalThis.canvas?.scene?.id === scene.id) this.refreshSceneMenuButton();
    return { updated: true, scene };
  }

  static async sanitizePublicSceneData() {
    if (!game.user?.isGM) return { updatedScenes: 0 };

    const scenes = game.scenes?.contents ?? Array.from(game.scenes ?? []);
    let updatedScenes = 0;

    for (const scene of scenes) {
      let changed = false;
      const legacyTavernData = scene.getFlag?.(MODULE_ID, "tavernData") ?? scene.flags?.[MODULE_ID]?.tavernData;
      const tavernPublicView = scene.getFlag?.(MODULE_ID, "tavernPublicView") ?? scene.flags?.[MODULE_ID]?.tavernPublicView;
      if (legacyTavernData || this.#containsPrivateAtmosphere(tavernPublicView)) {
        const source = legacyTavernData ?? tavernPublicView;
        await scene.update({
          [`flags.${MODULE_ID}.tavernPublicView`]: TavernAtmosphereService.publicView(source),
          [`flags.${MODULE_ID}.-=tavernData`]: null
        });
        changed = true;
      }

      const link = scene.getFlag?.(MODULE_ID, "shopButton") ?? scene.flags?.[MODULE_ID]?.shopButton;
      if (link?.tavernData || this.#containsPrivateAtmosphere(link?.tavernPublicView)) {
        const sanitizedLink = foundry.utils.deepClone(link);
        sanitizedLink.tavernPublicView = TavernAtmosphereService.publicView(link.tavernData ?? link.tavernPublicView);
        delete sanitizedLink.tavernData;
        await scene.setFlag(MODULE_ID, "shopButton", sanitizedLink);
        changed = true;
      }

      if (changed) updatedScenes += 1;
    }

    return { updatedScenes };
  }

  static async createShopButton(scene, tavern, extra = {}) {
    if (!game.user.isGM) throw new Error("Только ГМ может создавать кнопку меню таверны.");
    if (!scene) throw new Error("Сцена таверны не найдена.");
    if (!tavern) throw new Error("Таверна не выбрана.");

    const link = this.#linkData({
      type: NOTE_TYPES.shop,
      tavern,
      sceneId: scene.id,
      sceneUuid: scene.uuid,
      imagePath: extra.imagePath ?? tavern.scene?.img ?? scene.background?.src,
      compendium: tavern.scene?.compendium ?? scene.getFlag?.(MODULE_ID, "compendium") ?? null
    });

    await scene.update({
      [`flags.${MODULE_ID}.shopButton`]: link,
      [`flags.${MODULE_ID}.shopButtonEnabled`]: true
    });

    if (globalThis.canvas?.scene?.id === scene.id) this.refreshSceneMenuButton();

    return {
      id: "scene-shop-button",
      type: NOTE_TYPES.shop,
      sceneId: scene.id
    };
  }


  static async createShopNote(scene, tavern, extra = {}) {
    return this.createShopButton(scene, tavern, extra);
  }

  static async placeTavernkeeperOnLinkedScene(tavern, { replaceExisting = true, archiveScene = true, importActor = true } = {}) {
    if (!game.user?.isGM) throw new Error("Только ГМ может ставить токен тавернщика на сцену.");
    if (!tavern?.tavernkeeper) return null;
    if (!tavern?.scene?.id) return null;

    const scene = game.scenes?.get(tavern.scene.id);
    if (!scene) return null;

    const token = await this.placeTavernkeeperToken(scene, tavern, { replaceExisting, importActor });
    if (!token) return null;

    if (archiveScene && tavern.scene?.compendium) {
      const archive = await this.archiveScene(scene, tavern);
      await scene.setFlag(MODULE_ID, "compendium", archive);
      tavern.scene.compendium = archive;
    }

    return { scene, token };
  }

  static async placeTavernkeeperToken(scene, tavern, { replaceExisting = true, importActor = true } = {}) {
    if (!game.user?.isGM) throw new Error("Только ГМ может ставить токен тавернщика на сцену.");
    if (!scene || !tavern?.tavernkeeper) return null;

    const actor = await CharacterForgeAdapter.resolveTavernkeeperActor(tavern, { importFromCompendium: importActor });
    if (!actor) return null;

    const existing = this.#findTavernkeeperTokens(scene, tavern);
    if (replaceExisting && existing.length) {
      const keep = existing[0];
      const deleteIds = existing.slice(1).map((token) => token.id).filter(Boolean);
      if (deleteIds.length) await scene.deleteEmbeddedDocuments("Token", deleteIds);

      const tokenData = this.#tokenDataForTavernkeeper(actor, scene, tavern, keep);
      const updated = await scene.updateEmbeddedDocuments("Token", [{ _id: keep.id, ...tokenData }]);
      return updated?.[0] ?? scene.tokens?.get?.(keep.id) ?? keep;
    }

    const tokenData = this.#tokenDataForTavernkeeper(actor, scene, tavern);
    const created = await scene.createEmbeddedDocuments("Token", [tokenData]);
    return created?.[0] ?? null;
  }

  static async archiveScene(scene, tavern) {
    if (!game.user.isGM) throw new Error("Только ГМ может архивировать сцены таверн.");
    if (!scene) throw new Error("Сцена для архивации не найдена.");

    const pack = await this.#ensureScenePack();
    const wasUnlocked = await this.#unlockPack(pack);

    try {
      const data = scene.toObject();
      delete data._id;
      delete data._stats;
      data.folder = await this.#ensurePackFolder(pack, this.#regionLabel(tavern?.region ?? data.flags?.[MODULE_ID]?.region), "Scene");
      data.thumb = null;
      data.flags ??= {};
      data.flags[MODULE_ID] ??= {};
      data.flags[MODULE_ID].tavernId = tavern?.id ?? data.flags[MODULE_ID].tavernId;
      data.flags[MODULE_ID].tavernName = tavern?.name ?? data.flags[MODULE_ID].tavernName;
      data.flags[MODULE_ID].sourceSceneId = scene.id;
      data.flags[MODULE_ID].sourceSceneUuid = scene.uuid;
      data.flags[MODULE_ID].archivedAt = Date.now();

      const existing = tavern?.id ? await this.#findArchivedScene(pack, tavern.id) : null;
      let archived;

      if (existing?._id) {
        const update = foundry.utils.deepClone(data);
        update._id = existing._id;
        const updated = await Scene.implementation.updateDocuments([update], { pack: pack.collection });
        archived = updated?.[0] ?? await pack.getDocument(existing._id);
      } else {
        const created = await Scene.implementation.createDocuments([data], { pack: pack.collection });
        archived = created?.[0];
      }

      if (!archived) throw new Error("Не удалось сохранить сцену в компендиум.");

      const archiveMeta = {
        pack: pack.collection,
        id: archived.id,
        uuid: archived.uuid,
        name: archived.name,
        archivedAt: Date.now()
      };

      try {
        await Scene.implementation.updateDocuments([{
          _id: archived.id,
          [`flags.${MODULE_ID}.compendium`]: archiveMeta
        }], { pack: pack.collection });
      } catch (error) {
        console.debug(`${MODULE_ID} | Could not write self compendium flag`, error);
      }

      return archiveMeta;
    } finally {
      await FoundryDocumentUtils.relockPack(pack, wasUnlocked);
    }
  }

  static async randomImagePath({ region = "common", quality = "modest" } = {}) {
    const tried = [];

    for (const folderPath of this.#candidateFolders(region, quality)) {
      tried.push(folderPath);
      const files = await this.#imageFiles(folderPath);
      if (files.length) return files[Math.floor(Math.random() * files.length)];
    }

    throw new Error(this.#missingImagesMessage(tried));
  }

  static refreshSceneMenuButton() {
    this.#removeSceneMenuButton();

    const scene = globalThis.canvas?.scene;
    if (!scene) return;

    const link = this.#linkFromScene(scene);
    if (!link) return;

    const holder = document.createElement("div");
    holder.className = "fbl-tavern-scene-button";
    holder.innerHTML = `
      <button type="button" data-tooltip="Открыть меню таверны" data-tooltip-direction="UP" aria-label="Открыть меню таверны">
        <i class="fa-solid fa-beer-mug-empty"></i>
        <span>${this.#escapeHtml(link.tavernName ?? "Таверна")}</span>
      </button>
    `;

    holder.querySelector("button")?.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await TavernSceneService.openTavernLink(link);
      } catch (error) {
        console.error(error);
        ui.notifications.error(error.message ?? "Не удалось открыть меню таверны.");
      }
    });

    (document.getElementById("interface") ?? document.body).appendChild(holder);
    this.#sceneMenuButton = holder;
  }

  static async openLinkedScene(tavernOrSceneId) {
    if (typeof tavernOrSceneId === "string") {
      const scene = game.scenes?.get(tavernOrSceneId);
      if (!scene) throw new Error("Связанная сцена не найдена.");
      await scene.view();
      return { scene };
    }

    const tavern = tavernOrSceneId;
    const scene = await this.#resolveSceneForTavern(tavern, { allowImport: true });
    if (!scene) throw new Error("Связанная сцена не найдена.");
    await scene.view();
    return { scene, tavern };
  }

  static async openTavernLink(link) {
    const normalized = this.#normalizeLink(link);
    if (!normalized) throw new Error("Связь таверны повреждена.");

    if (!game.user.isGM) {
      const tavern = this.#recoverPublicTavernFromLink(normalized);
      if (tavern) {
        TavernPlayerApp.openSingleton({ tavern });
        return { scene: globalThis.canvas?.scene ?? null, tavern };
      }

      const targetGM = TavernSocket.responsibleGMId();
      if (!targetGM) throw new Error("Нет активного ГМа, который может открыть связанную таверну.");
      await TavernSocket.emit({
        type: "tavern-link-request",
        targetGM,
        link: normalized
      });
      return null;
    }

    return this.#openTavernLinkAsGM(normalized, { requestingUserId: null });
  }

  static async activateTavernLink(link) {
    return this.openTavernLink(link);
  }

  static async #handleTavernLinkRequest(payload) {
    try {
      const result = await this.#openTavernLinkAsGM(payload.link, { requestingUserId: payload.sender });
      await TavernSocket.emitToUser({
        type: "tavern-link-result",
        userId: payload.sender,
        ok: true,
        sceneId: result.scene?.id,
        tavernId: result.tavern?.id,
        tavernData: TavernAtmosphereService.publicView(result.tavern),
        message: `Открыта таверна: ${result.tavern?.name ?? "без названия"}`
      }, payload.sender);
    } catch (error) {
      console.error(`${MODULE_ID} | Tavern link activation failed`, error);
      await TavernSocket.emitToUser({
        type: "tavern-link-result",
        userId: payload.sender,
        ok: false,
        message: error.message ?? String(error)
      }, payload.sender);
    }
  }

  static async #handleTavernLinkResult(payload) {
    if (!payload.ok) {
      ui.notifications.warn(payload.message ?? "Не удалось открыть таверну.");
      return;
    }

    const scene = await this.#waitForScene(payload.sceneId);
    if (scene) await scene.view();
    TavernPlayerApp.openSingleton({ tavern: payload.tavernData ?? null });
    ui.notifications.info(payload.message ?? "Таверна открыта.");
  }

  static async #openTavernLinkAsGM(link, { requestingUserId = null } = {}) {
    if (!game.user.isGM) throw new Error("Только ГМ может открыть связанную таверну.");

    let tavern = this.#recoverTavernFromLink(link);
    let scene = null;

    // A scene created by this module is a trusted Foundry document. If the private
    // tavern record was cleared or deleted later, recover the public snapshot from
    // the real world Scene instead of trusting data carried in the socket payload.
    if (!tavern) {
      const recovered = this.#recoverTavernFromTrustedScene(link);
      tavern = recovered?.tavern ?? null;
      scene = recovered?.scene ?? null;
    }

    if (!tavern) throw new Error("Не удалось восстановить данные таверны из метки.");

    scene ??= await this.#resolveSceneForLink(link, tavern, { allowImport: true });
    if (!scene) throw new Error("Связанная сцена таверны не найдена и не восстановлена из компендиума.");

    const sceneMeta = this.#sceneMeta(scene, tavern, link);
    tavern.scene = sceneMeta;

    // Explicitly opening a valid linked Scene restores its snapshot into the GM
    // private store. This makes subsequent purchases authoritative again without
    // ever accepting a client-supplied tavern object as trusted state.
    tavern = await TavernState.saveTavern(tavern);
    Hooks.callAll(`${MODULE_ID}.refresh`, { sender: game.user.id });

    if (!requestingUserId) {
      await scene.view();
      TavernPlayerApp.openSingleton({ tavern });
    }

    return { scene, tavern };
  }

  static #recoverPublicTavernFromLink(link) {
    if (link?.tavernPublicView) return TavernAtmosphereService.publicView(link.tavernPublicView);
    if (link?.tavernData) return TavernAtmosphereService.publicView(link.tavernData);

    const worldScene = link?.sceneId ? game.scenes?.get(link.sceneId) : null;
    const sceneTavernData = worldScene?.getFlag?.(MODULE_ID, "tavernPublicView")
      ?? worldScene?.getFlag?.(MODULE_ID, "tavernData")
      ?? worldScene?.getFlag?.(MODULE_ID, "shopButton")?.tavernPublicView
      ?? worldScene?.getFlag?.(MODULE_ID, "shopButton")?.tavernData
      ?? null;
    return sceneTavernData ? TavernAtmosphereService.publicView(sceneTavernData) : null;
  }

  static #recoverTavernFromLink(link) {
    if (link?.tavernId) {
      const current = TavernState.getCurrent();
      if (current?.id === link.tavernId) return foundry.utils.deepClone(current);
      const saved = TavernState.getSavedById(link.tavernId);
      if (saved) return foundry.utils.deepClone(saved);
    }

    return null;
  }

  static #recoverTavernFromTrustedScene(link) {
    const sceneId = String(link?.sceneId ?? "").trim();
    if (!sceneId) return null;

    const scene = game.scenes?.get?.(sceneId) ?? null;
    if (!scene || !this.#sceneMatchesTavernLink(scene, link)) return null;

    const shopButton = scene.getFlag?.(MODULE_ID, "shopButton") ?? scene.flags?.[MODULE_ID]?.shopButton ?? null;
    const source = scene.getFlag?.(MODULE_ID, "tavernPublicView")
      ?? scene.flags?.[MODULE_ID]?.tavernPublicView
      ?? shopButton?.tavernPublicView
      ?? scene.getFlag?.(MODULE_ID, "tavernData")
      ?? scene.flags?.[MODULE_ID]?.tavernData
      ?? shopButton?.tavernData
      ?? null;
    if (!source) return null;

    // Always sanitize a legacy snapshot before promoting it back into the private
    // store. The source itself comes from the server-synchronized Scene document.
    const tavern = TavernAtmosphereService.ensure(TavernAtmosphereService.publicView(source));
    const trustedId = this.#sceneTavernId(scene);
    if (!tavern?.id || !trustedId || String(tavern.id) !== trustedId) return null;

    return { scene, tavern };
  }

  static #sceneMatchesTavernLink(scene, link) {
    if (!scene) return false;

    const requestedSceneId = String(link?.sceneId ?? "").trim();
    if (requestedSceneId && String(scene.id ?? "") !== requestedSceneId) return false;

    const requestedSceneUuid = String(link?.sceneUuid ?? "").trim();
    if (requestedSceneUuid && scene.uuid && String(scene.uuid) !== requestedSceneUuid) return false;

    const trustedId = this.#sceneTavernId(scene);
    const requestedTavernId = String(link?.tavernId ?? "").trim();
    if (!trustedId) return false;
    if (requestedTavernId && trustedId !== requestedTavernId) return false;

    const shopButton = scene.getFlag?.(MODULE_ID, "shopButton") ?? scene.flags?.[MODULE_ID]?.shopButton ?? null;
    const buttonId = String(shopButton?.tavernId ?? "").trim();
    if (buttonId && buttonId !== trustedId) return false;

    return true;
  }

  static #sceneTavernId(scene) {
    const shopButton = scene?.getFlag?.(MODULE_ID, "shopButton") ?? scene?.flags?.[MODULE_ID]?.shopButton ?? null;
    const publicView = scene?.getFlag?.(MODULE_ID, "tavernPublicView") ?? scene?.flags?.[MODULE_ID]?.tavernPublicView ?? null;
    const legacyData = scene?.getFlag?.(MODULE_ID, "tavernData") ?? scene?.flags?.[MODULE_ID]?.tavernData ?? null;

    return String(
      scene?.getFlag?.(MODULE_ID, "tavernId")
      ?? scene?.flags?.[MODULE_ID]?.tavernId
      ?? shopButton?.tavernId
      ?? publicView?.id
      ?? legacyData?.id
      ?? ""
    ).trim();
  }

  static async #resolveSceneForTavern(tavern, { allowImport = true } = {}) {
    if (!tavern?.scene) return null;
    const scene = tavern.scene.id ? game.scenes?.get(tavern.scene.id) : null;
    if (scene) return scene;
    if (!allowImport) return null;
    return this.#importSceneFromCompendium(tavern.scene.compendium, tavern.id);
  }

  static async #resolveSceneForLink(link, tavern, { allowImport = true } = {}) {
    const sceneId = link?.sceneId ?? tavern?.scene?.id;
    const worldScene = sceneId ? game.scenes?.get(sceneId) : null;
    if (worldScene) {
      const requestedUuid = String(link?.sceneUuid ?? "").trim();
      if (requestedUuid && worldScene.uuid && String(worldScene.uuid) !== requestedUuid) {
        throw new Error("Связь таверны указывает на другую сцену.");
      }

      const trustedId = this.#sceneTavernId(worldScene);
      const expectedId = String(tavern?.id ?? "").trim();
      const privateSceneId = String(tavern?.scene?.id ?? "").trim();
      const isPrivateAssociation = privateSceneId && privateSceneId === String(worldScene.id ?? "");
      if ((trustedId && trustedId === expectedId) || (!trustedId && isPrivateAssociation)) return worldScene;
      throw new Error("Связанная сцена относится к другой таверне.");
    }
    if (!allowImport) return null;

    const compendium = tavern?.scene?.compendium ?? null;
    const imported = await this.#importSceneFromCompendium(compendium, tavern.id);
    if (imported) return imported;

    return this.#resolveSceneForTavern(tavern, { allowImport });
  }

  static async #importSceneFromCompendium(compendium, tavernId) {
    if (!compendium?.pack || !compendium?.id) return null;
    const pack = game.packs.get(compendium.pack);
    if (!pack) throw new Error(`Компендиум сцен не найден: ${compendium.pack}`);

    const archived = await pack.getDocument(compendium.id);
    if (!archived) throw new Error("Архивная сцена не найдена в компендиуме.");
    const linkedId = this.#sceneTavernId(archived);
    if (linkedId && linkedId !== tavernId) throw new Error("Архивная сцена относится к другой таверне.");

    const archivedData = archived.toObject();
    const region = archivedData.flags?.[MODULE_ID]?.region
      ?? archivedData.flags?.[MODULE_ID]?.tavernPublicView?.region
      ?? archivedData.flags?.[MODULE_ID]?.tavernData?.region
      ?? null;
    const worldFolder = await this.#ensureWorldSceneFolder(region);

    let scene = null;
    if (typeof game.scenes?.importFromCompendium === "function") {
      scene = await game.scenes.importFromCompendium(pack, compendium.id, { folder: worldFolder ?? null }, { keepId: false, renderSheet: false });
      if (scene && worldFolder && scene.folder?.id !== worldFolder && scene.folder !== worldFolder) {
        try {
          await scene.update({ folder: worldFolder });
        } catch (error) {
          console.debug(`${MODULE_ID} | Could not move imported scene to tavern folder`, error);
        }
      }
    } else {
      const data = archivedData;
      delete data._id;
      data.folder = worldFolder ?? null;
      scene = await Scene.create(data, { renderSheet: false });
    }

    return scene;
  }

  static #findTavernkeeperTokens(scene, tavern) {
    const tokens = scene?.tokens?.contents ?? Array.from(scene?.tokens ?? []);
    const tavernId = tavern?.id;
    const actorId = tavern?.tavernkeeper?.actorId;

    return tokens.filter((token) => {
      const flags = token.flags?.[MODULE_ID] ?? {};
      const role = token.getFlag?.(MODULE_ID, "role") ?? flags.role;
      const tokenTavernId = token.getFlag?.(MODULE_ID, "tavernId") ?? flags.tavernId;
      const tokenActorId = token.actorId ?? token.actor?.id ?? token.document?.actorId;
      if (role === "tavernkeeper" && tokenTavernId === tavernId) return true;
      return Boolean(actorId && tokenActorId === actorId && role === "tavernkeeper");
    });
  }

  static #tokenDataForTavernkeeper(actor, scene, tavern, existingToken = null) {
    const base = actor.prototypeToken?.toObject?.() ?? {};
    delete base._id;
    delete base.actorData;

    const textureSrc = actor.prototypeToken?.texture?.src
      ?? tavern.tavernkeeper?.tokenImg
      ?? tavern.tavernkeeper?.token
      ?? tavern.tavernkeeper?.img
      ?? actor.img
      ?? "icons/svg/mystery-man.svg";

    const position = existingToken
      ? { x: existingToken.x ?? existingToken.document?.x ?? 0, y: existingToken.y ?? existingToken.document?.y ?? 0 }
      : this.#defaultTavernkeeperTokenPosition(scene, base);

    return foundry.utils.mergeObject(base, {
      name: actor.name,
      actorId: actor.id,
      actorLink: false,
      hidden: false,
      x: position.x,
      y: position.y,
      texture: {
        ...(base.texture ?? {}),
        src: textureSrc
      },
      flags: {
        ...(base.flags ?? {}),
        [MODULE_ID]: {
          ...(base.flags?.[MODULE_ID] ?? {}),
          role: "tavernkeeper",
          tavernId: tavern.id,
          tavernName: tavern.name,
          actorId: actor.id,
          placedAt: Date.now()
        }
      }
    }, { inplace: false });
  }

  static #defaultTavernkeeperTokenPosition(scene, base = {}) {
    const dimensions = scene?.dimensions ?? globalThis.canvas?.dimensions ?? {};
    const sceneX = Number(dimensions.sceneX ?? 0) || 0;
    const sceneY = Number(dimensions.sceneY ?? 0) || 0;
    const width = Number(dimensions.sceneWidth ?? scene?.width ?? 1456) || 1456;
    const height = Number(dimensions.sceneHeight ?? scene?.height ?? 816) || 816;
    const gridSize = Number(scene?.grid?.size ?? scene?.grid?.distance ?? globalThis.canvas?.grid?.size ?? 100) || 100;
    const tokenWidth = Math.max(1, Number(base.width ?? 1)) * gridSize;
    const tokenHeight = Math.max(1, Number(base.height ?? 1)) * gridSize;
    const x = Math.round(sceneX + (width * 0.5) - (tokenWidth / 2));
    const y = Math.round(sceneY + (height * 0.68) - (tokenHeight / 2));
    const maxX = Math.max(sceneX, sceneX + width - tokenWidth);
    const maxY = Math.max(sceneY, sceneY + height - tokenHeight);

    return {
      x: Math.max(sceneX, Math.min(maxX, x)),
      y: Math.max(sceneY, Math.min(maxY, y))
    };
  }

  static #sceneMeta(scene, tavern, link = {}) {
    const existingCompendium = tavern?.scene?.compendium ?? scene.getFlag?.(MODULE_ID, "compendium") ?? null;
    const imagePath = scene.background?.src ?? tavern?.scene?.img ?? link?.imagePath ?? null;

    return {
      id: scene.id,
      uuid: scene.uuid,
      name: scene.name,
      img: imagePath,
      createdAt: tavern?.scene?.createdAt ?? Date.now(),
      compendium: existingCompendium
    };
  }

  static async #ensureWorldSceneFolder(region) {
    const FolderClass = globalThis.Folder?.implementation ?? globalThis.Folder;
    if (!FolderClass || !game.folders) return null;

    const root = await this.#ensureWorldFolder(WORLD_SCENE_ROOT_FOLDER, "Scene", null);
    const regionName = this.#regionLabel(region);
    const regionFolder = await this.#ensureWorldFolder(regionName, "Scene", root?.id ?? null);
    return regionFolder?.id ?? root?.id ?? null;
  }

  static async #ensureWorldFolder(name, type, parent = null) {
    return FoundryDocumentUtils.ensureWorldFolder({ name, type, parent, fallbackName: WORLD_SCENE_ROOT_FOLDER });
  }

  static async #ensurePackFolder(pack, name, type) {
    return FoundryDocumentUtils.ensurePackFolder(pack, {
      name,
      type,
      fallbackName: "Нейтральная дорога",
      logLabel: "Scene pack"
    });
  }

  static #regionLabel(region) {
    return TAVERN_OPTIONS.regions?.[region] ?? "Нейтральная дорога";
  }

  static async #ensureScenePack() {
    const packId = this.compendiumPackId();
    let pack = game.packs.get(packId);
    if (pack) {
      this.#assertScenePack(pack);
      return pack;
    }

    if (!packId.startsWith("world.")) {
      throw new Error(`Компендиум ${packId} не найден. Создай его вручную или укажи world-compendium в настройках модуля.`);
    }

    const collectionName = this.#slugifyPackName(packId.split(".")[1] ?? "fbl-tavern-scenes");
    const CompendiumCollectionClass = globalThis.CompendiumCollection ?? foundry.documents?.collections?.CompendiumCollection;
    if (!CompendiumCollectionClass?.createCompendium) {
      throw new Error(`Компендиум ${packId} не найден, а API создания компендиума недоступен.`);
    }

    try {
      pack = await CompendiumCollectionClass.createCompendium({
        type: "Scene",
        label: DEFAULT_SCENE_PACK_LABEL,
        name: collectionName,
        package: "world"
      });
    } catch (_error) {
      pack = await CompendiumCollectionClass.createCompendium({
        documentName: "Scene",
        label: DEFAULT_SCENE_PACK_LABEL,
        name: collectionName,
        package: "world"
      });
    }

    this.#assertScenePack(pack);
    return pack;
  }

  static #assertScenePack(pack) {
    return FoundryDocumentUtils.assertPackType(pack, "Scene");
  }

  static async #unlockPack(pack) {
    return FoundryDocumentUtils.unlockPack(pack);
  }

  static async #findArchivedScene(pack, tavernId) {
    return FoundryDocumentUtils.findIndexEntryByFlag(pack, `flags.${MODULE_ID}.tavernId`, tavernId);
  }

  static #removeSceneMenuButton() {
    this.#sceneMenuButton?.remove?.();
    this.#sceneMenuButton = null;
  }

  static #linkFromScene(scene) {
    if (!scene) return null;
    if (scene.getFlag?.(MODULE_ID, "shopButtonEnabled") === false) return null;

    const existing = scene.getFlag?.(MODULE_ID, "shopButton") ?? scene.flags?.[MODULE_ID]?.shopButton;
    if (existing) {
      return this.#normalizeLink({
        ...existing,
        sceneId: scene.id,
        sceneUuid: scene.uuid,
        imagePath: existing.imagePath ?? scene.background?.src ?? null,
        compendium: existing.compendium ?? scene.getFlag?.(MODULE_ID, "compendium") ?? null
      });
    }

    const tavernData = scene.getFlag?.(MODULE_ID, "tavernPublicView")
      ?? scene.flags?.[MODULE_ID]?.tavernPublicView
      ?? scene.getFlag?.(MODULE_ID, "tavernData")
      ?? scene.flags?.[MODULE_ID]?.tavernData;
    if (!tavernData) return null;

    return this.#normalizeLink(this.#linkData({
      type: NOTE_TYPES.shop,
      tavern: tavernData,
      sceneId: scene.id,
      sceneUuid: scene.uuid,
      imagePath: scene.background?.src ?? null,
      compendium: scene.getFlag?.(MODULE_ID, "compendium") ?? null
    }));
  }

  static #containsPrivateAtmosphere(tavern) {
    return Boolean(tavern?.atmosphere);
  }

  static #linkData({ type, tavern, sceneId = null, sceneUuid = null, imagePath = null, compendium = null }) {
    return {
      type,
      tavernId: tavern.id,
      tavernName: tavern.name,
      tavernPublicView: TavernAtmosphereService.publicView(tavern),
      sceneId,
      sceneUuid,
      imagePath,
      compendium,
      createdAt: Date.now()
    };
  }

  static #normalizeLink(link) {
    if (!link || typeof link !== "object") return null;
    return foundry.utils.deepClone(link);
  }

  static async #waitForScene(sceneId, attempts = 10) {
    if (!sceneId) return null;

    for (let i = 0; i < attempts; i += 1) {
      const scene = game.scenes?.get(sceneId);
      if (scene) return scene;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return null;
  }

  static #missingImagesMessage(tried) {
    const escaped = tried.map((path) => this.#escapeHtml(path));
    return `Не нашел изображений таверны.<br><br>Проверенные папки:<br>${escaped.join("<br>")}`;
  }

  static #candidateFolders(region, quality) {
    const root = this.artRoot();
    const regionFolder = REGION_FOLDERS[region] ?? REGION_FOLDERS.common;
    const qualityFolders = this.#qualityFolderCandidates(quality);
    const allQualityFolders = this.#allQualityFolders(qualityFolders);
    const candidates = [];

    for (const folder of qualityFolders) candidates.push(`${root}/${regionFolder}/${folder}`);
    for (const folder of qualityFolders) candidates.push(`${root}/common/${folder}`);
    for (const folder of allQualityFolders) candidates.push(`${root}/${regionFolder}/${folder}`);
    for (const folder of allQualityFolders) candidates.push(`${root}/common/${folder}`);

    candidates.push(`${root}/${regionFolder}`, `${root}/common`, root);

    return [...new Set(candidates.map((path) => this.normalizePath(path)).filter(Boolean))];
  }

  static #qualityFolderCandidates(quality) {
    const normalized = String(quality ?? "modest");
    const canonical = QUALITY_FOLDERS[normalized] ? normalized : "modest";
    const aliases = QUALITY_FOLDER_ALIASES[canonical] ?? [QUALITY_FOLDERS[canonical]];
    return [...new Set(aliases.map((folder) => this.normalizePath(folder)).filter(Boolean))];
  }

  static #allQualityFolders(exclude = []) {
    const excluded = new Set(exclude);
    const folders = [];

    for (const key of QUALITY_FALLBACK_ORDER) {
      for (const folder of QUALITY_FOLDER_ALIASES[key] ?? [QUALITY_FOLDERS[key]]) {
        const normalized = this.normalizePath(folder);
        if (normalized && !excluded.has(normalized)) folders.push(normalized);
      }
    }

    return [...new Set(folders)];
  }

  static async #imageFiles(folderPath) {
    try {
      const FilePickerClass = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
      if (!FilePickerClass?.browse) return [];
      const result = await FilePickerClass.browse("data", folderPath);
      return (result.files ?? [])
        .map((file) => this.normalizePath(file))
        .filter((file) => IMAGE_EXTENSIONS.test(file));
    } catch (error) {
      console.debug(`${MODULE_ID} | Scene image folder unavailable: ${folderPath}`, error);
      return [];
    }
  }

  static #template(_templateId) {
    return STANDARD_TEMPLATE;
  }

  static async #imageDimensions(src) {
    if (!src) return null;

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  static #slugifyPackName(value) {
    return FoundryDocumentUtils.slugifyPackName(value, "fbl-tavern-scenes");
  }

  static #escapeHtml(value) {
    const text = String(value ?? "");
    if (typeof foundry.utils.escapeHTML === "function") return foundry.utils.escapeHTML(text);

    return text.replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[char]));
  }

  static #setting(key, fallback) {
    try {
      return game.settings.get(MODULE_ID, key) ?? fallback;
    } catch (_error) {
      return fallback;
    }
  }
}
