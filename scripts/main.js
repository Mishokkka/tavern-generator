import { MODULE_ID } from "./constants.js";
import { TavernGMApp } from "./apps/TavernGMApp.js";
import { TavernPlayerApp } from "./apps/TavernPlayerApp.js";
import { TavernState } from "./services/TavernState.js";
import { TavernSocket } from "./services/TavernSocket.js";
import { CurrencyAdapter } from "./services/CurrencyAdapter.js";
import { CleanlinessAdapter } from "./services/CleanlinessAdapter.js";
import { TavernDataValidator } from "./services/TavernDataValidator.js";
import { TavernSceneService } from "./services/TavernSceneService.js";
import { PurchaseSoundService } from "./services/PurchaseSoundService.js";
import { TavernSoundSettingsApp } from "./apps/TavernSoundSettingsApp.js";
import { CharacterForgeAdapter } from "./services/CharacterForgeAdapter.js";
import { TavernPricing } from "./services/TavernPricing.js";
import { TavernDailyService } from "./services/TavernDailyService.js";
import { TavernAtmosphereService } from "./services/TavernAtmosphereService.js";

let dataValidationReport = null;

Hooks.once("init", () => {
  TavernState.registerSettings();
  TavernPricing.registerSettings();
  TavernDailyService.registerSettings();
  TavernSceneService.registerSettings();
  PurchaseSoundService.registerSettings();
  CharacterForgeAdapter.registerSettings();
  game.settings.registerMenu(MODULE_ID, "purchaseSoundSettings", {
    name: "Звуки покупок таверны",
    label: "Настроить",
    hint: "Выбор звуков, проигрываемых покупателю после покупки еды, напитка, ночлега или услуги.",
    icon: "fa-solid fa-volume-high",
    type: TavernSoundSettingsApp,
    restricted: true
  });
  dataValidationReport = TavernDataValidator.validate();

  if (!Handlebars.helpers.eq) {
    Handlebars.registerHelper("eq", (a, b) => a === b);
  }
});

Hooks.once("ready", () => {
  if (game.user.isGM && dataValidationReport?.errors?.length) {
    ui.notifications.error(`FBL Tavern Generator: найдено ошибок данных: ${dataValidationReport.errors.length}. Подробности в консоли F12.`);
  } else if (game.user.isGM && dataValidationReport?.warnings?.length) {
    ui.notifications.warn(`FBL Tavern Generator: предупреждений данных: ${dataValidationReport.warnings.length}. Подробности в консоли F12.`);
  }

  TavernSocket.register();
  TavernSceneService.registerCanvasHooks();
  TavernSceneService.registerSocketHandlers();
  TavernDailyService.registerHooks();
  if (game.user.isGM) {
    void TavernSceneService.sanitizePublicSceneData().catch((error) => {
      console.warn(`${MODULE_ID} | Could not sanitize legacy public tavern scene data`, error);
    });
  }
  window.setTimeout(() => TavernSceneService.refreshSceneMenuButton(), 250);
  window.setTimeout(() => TavernSceneService.refreshSceneMenuButton(), 1500);
  Hooks.on(`${MODULE_ID}.refresh`, () => TavernGMApp.renderOpenInstances({ syncCurrent: true }));

  game.fblTaverns = {
    openGM: (options = {}) => {
      if (!game.user.isGM) return ui.notifications.warn("Только ГМ может открыть генератор таверны.");

      const requestedId = String(options.tavernId ?? options.tavern?.id ?? "").trim();
      let tavern = options.tavern ?? null;
      if (requestedId) {
        tavern = TavernState.resolveExactTavern({
          tavernId: requestedId,
          sceneId: options.sceneId ?? options.tavern?.scene?.id ?? null,
          fallback: options.tavern ?? null,
          requirePrivate: options.tab === "life"
        });
        if (!tavern || tavern.id !== requestedId) {
          return ui.notifications.warn("Не удалось открыть именно выбранную таверну. Обнови её меню и повтори попытку.");
        }
      }

      const appOptions = { ...options, tavern };
      delete appOptions.tavernId;
      delete appOptions.sceneId;
      return new TavernGMApp(appOptions).render(true);
    },
    openPlayer: () => TavernPlayerApp.openSingleton(),
    clear: () => TavernState.clearCurrent(),
    getCurrent: () => TavernState.getCurrent(),
    getSaved: () => TavernState.getSaved(),
    saveCurrent: () => TavernState.saveTavern(TavernState.getCurrent()),
    addFlagMoney: async (actor, coins) => CurrencyAdapter.addFlagWallet(actor, coins),
    setCleanlinessHandler: (handler) => CleanlinessAdapter.setHandler(handler),
    validateData: () => TavernDataValidator.validate(),
    createScene: (tavern, config) => TavernSceneService.createSceneForTavern(tavern ?? TavernState.getCurrent(), config),
    archiveScene: (scene, tavern) => TavernSceneService.archiveScene(scene ?? canvas?.scene, tavern ?? TavernState.getCurrent()),
    randomSceneImage: (params) => TavernSceneService.randomImagePath(params),
    sceneRegionFolders: () => TavernSceneService.regionFolders(),
    sceneQualityFolders: () => TavernSceneService.qualityFolders(),
    sceneCompendiumPack: () => TavernSceneService.compendiumPackId(),
    characterForgeAvailable: () => CharacterForgeAdapter.isAvailable(),
    createTavernkeeper: (tavern) => CharacterForgeAdapter.createTavernkeeper(tavern ?? TavernState.getCurrent()),
    placeTavernkeeperToken: (tavern) => TavernSceneService.placeTavernkeeperOnLinkedScene(tavern ?? TavernState.getCurrent()),
    regenerateAtmosphere: (tavern) => TavernAtmosphereService.regenerate(tavern ?? TavernState.getCurrent()),
    publicTavernView: (tavern) => TavernAtmosphereService.publicView(tavern ?? TavernState.getCurrent()),
    advanceTavernDay: () => TavernDailyService.advanceDay({ reason: "api" })
  };

  console.log(`${MODULE_ID} | Ready. Use game.fblTaverns.openGM() or game.fblTaverns.openPlayer().`);
});
