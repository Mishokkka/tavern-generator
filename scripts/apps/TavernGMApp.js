import { TEMPLATES } from "../constants.js";
import { TAVERN_OPTIONS } from "../data/index.js";
import { TavernGenerator } from "../services/TavernGenerator.js";
import { TavernSceneService } from "../services/TavernSceneService.js";
import { TavernState } from "../services/TavernState.js";
import { TavernSocket } from "../services/TavernSocket.js";
import { CharacterForgeAdapter } from "../services/CharacterForgeAdapter.js";
import { TavernEntryEditorDialog } from "./TavernEntryEditorDialog.js";
import { TavernAtmosphereService } from "../services/TavernAtmosphereService.js";
import { TavernAvailabilityService } from "../services/TavernAvailabilityService.js";
import { TavernDailyService } from "../services/TavernDailyService.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const gmInstances = new Set();

export class TavernGMApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "fbl-tavern-gm",
    classes: ["fbl-tavern", "fbl-tavern-gm"],
    tag: "form",
    window: {
      title: "Генератор таверны",
      icon: "fa-solid fa-beer-mug-empty",
      resizable: true
    },
    position: {
      width: 1020,
      height: 860
    }
  };

  static PARTS = {
    main: { template: TEMPLATES.gm }
  };

  constructor(options = {}) {
    const initialTavern = options.tavern ? foundry.utils.deepClone(options.tavern) : null;
    const requestedTab = String(options.tab ?? options.activeTab ?? "tavern");
    const appOptions = { ...options };
    delete appOptions.tavern;
    delete appOptions.tab;
    delete appOptions.activeTab;

    super(appOptions);
    this.draft = initialTavern ?? TavernState.getCurrent();
    this.activeTavernId = this.draft?.id ?? null;
    this.params = this.#paramsFromTavern(this.draft);
    this.sceneConfig = TavernSceneService.defaultConfig();
    this.keeperConfig = CharacterForgeAdapter.defaultConfig();
    this.undoDraft = null;
    this.activeTab = requestedTab === "life" && this.draft ? "life" : "tavern";
    this.newDayPending = false;
    gmInstances.add(this);
  }

  static renderOpenInstances({ syncCurrent = false } = {}) {
    for (const app of gmInstances) {
      if (!app.rendered) continue;
      if (syncCurrent) app.#syncFromCurrent();
      app.render();
    }
  }

  async _onClose(options) {
    gmInstances.delete(this);
    return super._onClose?.(options);
  }

  async _prepareContext(options) {
    const decorated = TavernGenerator.decoratePrices(this.draft);
    const saved = TavernState.getSaved().map((tavern) => ({
      id: tavern.id,
      name: tavern.name,
      meta: `${tavern.labels?.region ?? ""} · ${tavern.labels?.terrain ?? ""}`
    }));

    const linkedScene = decorated?.scene?.id ? game.scenes?.get(decorated.scene.id) : null;
    const hasLinkedSceneMeta = Boolean(decorated?.scene?.id || decorated?.scene?.compendium?.id);
    const tavernkeeper = CharacterForgeAdapter.getActorMeta(decorated);
    if (!decorated && this.activeTab === "life") this.activeTab = "tavern";

    return {
      options: TAVERN_OPTIONS,
      sceneOptions: {
        modes: TavernSceneService.sceneModeChoices(),
        templates: TavernSceneService.templateChoices()
      },
      sceneConfig: this.sceneConfig,
      sceneArtRoot: TavernSceneService.artRoot(),
      sceneCreateDisabled: !decorated || this.sceneConfig.mode === "none" || (this.sceneConfig.mode === "manual" && !this.sceneConfig.manualImagePath),
      linkedScene: linkedScene
        ? { id: linkedScene.id, name: linkedScene.name, archived: false }
        : decorated?.scene
          ? {
              id: decorated.scene.id,
              name: decorated.scene.name ?? "Связанная сцена не найдена",
              archived: Boolean(decorated.scene.compendium?.id)
            }
          : null,
      hasLinkedSceneMeta,
      characterForge: {
        available: CharacterForgeAdapter.isAvailable(),
        availabilityLabel: CharacterForgeAdapter.availabilityLabel(),
        nameSetLabel: decorated ? CharacterForgeAdapter.nameSetLabelForRegion(decorated.region) : "",
        compendiumPack: CharacterForgeAdapter.compendiumPackId()
      },
      keeperConfig: this.keeperConfig,
      tavernkeeper,
      params: this.params,
      priceMultiplierPercent: Math.round((Number(this.params.priceMultiplier) || 1) * 100),
      tavern: decorated,
      availability: decorated ? TavernAvailabilityService.profile(decorated) : null,
      saved,
      hasSaved: saved.length > 0,
      hasCurrent: Boolean(TavernState.getCurrent()),
      canUndo: Boolean(this.undoDraft),
      isGM: game.user.isGM,
      tabs: {
        tavern: { active: this.activeTab === "tavern" },
        life: { active: this.activeTab === "life" }
      }
    };
  }

  async _onRender(context, options) {
    this.#installNewDayHeaderButton();

    for (const button of this.element.querySelectorAll("[data-action='selectTab']")) {
      button.addEventListener("click", (event) => this.#onSelectTab(event));
    }

    this.element.querySelector("[data-action='generate']")?.addEventListener("click", (event) => this.#onGenerate(event));
    this.element.querySelector("[data-action='confirm']")?.addEventListener("click", (event) => this.#onConfirm(event));
    this.element.querySelector("[data-action='openPlayers']")?.addEventListener("click", (event) => this.#onOpenPlayers(event));
    this.element.querySelector("[data-action='clear']")?.addEventListener("click", (event) => this.#onClear(event));
    this.element.querySelector("[data-action='rerollName']")?.addEventListener("click", (event) => this.#onRerollName(event));
    this.element.querySelector("[data-action='applyPriceModifier']")?.addEventListener("click", (event) => this.#onApplyPriceModifier(event));
    this.element.querySelector("[data-action='saveDraft']")?.addEventListener("click", (event) => this.#onSaveDraft(event));
    this.element.querySelector("[data-action='loadSaved']")?.addEventListener("click", (event) => this.#onLoadSaved(event));
    this.element.querySelector("[data-action='deleteSaved']")?.addEventListener("click", (event) => this.#onDeleteSaved(event));
    this.element.querySelector("[data-action='browseSceneImage']")?.addEventListener("click", (event) => this.#onBrowseSceneImage(event));
    this.element.querySelector("[data-action='createScene']")?.addEventListener("click", (event) => this.#onCreateScene(event));
    this.element.querySelector("[data-action='openLinkedScene']")?.addEventListener("click", (event) => this.#onOpenLinkedScene(event));
    this.element.querySelector("[data-action='createTavernkeeper']")?.addEventListener("click", (event) => this.#onCreateTavernkeeper(event));
    this.element.querySelector("[data-action='openTavernkeeper']")?.addEventListener("click", (event) => this.#onOpenTavernkeeper(event));
    this.element.querySelector("[data-action='undo']")?.addEventListener("click", (event) => this.#onUndo(event));
    this.element.querySelector("[data-action='restockAll']")?.addEventListener("click", (event) => this.#onRestockAll(event));
    this.element.querySelector("[data-action='regenerateAtmosphere']")?.addEventListener("click", (event) => this.#onRegenerateAtmosphere(event));
    this.element.querySelector("[data-action='applyCrowdAvailability']")?.addEventListener("click", (event) => this.#onApplyCrowdAvailability(event));
    this.element.querySelector("[data-action='rerollMood']")?.addEventListener("click", (event) => this.#onRerollLifeEntry(event));
    this.element.querySelector("[data-action='rerollIncident']")?.addEventListener("click", (event) => this.#onRerollLifeEntry(event));

    for (const button of this.element.querySelectorAll("[data-action='rerollLifeEntry']")) {
      button.addEventListener("click", (event) => this.#onRerollLifeEntry(event));
    }

    for (const button of this.element.querySelectorAll("[data-action='toggleLifePinned']")) {
      button.addEventListener("click", (event) => this.#onToggleLifePinned(event));
    }

    for (const button of this.element.querySelectorAll("[data-action='sendLifeEntry']")) {
      button.addEventListener("click", (event) => this.#onSendLifeEntry(event));
    }

    for (const button of this.element.querySelectorAll("[data-action='editEntry']")) {
      button.addEventListener("click", (event) => this.#onEditEntry(event));
    }

    for (const button of this.element.querySelectorAll("[data-action='addCustom']")) {
      button.addEventListener("click", (event) => this.#onAddCustom(event));
    }

    for (const button of this.element.querySelectorAll("[data-action='togglePinned']")) {
      button.addEventListener("click", (event) => this.#onTogglePinned(event));
    }

    for (const button of this.element.querySelectorAll("[data-action='removeEntry']")) {
      button.addEventListener("click", (event) => this.#onRemoveEntry(event));
    }

    for (const button of this.element.querySelectorAll("[data-action='addRandom']")) {
      button.addEventListener("click", (event) => this.#onAddRandom(event));
    }

    for (const input of this.element.querySelectorAll("select[data-param], input[data-param]")) {
      input.addEventListener("change", () => {
        if (input.dataset.param === "priceMultiplierPercent") this.params.priceMultiplier = this.#percentToMultiplier(input.value);
        else this.params[input.dataset.param] = input.value;
      });
    }

    for (const input of this.element.querySelectorAll("select[data-scene-param], input[data-scene-param]")) {
      input.addEventListener("change", () => {
        this.#readSceneConfig();
        if (input.dataset.sceneParam === "mode") this.render();
      });
    }

    for (const input of this.element.querySelectorAll("select[data-keeper-param], input[data-keeper-param]")) {
      input.addEventListener("change", () => this.#readKeeperConfig());
    }

    for (const input of this.element.querySelectorAll("input[data-lodging-field]")) {
      input.addEventListener("change", (event) => this.#onLodgingChange(event));
    }
  }

  #installNewDayHeaderButton() {
    const header = this.window?.header;
    if (!header || !game.user?.isGM) return;

    let button = header.querySelector(".tg-header-new-day");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "header-control tg-header-new-day";
      button.dataset.tooltip = "Начать новый день в открытой таверне";
      button.dataset.tooltipDirection = "DOWN";
      button.setAttribute("aria-label", "Новый день в таверне");
      button.innerHTML = '<i class="fa-solid fa-sun"></i><span>Новый день</span>';
      button.addEventListener("click", (event) => void this.#onNewDay(event));

      const closeButton = this.window?.close ?? header.querySelector('[data-action="close"], .close');
      if (closeButton?.parentElement === header) header.insertBefore(button, closeButton);
      else header.append(button);
    }

    button.disabled = !this.draft || this.newDayPending;
    button.classList.toggle("is-busy", this.newDayPending);
    const icon = button.querySelector("i");
    if (icon) icon.className = this.newDayPending ? "fa-solid fa-spinner fa-spin" : "fa-solid fa-sun";
  }

  async #onNewDay(event) {
    event?.preventDefault?.();
    if (!game.user?.isGM) return ui.notifications.warn("Только ГМ может начинать новый день в таверне.");
    if (!this.draft?.id) return ui.notifications.warn("Сначала сгенерируй или открой таверну.");
    if (this.newDayPending) return;

    const name = this.#escapeHtml(this.draft.name ?? "Таверна");
    const confirmed = await this.#confirm(
      `Начать новый день в таверне <strong>${name}</strong>? Обновятся брони, запасы, часть меню и Жизнь таверны.`,
      "Новый день в таверне"
    );
    if (!confirmed) return;

    this.newDayPending = true;
    this.#installNewDayHeaderButton();

    try {
      this.#checkpoint();
      const result = await TavernDailyService.advanceTavern(this.draft, {
        dayKey: `manual:${Date.now()}`,
        reason: "gm-header",
        broadcast: true
      });
      this.draft = result.tavern;
      if (result.wasCurrent) this.activeTavernId = this.draft.id;
      this.params = this.#paramsFromTavern(this.draft);

      const expired = result.expired?.length ?? 0;
      const suffix = expired ? ` Освобождено бронирований: ${expired}.` : "";
      ui.notifications.info(`В таверне «${this.draft.name}» начался новый день.${suffix}`);
      this.render();
    } catch (error) {
      console.error(error);
      ui.notifications.error(error.message ?? "Не удалось начать новый день в таверне.");
    } finally {
      this.newDayPending = false;
      this.#installNewDayHeaderButton();
    }
  }

  #onSelectTab(event) {
    event.preventDefault();
    const tab = String(event.currentTarget.dataset.tab ?? "tavern");
    if (!new Set(["tavern", "life"]).has(tab)) return;
    if (tab === "life" && (!game.user.isGM || !this.draft)) return;
    this.activeTab = tab;
    this.render();
  }

  #onGenerate(event) {
    event.preventDefault();
    this.#checkpoint();
    this.#readParams();
    this.#readSceneConfig();
    this.draft = TavernGenerator.generate(this.params);
    this.activeTavernId = null;
    this.render();
  }

  async #onConfirm(event) {
    event.preventDefault();
    if (!game.user.isGM) return ui.notifications.warn("Только ГМ может подтверждать таверну.");
    if (!this.draft) this.draft = TavernGenerator.generate(this.params);
    this.draft = await TavernState.setCurrent(this.draft);
    this.activeTavernId = this.draft.id;
    TavernSocket.refreshAll(this.draft);
    ui.notifications.info(`Таверна активна: ${this.draft.name}`);
  }

  async #onOpenPlayers(event) {
    event.preventDefault();
    if (!game.user.isGM) return;
    if (!this.draft) this.draft = TavernGenerator.generate(this.params);
    this.draft = await TavernState.setCurrent(this.draft);
    this.activeTavernId = this.draft.id;
    TavernSocket.refreshAll(this.draft);
    TavernSocket.openForPlayers();
    ui.notifications.info("Окно таверны отправлено игрокам.");
  }

  async #onClear(event) {
    event.preventDefault();
    if (!game.user.isGM) return ui.notifications.warn("Только ГМ может очищать активную таверну.");
    const confirmed = await this.#confirm("Очистить активную таверну? Окна игроков потеряют связь с текущим заведением.", "Очистить таверну");
    if (!confirmed) return;
    this.#checkpoint();
    await TavernState.clearCurrent();
    this.draft = null;
    this.activeTavernId = null;
    TavernSocket.refreshAll();
    this.render();
  }

  #onRerollName(event) {
    event.preventDefault();
    if (!this.draft) return;
    this.#checkpoint();
    const params = this.#paramsFromTavern(this.draft);
    const fresh = TavernGenerator.generate(params);
    this.draft.name = fresh.name;
    this.render();
  }

  #onApplyPriceModifier(event) {
    event.preventDefault();
    if (!this.draft) return ui.notifications.warn("Сначала сгенерируй таверну.");
    this.#checkpoint();
    this.#readParams();
    this.draft = TavernGenerator.applyPriceMultiplier(this.draft, this.params.priceMultiplier);
    this.render();
  }

  async #onSaveDraft(event) {
    event.preventDefault();
    if (!game.user.isGM) return;
    if (!this.draft) this.draft = TavernGenerator.generate(this.params);
    const saved = await TavernState.saveTavern(this.draft);
    this.draft = saved;
    ui.notifications.info(`Таверна сохранена: ${saved.name}`);
    this.render();
  }

  #onLoadSaved(event) {
    event.preventDefault();
    const id = this.element.querySelector("select[name='savedTavernId']")?.value;
    if (!id) return ui.notifications.warn("Выбери сохраненную таверну.");
    const saved = TavernState.getSavedById(id);
    if (!saved) return ui.notifications.warn("Сохраненная таверна не найдена.");
    this.draft = foundry.utils.deepClone(saved);
    const current = TavernState.getCurrent();
    this.activeTavernId = current?.id === this.draft.id ? this.draft.id : null;
    this.params = this.#paramsFromTavern(this.draft);
    this.render();
  }

  async #onDeleteSaved(event) {
    event.preventDefault();
    const id = this.element.querySelector("select[name='savedTavernId']")?.value;
    if (!id) return ui.notifications.warn("Выбери сохраненную таверну.");
    const saved = TavernState.getSavedById(id);
    if (!saved) return ui.notifications.warn("Сохраненная таверна не найдена.");
    const name = this.#escapeHtml(saved.name);
    const confirmed = await this.#confirm(`Удалить сохраненную таверну <strong>${name}</strong>? Действие необратимо.`, "Удалить таверну");
    if (!confirmed) return;
    await TavernState.deleteSaved(id);
    ui.notifications.info("Сохраненная таверна удалена.");
    this.render();
  }

  async #onBrowseSceneImage(event) {
    event.preventDefault();
    this.#readSceneConfig();
    await TavernSceneService.browseForImage({
      current: this.sceneConfig.manualImagePath || TavernSceneService.artRoot(),
      callback: (path) => {
        this.sceneConfig.manualImagePath = path;
        this.sceneConfig.mode = "manual";
        this.render();
      }
    });
  }

  async #onCreateScene(event) {
    event.preventDefault();
    if (!game.user.isGM) return ui.notifications.warn("Только ГМ может создавать сцены.");
    if (!this.draft) return ui.notifications.warn("Сначала сгенерируй таверну.");

    this.#readSceneConfig();
    const button = event.currentTarget;
    button.disabled = true;

    try {
      const { scene, meta } = await TavernSceneService.createSceneForTavern(this.draft, this.sceneConfig);
      this.draft.scene = meta;
      this.draft = await TavernState.saveTavern(this.draft);

      if (this.activeTavernId === this.draft.id || TavernState.getCurrent()?.id === this.draft.id) {
        this.draft = await TavernState.setCurrent(this.draft);
        this.activeTavernId = this.draft.id;
        TavernSocket.refreshAll(this.draft);
      }

      ui.notifications.info(`Сцена создана и таверна сохранена: ${scene.name}`);
      this.render();
    } catch (error) {
      console.error(error);
      ui.notifications.error(error.message ?? "Не удалось создать сцену таверны.");
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }

  async #onOpenLinkedScene(event) {
    event.preventDefault();
    if (!this.draft?.scene) return ui.notifications.warn("У таверны нет связанной сцены.");

    try {
      const { scene } = await TavernSceneService.openLinkedScene(this.draft);
      if (scene?.id && this.draft.scene.id !== scene.id) {
        this.draft.scene = {
          ...this.draft.scene,
          id: scene.id,
          uuid: scene.uuid,
          name: scene.name,
          img: scene.background?.src ?? this.draft.scene.img
        };
        this.draft = await TavernState.saveTavern(this.draft);
      }
      this.render();
    } catch (error) {
      ui.notifications.warn(error.message ?? "Связанная сцена не найдена.");
    }
  }

  async #onCreateTavernkeeper(event) {
    event.preventDefault();
    if (!game.user.isGM) return ui.notifications.warn("Только ГМ может создавать тавернщиков.");
    if (!this.draft) return ui.notifications.warn("Сначала сгенерируй таверну.");
    const button = event.currentTarget;
    button.disabled = true;

    try {
      this.#readKeeperConfig();
      const meta = await CharacterForgeAdapter.createTavernkeeper(this.draft, {
        replace: true,
        archiveToCompendium: this.keeperConfig.archiveToCompendium
      });
      this.draft = await CharacterForgeAdapter.persistTavernkeeper(this.draft, meta);

      if (this.keeperConfig.placeTokenOnScene !== false) {
        try {
          const placed = await TavernSceneService.placeTavernkeeperOnLinkedScene(this.draft, {
            replaceExisting: true,
            archiveScene: true,
            importActor: false
          });
          if (placed?.token?.id && this.draft?.scene) {
            this.draft.scene.tavernkeeperTokenId = placed.token.id;
            this.draft = await TavernState.saveTavern(this.draft);
          }
        } catch (tokenError) {
          console.warn("fbl-tavern-generator | Could not place tavernkeeper token", tokenError);
          ui.notifications.warn("Тавернщик создан, но токен не удалось поставить на сцену.");
        }
      }

      if (this.activeTavernId === this.draft.id || TavernState.getCurrent()?.id === this.draft.id) {
        this.draft = await TavernState.setCurrent(this.draft);
        this.activeTavernId = this.draft.id;
        TavernSocket.refreshAll(this.draft);
      }

      ui.notifications.info(`Тавернщик создан: ${meta.name}`);
      this.render();
    } catch (error) {
      console.error(error);
      ui.notifications.error(error.message ?? "Не удалось создать тавернщика.");
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }

  async #onOpenTavernkeeper(event) {
    event.preventDefault();
    try {
      await CharacterForgeAdapter.openTavernkeeper(this.draft);
    } catch (error) {
      ui.notifications.warn(error.message ?? "Тавернщик не найден.");
    }
  }

  #onRemoveEntry(event) {
    event.preventDefault();
    if (!this.draft) return;
    this.#checkpoint();
    const button = event.currentTarget;
    this.draft = TavernGenerator.removeEntry(this.draft, button.dataset.category, button.dataset.entryId);
    this.render();
  }

  #onAddRandom(event) {
    event.preventDefault();
    if (!this.draft) return ui.notifications.warn("Сначала сгенерируй таверну.");
    const category = event.currentTarget.dataset.category;
    const before = this.#categoryLength(category);
    this.#checkpoint();
    this.draft = TavernGenerator.addRandomEntry(this.draft, category);
    if (this.#categoryLength(category) === before) {
      this.undoDraft = null;
      return ui.notifications.info("Больше уникальных позиций такого типа для параметров таверны нет.");
    }
    this.render();
  }

  async #onEditEntry(event) {
    event.preventDefault();
    if (!this.draft) return;
    const { category, entryId } = event.currentTarget.dataset;
    const entry = TavernState.findEntry(this.draft, category, entryId);
    if (!entry) return ui.notifications.warn("Позиция не найдена.");
    const patch = await TavernEntryEditorDialog.prompt({ category, entry });
    if (!patch) return;
    this.#checkpoint();
    this.draft = TavernGenerator.upsertEntry(this.draft, category, entryId, patch);
    this.render();
  }

  async #onAddCustom(event) {
    event.preventDefault();
    if (!this.draft) return ui.notifications.warn("Сначала сгенерируй таверну.");
    const category = event.currentTarget.dataset.category;
    const patch = await TavernEntryEditorDialog.prompt({ category });
    if (!patch) return;
    this.#checkpoint();
    this.draft = TavernGenerator.upsertEntry(this.draft, category, null, patch);
    this.render();
  }

  #onTogglePinned(event) {
    event.preventDefault();
    if (!this.draft) return;
    const { category, entryId } = event.currentTarget.dataset;
    this.#checkpoint();
    this.draft = TavernGenerator.togglePinned(this.draft, category, entryId);
    this.render();
  }

  #onRestockAll(event) {
    event.preventDefault();
    if (!this.draft) return;
    this.#checkpoint();
    this.draft = TavernGenerator.restockAll(this.draft);
    ui.notifications.info("Запасы еды, напитков и услуг пополнены до штатного максимума.");
    this.render();
  }

  #onUndo(event) {
    event.preventDefault();
    if (!this.undoDraft) return;
    const current = this.draft ? foundry.utils.deepClone(this.draft) : null;
    this.draft = foundry.utils.deepClone(this.undoDraft);
    this.undoDraft = current;
    this.render();
  }

  async #onApplyCrowdAvailability(event) {
    event.preventDefault();
    if (!game.user.isGM) return ui.notifications.warn("Только ГМ может применять заполненность таверны.");
    if (!this.draft?.id) return ui.notifications.warn("Сначала сгенерируй таверну.");

    const button = event.currentTarget;
    button.disabled = true;

    try {
      this.#checkpoint();
      this.draft = TavernAvailabilityService.clearEmbeddedAvailability(TavernAtmosphereService.ensure(this.draft));
      this.draft.atmosphere.availabilityAppliedAt = Date.now();

      const wasCurrent = TavernState.getCurrent()?.id === this.draft.id;
      this.draft = await TavernState.saveTavern(this.draft);
      if (wasCurrent) {
        this.draft = await TavernState.setCurrent(this.draft);
        this.activeTavernId = this.draft.id;
      }

      await TavernSceneService.syncLinkedTavernData(this.draft);
      TavernSocket.refreshAll(this.draft);
      ui.notifications.info(`Заполненность применена: ${this.draft.name}. Доступность игроков обновлена.`);
      this.render();
    } catch (error) {
      console.error(error);
      ui.notifications.error(error.message ?? "Не удалось применить заполненность таверны.");
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }

  #onRegenerateAtmosphere(event) {
    event.preventDefault();
    if (!this.draft) return;
    this.#checkpoint();
    this.draft = TavernAtmosphereService.regenerate(this.draft);
    this.render();
  }

  #onRerollLifeEntry(event) {
    event.preventDefault();
    if (!this.draft) return;
    const section = event.currentTarget.dataset.section ?? (event.currentTarget.dataset.action === "rerollMood" ? "mood" : "incident");
    const entryId = event.currentTarget.dataset.entryId ?? null;
    this.#checkpoint();
    this.draft = TavernAtmosphereService.rerollEntry(this.draft, section, entryId);
    this.render();
  }

  #onToggleLifePinned(event) {
    event.preventDefault();
    if (!this.draft) return;
    const { section, entryId } = event.currentTarget.dataset;
    this.#checkpoint();
    this.draft = TavernAtmosphereService.togglePinned(this.draft, section, entryId);
    this.render();
  }

  async #onSendLifeEntry(event) {
    event.preventDefault();
    if (!this.draft) return;
    const { section, entryId } = event.currentTarget.dataset;
    const entry = TavernAtmosphereService.findEntry(this.draft, section, entryId);
    if (!entry) return ui.notifications.warn("Запись таверны не найдена.");
    await this.#sendLifeEntryToChat(entry, section);
  }

  async #sendLifeEntryToChat(entry, section) {
    const labels = { mood: "Обстановка", rumors: "Слух", regulars: "Посетитель", incident: "Происшествие" };
    const title = this.#escapeHtml(entry.title ?? entry.label ?? labels[section] ?? "Таверна");
    const text = this.#escapeHtml(entry.text ?? entry.description ?? "");
    const tavernName = this.#escapeHtml(this.draft?.name ?? "Таверна");
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker?.() ?? {},
      content: `<section class="tg-chat-life"><header>${tavernName} · ${labels[section] ?? "Таверна"}</header><h3>${title}</h3><p>${text}</p></section>`
    });
  }

  async #persistLiveDraft() {
    if (!game.user.isGM || !this.draft?.id) return;
    const current = TavernState.getCurrent();
    const saved = TavernState.getSavedById(this.draft.id);
    if (saved) this.draft = await TavernState.saveTavern(this.draft);
    if (current?.id === this.draft.id) {
      this.draft = await TavernState.setCurrent(this.draft);
      this.activeTavernId = this.draft.id;
      TavernSocket.refreshAll(this.draft);
    }
  }

  #onLodgingChange(event) {
    if (!this.draft) return;
    this.#checkpoint();
    const input = event.currentTarget;
    const patch = {};
    if (input.dataset.lodgingField === "unlimited") patch.unlimited = input.checked;
    else patch[input.dataset.lodgingField] = input.value;
    this.draft = TavernGenerator.updateLodgingEntry(this.draft, input.dataset.entryId, patch);
    this.render();
  }

  #readParams() {
    const form = this.element;
    for (const key of ["region", "quality", "size", "terrain"]) {
      this.params[key] = form.querySelector(`[name='${key}']`)?.value ?? this.params[key];
    }
    const percent = form.querySelector("[name='priceMultiplierPercent']")?.value;
    this.params.priceMultiplier = this.#percentToMultiplier(percent ?? Math.round((Number(this.params.priceMultiplier) || 1) * 100));
  }

  #readSceneConfig() {
    const form = this.element;
    if (!form) return;

    for (const input of form.querySelectorAll("select[data-scene-param], input[data-scene-param]")) {
      const key = input.dataset.sceneParam;
      if (!key) continue;
      this.sceneConfig[key] = input.type === "checkbox" ? input.checked : input.value;
    }

    this.sceneConfig.manualImagePath = TavernSceneService.normalizePath(this.sceneConfig.manualImagePath);
  }

  #readKeeperConfig() {
    const form = this.element;
    if (!form) return;

    for (const input of form.querySelectorAll("select[data-keeper-param], input[data-keeper-param]")) {
      const key = input.dataset.keeperParam;
      if (!key) continue;
      this.keeperConfig[key] = input.type === "checkbox" ? input.checked : input.value;
    }
  }

  #syncFromCurrent() {
    const current = TavernState.getCurrent();

    if (!current) {
      if (this.activeTavernId) {
        this.draft = null;
        this.activeTavernId = null;
        this.params = this.#paramsFromTavern(null);
      }
      return;
    }

    if (this.activeTavernId !== current.id && this.draft?.id !== current.id) return;

    this.draft = foundry.utils.deepClone(current);
    this.activeTavernId = current.id;
    this.params = this.#paramsFromTavern(this.draft);
  }

  #checkpoint() {
    this.undoDraft = this.draft ? foundry.utils.deepClone(this.draft) : null;
  }

  #categoryLength(category) {
    const key = category === "drinks" ? "drinks" : category === "lodging" || category === "rooms" ? "lodging" : category === "services" ? "services" : "food";
    return this.draft?.inventory?.[key]?.length ?? 0;
  }

  async #confirm(content, title) {
    return foundry.applications.api.DialogV2.confirm({
      window: { title },
      content: `<p>${content}</p>`,
      rejectClose: false,
      modal: true
    });
  }

  #escapeHtml(value) {
    const text = String(value ?? "");
    return typeof foundry.utils.escapeHTML === "function" ? foundry.utils.escapeHTML(text) : text.replace(/[&<>"']/g, "");
  }

  #paramsFromTavern(tavern) {
    return {
      region: tavern?.region ?? "common",
      quality: tavern?.quality ?? "modest",
      size: tavern?.size ?? "medium",
      terrain: tavern?.terrain ?? "road",
      priceMultiplier: tavern?.priceMultiplier ?? 1
    };
  }

  #percentToMultiplier(value) {
    const percent = Number(value);
    if (!Number.isFinite(percent)) return 1;
    return Math.min(5, Math.max(0.1, percent / 100));
  }
}
