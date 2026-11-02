import { TEMPLATES } from "../constants.js";
import { TAVERN_OPTIONS } from "../data/index.js";
import { TavernInventory } from "../services/TavernInventory.js";
import { TavernOfferingModel } from "../services/TavernOfferingModel.js";
import { TavernStockService } from "../services/TavernStockService.js";
import { TavernGenerator } from "../services/TavernGenerator.js";
import { TavernGenerationPlan } from "../services/TavernGenerationPlan.js";
import { TavernNames } from "../services/TavernNames.js";
import { TavernLocation } from "../services/TavernLocation.js";
import { TavernSceneService } from "../services/TavernSceneService.js";
import { TavernState } from "../services/TavernState.js";
import { TavernSocket } from "../services/TavernSocket.js";
import { CharacterForgeAdapter } from "../services/CharacterForgeAdapter.js";
import { TavernPlayerApp } from "./TavernPlayerApp.js";
import { TavernLibraryApp } from "./TavernLibraryApp.js";
import { TavernEntryEditorDialog } from "./TavernEntryEditorDialog.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const gmInstances = new Set();
const WORKFLOW_STEPS = ["setup", "assortment", "extras", "launch"];
const WORKFLOW_LABELS = { setup: "Параметры", assortment: "Ассортимент", extras: "Сцена и тавернщик", launch: "Сохранение и запуск" };

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
      width: 900,
      height: 740
    }
  };

  static PARTS = {
    main: { template: TEMPLATES.gm }
  };

  constructor(options = {}) {
    const initialTavern = options.tavern ? foundry.utils.deepClone(options.tavern) : null;
    const appOptions = { ...options };
    delete appOptions.tavern;
    delete appOptions.tab;
    delete appOptions.activeTab;

    super(appOptions);
    this.draft = initialTavern;
    this.editorTab = "menu";
    this.workflowStep = this.draft ? "assortment" : "setup";
    this.params = this.#paramsFromTavern(this.draft);
    this.sceneConfig = TavernSceneService.defaultConfig();
    this.keeperConfig = CharacterForgeAdapter.defaultConfig();
    this.undoDraft = null;
    this.pendingDraftUpdate = null;
    this.offeringExpanded = false;
    gmInstances.add(this);
  }

  static renderOpenInstances({ syncStored = false, syncCurrent = false } = {}) {
    for (const app of gmInstances) {
      if (!app.rendered) continue;
      if (syncStored || syncCurrent) app.#syncFromStore();
      app.render();
    }
  }

  /** Synchronize matching previews, retaining updates that arrive during a GM action. */
  static receiveDraftUpdate(tavern) {
    if (!game.user.isGM || !tavern?.id) return;
    for (const app of gmInstances) {
      if (app.draft?.id !== tavern.id) continue;
      app.pendingDraftUpdate = {
        before: app.pendingDraftUpdate?.tavern.id === tavern.id
          ? app.pendingDraftUpdate.before : foundry.utils.deepClone(app.draft),
        tavern: foundry.utils.deepClone(tavern)
      };
      if (!app.actionPending) {
        app.#reconcileDraftUpdate();
        if (app.rendered) app.render();
      }
    }
  }

  // Keep the latest tavern update and replay only fields changed locally since it
  // was deferred. Inventory arrays merge by id so a name edit cannot undo a refill.
  static #mergeDraftUpdate(before, local, incoming) {
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const clone = (value) => foundry.utils.deepClone(value);
    if (same(local, before)) return clone(incoming);
    if (same(incoming, before) || same(local, incoming)) return clone(local);
    const arrays = [before, local, incoming];
    if (arrays.every(Array.isArray) && arrays.every((items) => items.every((item) => item?.id))) {
      const [oldItems, localItems, newItems] = arrays.map((items) => new Map(items.map((item) => [item.id, item])));
      return [...new Set([...newItems.keys(), ...localItems.keys()])]
        .map((id) => this.#mergeDraftUpdate(oldItems.get(id), localItems.get(id), newItems.get(id)))
        .filter((item) => item !== undefined);
    }
    const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
    if (arrays.every(object)) {
      const result = {};
      for (const key of new Set([...Object.keys(before), ...Object.keys(local), ...Object.keys(incoming)])) {
        const value = this.#mergeDraftUpdate(before[key], local[key], incoming[key]);
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    // An explicit local edit wins over an automatic change to the same field.
    return clone(local);
  }

  #reconcileDraftUpdate() {
    const pending = this.pendingDraftUpdate;
    if (!pending) return false;
    this.pendingDraftUpdate = null;
    if (this.draft?.id !== pending.tavern.id) return false;
    const current = TavernState.getCurrent();
    const saved = current?.id === this.draft.id ? current : TavernState.getSavedById(this.draft.id);
    const incoming = Number(saved?.storageRevision ?? 0) > Number(pending.tavern.storageRevision ?? 0) ? saved : pending.tavern;
    this.draft = TavernGMApp.#mergeDraftUpdate(pending.before, this.draft, incoming);
    // A booking may have arrived after the editor validated the old room. Keep
    // the authoritative room if replaying that edit would invalidate paid places.
    for (const room of incoming.inventory?.lodging ?? []) {
      const index = this.draft.inventory.lodging.findIndex((entry) => entry.id === room.id);
      try {
        if (index < 0) TavernGenerator.removeEntry(incoming, "lodging", room.id);
        else TavernGenerator.upsertEntry(incoming, "lodging", room.id, this.draft.inventory.lodging[index]);
      } catch (error) {
        if (index < 0) this.draft.inventory.lodging.push(foundry.utils.deepClone(room));
        else this.draft.inventory.lodging[index] = foundry.utils.deepClone(room);
        ui.notifications.warn(error.message ?? String(error));
      }
    }
    this.draft.summary = TavernGenerator.decoratePrices(this.draft)?.summary ?? this.draft.summary;
    this.undoDraft = null;
    return true;
  }

  async _onClose(options) {
    gmInstances.delete(this);
    return super._onClose?.(options);
  }

  async _prepareContext(options) {
    if (!game.user?.isGM) return { isGM: false };
    const decorated = TavernGenerator.decoratePrices(this.draft);
    const saved = TavernState.getSaved().map((tavern) => ({
      id: tavern.id,
      name: tavern.name,
      meta: `${tavern.labels?.region ?? ""} · ${tavern.labels?.terrain ?? ""}`
    }));

    const linkedScene = decorated?.scene?.id ? game.scenes?.get(decorated.scene.id) : null;
    const hasLinkedSceneMeta = Boolean(decorated?.scene?.id || decorated?.scene?.compendium?.id);
    const tavernkeeper = CharacterForgeAdapter.getActorMeta(decorated);

    return {
      editorTab: this.editorTab,
      workflowStep: this.workflowStep,
      generationPlan: TavernGenerationPlan.describe(this.params),
      offeringStatus: this.draft ? TavernOfferingModel.status({ ...this.draft, offeringPlan: TavernInventory.planFor(this.draft) }) : null,
      offeringExpanded: this.offeringExpanded,
      savedCount: saved.length,
      isSaved: saved.some((entry) => entry.id === this.draft?.id),
      autoSave: Boolean(this.draft && (saved.some((entry) => entry.id === this.draft.id) || TavernState.getCurrent()?.id === this.draft.id)),
      manualScene: this.sceneConfig.mode === "manual",
      hasSceneTemplateChoices: Object.keys(TavernSceneService.templateChoices()).length > 1,
      options: TAVERN_OPTIONS,
      sceneOptions: {
        modes: TavernSceneService.sceneModeChoices(),
        templates: TavernSceneService.templateChoices()
      },
      sceneConfig: this.sceneConfig,
      sceneArtRoot: TavernSceneService.artRoot(),
      sceneCreateDisabled: !decorated || this.sceneConfig.mode === "none" || (this.sceneConfig.mode === "manual" && !this.sceneConfig.manualImagePath),
      sceneDisabledReason: this.sceneConfig.mode === "none" ? "Выбери источник фона, чтобы создать сцену."
        : this.sceneConfig.mode === "manual" && !this.sceneConfig.manualImagePath ? "Выбери файл фона или введи путь к нему." : "",
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
      canPlaceKeeper: Boolean(hasLinkedSceneMeta && tavernkeeper && (tavernkeeper.exists || tavernkeeper.archived)),
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
      saved,
      hasSaved: saved.length > 0,
      canUndo: Boolean(this.undoDraft),
      isGM: game.user.isGM
    };
  }

  async _onRender(context, options) {
    this.element.onsubmit = (event) => event.preventDefault();
    const offeringStatus = this.element.querySelector(".tg-offering-status");
    offeringStatus?.addEventListener("toggle", () => { if (offeringStatus.isConnected) this.offeringExpanded = offeringStatus.open; });
    this.#bindWorkflow();
    this.element.querySelector("[name='generationName']")?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      this.#runAction(() => this.#onGenerate(event));
    });
    this.element.querySelector("[name='generationCity']")?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      this.#runAction(() => this.#onGenerate(event));
    });
    this.element.querySelector("[name='tavernCity']")?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      this.#runAction(() => this.#onSetCity(event));
    });
    this.element.querySelector("[name='tavernName']")?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      this.#runAction(() => this.#onRename(event));
    });
    this.element.querySelector("[name='draftPricePercent']")?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      this.#runAction(() => this.#onApplyPriceModifier(event));
    });
    this.element.querySelector("[data-action='ensureOfferings']")?.addEventListener("click", (event) => this.#runAction(async () => {
      event.preventDefault();
      if (!this.draft) return;
      const tavernId = this.draft.id;
      if (!await this.#confirm("Добавить недостающие основные блюда, питьё и бытовые предложения? Существующие позиции, цены, остатки, брони и свои правки сохранятся. Распроданные позиции не пополняются.", "Дополнить основу таверны")) return;
      if (this.draft?.id !== tavernId) throw new Error("В редакторе уже другая таверна. Повтори действие для неё.");
      this.#reconcileDraftUpdate();
      this.#checkpoint();
      this.draft = TavernInventory.ensureOfferings(this.draft);
      await this.#persistLiveDraft();
      const status = TavernOfferingModel.status(this.draft);
      if (status.complete) ui.notifications.info(status.summary);
      else ui.notifications.warn(`${status.summary}. Проверь назначение существующих позиций и доступность подходящих вариантов в каталоге.`);
      this.render();
    }));
    this.element.querySelector("[data-action='renewStockNorms']")?.addEventListener("click", (event) => this.#runAction(async () => {
      event.preventDefault();
      if (!this.draft) return;
      if (!await this.#confirm("Пересчитать и пополнить запасы каталожной еды, напитков и услуг по размеру таверны? Ночлег, цены и свои позиции останутся прежними.", "Обновить нормы запасов")) return;
      this.#checkpoint();
      this.draft = TavernStockService.renewCapacities(this.draft);
      await this.#persistLiveDraft();
      this.render();
    }));
    this.element.querySelector("[data-action='addProvisions']")?.addEventListener("click", (event) => this.#runAction(async () => {
      event.preventDefault();
      if (!this.draft) return;
      this.#checkpoint();
      this.draft = TavernInventory.addProvisions(this.draft);
      await this.#persistLiveDraft();
      this.render();
    }));
    const editorTabs = [...this.element.querySelectorAll("[data-editor-tab]")];
    for (const button of editorTabs) {
      const selectTab = () => {
        if (this.actionPending) return;
        this.editorTab = button.dataset.editorTab;
        for (const panel of this.element.querySelectorAll("[data-editor-panel]")) panel.hidden = panel.dataset.editorPanel !== this.editorTab;
        for (const tab of this.element.querySelectorAll("[data-editor-tab]")) {
          const selected = tab.dataset.editorTab === this.editorTab;
          tab.classList.toggle("is-active", selected);
          tab.setAttribute("aria-selected", String(selected));
          tab.tabIndex = selected ? 0 : -1;
        }
      };
      button.addEventListener("click", selectTab);
      button.addEventListener("keydown", (event) => {
        if (this.actionPending || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const index = editorTabs.indexOf(button);
        const next = event.key === "Home" ? 0 : event.key === "End" ? editorTabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + editorTabs.length) % editorTabs.length;
        editorTabs[next].focus();
        editorTabs[next].click();
      });
    }
    this.element.querySelector("[data-action='openLibrary']")?.addEventListener("click", () => {
      TavernLibraryApp.open({ onEdit: (id) => this.rendered ? this.loadSavedTavern(id) : game.fblTaverns.openGM({ tavernId: id }) });
    });
    this.element.querySelector("[data-action='rename']")?.addEventListener("click", (event) => this.#runAction(() => this.#onRename(event)));
    this.element.querySelector("[data-action='setCity']")?.addEventListener("click", (event) => this.#runAction(() => this.#onSetCity(event)));
    this.element.querySelector("[data-action='openTavern']")?.addEventListener("click", (event) => {
      event.preventDefault();
      if (game.user.isGM && this.draft) TavernPlayerApp.openSingleton({ tavern: this.draft, followCurrent: false });
    });

    this.element.querySelector("[data-action='generate']")?.addEventListener("click", (event) => this.#runAction(() => this.#onGenerate(event)));
    this.element.querySelector("[data-action='openPlayers']")?.addEventListener("click", (event) => this.#runAction(() => this.#onOpenPlayers(event)));
    this.element.querySelector("[data-action='rerollName']")?.addEventListener("click", (event) => this.#runAction(() => this.#onRerollName(event)));
    this.element.querySelector("[data-action='applyPriceModifier']")?.addEventListener("click", (event) => this.#runAction(() => this.#onApplyPriceModifier(event)));
    this.element.querySelector("[data-action='saveDraft']")?.addEventListener("click", (event) => this.#runAction(() => this.#onSaveDraft(event)));
    this.element.querySelector("[data-action='browseSceneImage']")?.addEventListener("click", (event) => this.#runAction(() => this.#onBrowseSceneImage(event)));
    this.element.querySelector("[data-action='createScene']")?.addEventListener("click", (event) => this.#runAction(() => this.#onCreateScene(event)));
    this.element.querySelector("[data-action='openLinkedScene']")?.addEventListener("click", (event) => this.#runAction(() => this.#onOpenLinkedScene(event)));
    this.element.querySelector("[data-action='createTavernkeeper']")?.addEventListener("click", (event) => this.#runAction(() => this.#onCreateTavernkeeper(event)));
    this.element.querySelector("[data-action='openTavernkeeper']")?.addEventListener("click", (event) => this.#runAction(() => this.#onOpenTavernkeeper(event)));
    this.element.querySelector("[data-action='placeTavernkeeper']")?.addEventListener("click", (event) => this.#runAction(() => this.#onPlaceTavernkeeper(event)));
    this.element.querySelector("[data-action='undo']")?.addEventListener("click", (event) => this.#runAction(() => this.#onUndo(event)));
    this.element.querySelector("[data-action='restockAll']")?.addEventListener("click", (event) => this.#runAction(() => this.#onRestockAll(event)));

    for (const button of this.element.querySelectorAll("[data-action='editEntry']")) {
      button.addEventListener("click", (event) => this.#runAction(() => this.#onEditEntry(event)));
    }

    for (const button of this.element.querySelectorAll("[data-action='addCustom']")) {
      button.addEventListener("click", (event) => this.#runAction(() => this.#onAddCustom(event)));
    }

    for (const button of this.element.querySelectorAll("[data-action='togglePinned']")) {
      button.addEventListener("click", (event) => this.#runAction(() => this.#onTogglePinned(event)));
    }

    for (const button of this.element.querySelectorAll("[data-action='removeEntry']")) {
      button.addEventListener("click", (event) => this.#runAction(() => this.#onRemoveEntry(event)));
    }

    for (const button of this.element.querySelectorAll("[data-action='addRandom']")) {
      button.addEventListener("click", (event) => this.#runAction(() => this.#onAddRandom(event)));
    }

    for (const input of this.element.querySelectorAll("select[data-param], input[data-param]")) {
      if (input.dataset.param === "name") input.addEventListener("input", () => { this.params.name = input.value; });
      input.addEventListener("change", () => {
        if (input.dataset.param === "priceMultiplierPercent") this.params.priceMultiplier = this.#percentToMultiplier(input.value);
        else this.params[input.dataset.param] = input.value;
        this.#updateGenerationPlan();
      });
    }

    for (const input of this.element.querySelectorAll("select[data-scene-param], input[data-scene-param]")) {
      if (input.dataset.sceneParam === "manualImagePath") input.addEventListener("input", () => {
        this.#readSceneConfig();
        const createButton = this.element.querySelector("[data-action='createScene']");
        if (createButton) createButton.disabled = !this.draft || this.sceneConfig.mode === "none" || (this.sceneConfig.mode === "manual" && !this.sceneConfig.manualImagePath);
        const hint = this.element.querySelector("[data-scene-hint]");
        if (hint) hint.textContent = this.sceneConfig.manualImagePath ? "" : "Выбери файл фона или введи путь к нему.";
      });
      input.addEventListener("change", () => {
        this.#readSceneConfig();
        if (input.dataset.sceneParam === "mode") this.render();
      });
    }

    for (const input of this.element.querySelectorAll("select[data-keeper-param], input[data-keeper-param]")) {
      input.addEventListener("change", () => this.#readKeeperConfig());
    }

    for (const input of this.element.querySelectorAll("input[data-lodging-field]")) {
      input.addEventListener("change", (event) => this.#runAction(() => this.#onLodgingChange(event)));
    }
  }

  #bindWorkflow() {
    const tabs = [...this.element.querySelectorAll("[data-workflow-step]")];
    for (const button of tabs) {
      button.addEventListener("click", () => this.#selectWorkflowStep(button.dataset.workflowStep));
      button.addEventListener("keydown", (event) => {
        if (this.actionPending || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const enabled = tabs.filter((tab) => !tab.disabled);
        const index = enabled.indexOf(button);
        const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + enabled.length) % enabled.length;
        enabled[next]?.focus();
        enabled[next]?.click();
      });
    }
    for (const button of this.element.querySelectorAll("[data-step-target]")) {
      button.addEventListener("click", () => this.#selectWorkflowStep(button.dataset.stepTarget, { focus: true }));
    }
    this.#selectWorkflowStep(this.workflowStep, { initial: true });
  }

  #selectWorkflowStep(step, { focus = false, initial = false } = {}) {
    if ((this.actionPending && !initial) || !WORKFLOW_STEPS.includes(step) || (step !== "setup" && !this.draft)) return;
    const changed = this.workflowStep !== step;
    this.workflowStep = step;
    for (const panel of this.element.querySelectorAll("[data-workflow-panel]")) {
      panel.hidden = panel.dataset.workflowPanel !== step;
      if (!panel.hidden && focus) panel.querySelector("h2")?.focus();
    }
    for (const button of this.element.querySelectorAll("[data-workflow-step]")) {
      const selected = button.dataset.workflowStep === step;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    const index = WORKFLOW_STEPS.indexOf(step);
    const previous = this.element.querySelector("[data-workflow-previous]");
    const next = this.element.querySelector("[data-workflow-next]");
    if (previous) {
      previous.hidden = index <= 1;
      previous.dataset.stepTarget = WORKFLOW_STEPS[index - 1] ?? "setup";
      previous.textContent = `← ${WORKFLOW_LABELS[WORKFLOW_STEPS[index - 1]] ?? "Назад"}`;
    }
    if (next) {
      next.hidden = index === 0 || index === WORKFLOW_STEPS.length - 1;
      next.dataset.stepTarget = WORKFLOW_STEPS[index + 1] ?? "launch";
      next.textContent = `${WORKFLOW_LABELS[WORKFLOW_STEPS[index + 1]] ?? "Далее"} →`;
    }
    const footer = this.element.querySelector("[data-workflow-footer]");
    if (footer) footer.hidden = index === 0;
    if (focus || changed) this.element.querySelector("[data-workflow-scroll]")?.scrollTo({ top: 0 });
  }

  #updateGenerationPlan() {
    const plan = TavernGenerationPlan.describe(this.params);
    for (const node of this.element.querySelectorAll("[data-generation-preview]")) {
      node.textContent = plan[node.dataset.generationPreview] ?? "";
    }
  }

  async #onGenerate(event) {
    event.preventDefault();
    if (this.draft && !TavernState.getSavedById(this.draft.id)) {
      if (!await this.#confirm(`Создать другую таверну вместо несохранённого черновика <strong>${this.#escapeHtml(this.draft.name)}</strong>? Сначала сохрани черновик, если хочешь оставить оба заведения.`, "Заменить черновик")) return;
    }
    this.#checkpoint();
    this.#readParams();
    this.#readSceneConfig();
    this.draft = TavernGenerator.generate(this.params);
    this.workflowStep = "assortment";
    this.editorTab = "menu";
    this.render();
  }

  async #onOpenPlayers(event) {
    event.preventDefault();
    if (!game.user.isGM) return;
    if (!this.draft) return;
    this.#reconcileDraftUpdate();
    this.draft = await TavernState.saveTavern(this.draft);
    TavernSocket.refreshAll(this.draft);
    TavernSocket.openForPlayers(this.draft);
    ui.notifications.info("Окно таверны отправлено игрокам.");
    this.render();
  }

  async #onRerollName(event) {
    event.preventDefault();
    if (!this.draft) return;
    this.#checkpoint();
    const params = this.#paramsFromTavern(this.draft);
    const fresh = TavernGenerator.generate(params);
    this.draft.name = fresh.name;
    await this.#persistLiveDraft();
    this.render();
  }

  async #onApplyPriceModifier(event) {
    event.preventDefault();
    if (!this.draft) return ui.notifications.warn("Сначала сгенерируй таверну.");
    this.#checkpoint();
    const percent = this.element.querySelector("[name='draftPricePercent']")?.value ?? (Number(this.draft.priceMultiplier) || 1) * 100;
    this.draft = TavernGenerator.applyPriceMultiplier(this.draft, this.#percentToMultiplier(percent));
    await this.#persistLiveDraft();
    this.render();
  }

  async #onSaveDraft(event) {
    event.preventDefault();
    if (!game.user.isGM) return;
    if (!this.draft) return;
    this.#reconcileDraftUpdate();
    const saved = await TavernState.saveTavern(this.draft);
    this.draft = saved;
    TavernSocket.refreshAll(saved);
    ui.notifications.info(`Таверна сохранена: ${saved.name}`);
    this.render();
  }

  async loadSavedTavern(id) {
    if (!game.user?.isGM) return false;
    if (this.actionPending) {
      ui.notifications.warn("Дождись завершения текущего действия в генераторе.");
      return false;
    }
    return this.#runAction(async () => {
      let saved = TavernState.getSavedById(id);
      if (!saved) throw new Error("Сохранённая таверна не найдена.");
      if (this.draft?.id !== id && this.draft && !TavernState.getSavedById(this.draft.id)) {
        if (!await this.#confirm(`Открыть сохранённую таверну вместо несохранённого черновика <strong>${this.#escapeHtml(this.draft.name)}</strong>?`, "Открыть из библиотеки")) return;
        saved = TavernState.getSavedById(id);
        if (!saved) throw new Error("Сохранённая таверна не найдена.");
      }
      this.#checkpoint();
      this.draft = foundry.utils.deepClone(saved);
      this.params = this.#paramsFromTavern(this.draft);
      this.workflowStep = "assortment";
      this.editorTab = "menu";
      this.render(true);
      this.bringToFront?.();
    });
  }

  async #onRename(event) {
    event.preventDefault();
    if (!this.draft) return;
    const name = TavernNames.normalizeCustomName(this.element.querySelector("[name='tavernName']")?.value);
    if (!name) throw new Error("Введи название таверны.");
    if (name === this.draft.name) return;
    this.#checkpoint();
    this.draft.name = name;
    await this.#persistLiveDraft();
    this.render();
  }

  async #onSetCity(event) {
    event.preventDefault();
    if (!this.draft) return;
    const city = TavernLocation.normalizeCity(this.element.querySelector("[name='tavernCity']")?.value);
    if (city === this.draft.city) return;
    this.#checkpoint();
    this.draft.city = city;
    await this.#persistLiveDraft();
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
    this.#readKeeperConfig();
    const button = event.currentTarget;
    if (this.draft.scene && !await this.#confirm("Создать другую сцену для этой таверны? Связь переключится на новую сцену, предыдущая сцена останется в мире.", "Создать другую сцену")) return;
    button.disabled = true;

    try {
      const { scene, meta } = await TavernSceneService.createSceneForTavern(this.draft, { ...this.sceneConfig, placeTavernkeeper: this.keeperConfig.placeTokenOnScene });
      this.draft.scene = meta;
      this.#reconcileDraftUpdate();
      this.draft = await TavernState.saveTavern(this.draft);

      TavernSocket.refreshAll(this.draft);

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
        this.#reconcileDraftUpdate();
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
    if (this.draft.tavernkeeper && !await this.#confirm("Создать нового тавернщика? Таверна и её токен будут связаны с новым актёром. Прежний актёр останется в мире.", "Заменить тавернщика")) return;
    button.disabled = true;

    try {
      this.#readKeeperConfig();
      const meta = await CharacterForgeAdapter.createTavernkeeper(this.draft, {
        replace: true,
        archiveToCompendium: this.keeperConfig.archiveToCompendium
      });
      this.#reconcileDraftUpdate();
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
            this.#reconcileDraftUpdate();
            this.draft = await TavernState.saveTavern(this.draft);
          }
        } catch (tokenError) {
          console.warn("fbl-tavern-generator | Could not place tavernkeeper token", tokenError);
          ui.notifications.warn("Тавернщик создан, но токен не удалось поставить на сцену.");
        }
      }

      TavernSocket.refreshAll(this.draft);

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

  async #onPlaceTavernkeeper(event) {
    event.preventDefault();
    if (!this.draft?.scene || !this.draft?.tavernkeeper) return;
    this.draft.tavernkeeper = await CharacterForgeAdapter.refreshTavernkeeperArt(this.draft);
    const placed = await TavernSceneService.placeTavernkeeperOnLinkedScene(this.draft, { replaceExisting: true, archiveScene: true, importActor: true });
    if (!placed?.token?.id) throw new Error("Не удалось поставить токен. Проверь связанную сцену и актёра.");
    this.#reconcileDraftUpdate();
    this.draft.scene.tavernkeeperTokenId = placed.token.id;
    this.draft = await TavernState.saveTavern(this.draft);
    TavernSocket.refreshAll(this.draft);
    ui.notifications.info("Токен тавернщика добавлен на связанную сцену.");
    this.render();
  }

  async #onRemoveEntry(event) {
    event.preventDefault();
    if (!this.draft) return;
    this.#checkpoint();
    const button = event.currentTarget;
    this.draft = TavernGenerator.removeEntry(this.draft, button.dataset.category, button.dataset.entryId);
    await this.#persistLiveDraft();
    this.render();
  }

  async #onAddRandom(event) {
    event.preventDefault();
    if (!this.draft) return ui.notifications.warn("Сначала сгенерируй таверну.");
    const category = event.currentTarget.dataset.category;
    const before = this.#categoryLength(category);
    const previousUndo = this.undoDraft ? foundry.utils.deepClone(this.undoDraft) : null;
    this.#checkpoint();
    this.draft = TavernGenerator.addRandomEntry(this.draft, category);
    if (this.#categoryLength(category) === before) {
      this.undoDraft = previousUndo;
      return ui.notifications.info("Больше уникальных позиций такого типа для параметров таверны нет.");
    }
    await this.#persistLiveDraft();
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
    await this.#persistLiveDraft();
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
    await this.#persistLiveDraft();
    this.render();
  }

  async #onTogglePinned(event) {
    event.preventDefault();
    if (!this.draft) return;
    const { category, entryId } = event.currentTarget.dataset;
    this.#checkpoint();
    this.draft = TavernGenerator.togglePinned(this.draft, category, entryId);
    await this.#persistLiveDraft();
    this.render();
  }

  async #onRestockAll(event) {
    event.preventDefault();
    if (!this.draft) return;
    this.#checkpoint();
    this.draft = TavernGenerator.restockAll(this.draft);
    await this.#persistLiveDraft();
    ui.notifications.info("Запасы еды, напитков и услуг пополнены до штатного максимума.");
    this.render();
  }

  async #onUndo(event) {
    event.preventDefault();
    if (!this.undoDraft) return;
    const active = TavernState.getCurrent();
    const latest = active?.id === this.undoDraft.id ? active : TavernState.getSavedById(this.undoDraft.id);
    const current = this.draft ? foundry.utils.deepClone(this.draft) : null;
    if (current?.id !== this.undoDraft.id) {
      // Switching the editor back must not compare revisions of two different taverns
      // or restore stale stock if the previous tavern was purchased from while hidden.
      this.draft = foundry.utils.deepClone(latest ?? this.undoDraft);
      this.undoDraft = current;
      this.undoRevision = current?.storageRevision ?? 0;
      this.params = this.#paramsFromTavern(this.draft);
      this.workflowStep = "assortment";
      this.render();
      return;
    }
    if (latest && Number(latest.storageRevision ?? 0) !== Number(this.undoRevision ?? 0)) {
      this.undoDraft = null;
      throw new Error("После правки произошла покупка или другое изменение. Отмена сброшена, чтобы сохранить актуальные запасы и брони.");
    }
    this.draft = foundry.utils.deepClone(this.undoDraft);
    this.undoDraft = current;
    this.draft.storageRevision = current?.storageRevision ?? 0;
    await this.#persistLiveDraft();
    this.render();
  }

  async #persistLiveDraft() {
    if (!game.user.isGM || !this.draft?.id) return;
    this.#reconcileDraftUpdate();
    const current = TavernState.getCurrent();
    const saved = TavernState.getSavedById(this.draft.id);
    if (saved || current?.id === this.draft.id) this.draft = await TavernState.saveTavern(this.draft);
    this.undoRevision = this.draft.storageRevision ?? 0;
    if (saved || current?.id === this.draft.id) TavernSocket.refreshAll(this.draft);
  }

  async #onLodgingChange(event) {
    if (!this.draft) return;
    this.#checkpoint();
    const input = event.currentTarget;
    const patch = {};
    if (input.dataset.lodgingField === "unlimited") patch.unlimited = input.checked;
    else patch[input.dataset.lodgingField] = input.value;
    this.draft = TavernGenerator.updateLodgingEntry(this.draft, input.dataset.entryId, patch);
    await this.#persistLiveDraft();
    this.render();
  }

  #readParams() {
    const form = this.element;
    this.params.name = form.querySelector("[name='generationName']")?.value ?? this.params.name ?? "";
    this.params.city = form.querySelector("[name='generationCity']")?.value ?? this.params.city ?? "";
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

  #syncFromStore() {
    if (this.actionPending) return;
    const current = TavernState.getCurrent();
    const stored = current?.id === this.draft?.id ? current : TavernState.getSavedById(this.draft?.id);
    if (!stored) return;
    if (Number(this.draft?.storageRevision ?? 0) !== Number(stored.storageRevision ?? 0)) this.undoDraft = null;
    this.draft = foundry.utils.deepClone(stored);
  }

  #checkpoint() {
    this.undoDraft = this.draft ? foundry.utils.deepClone(this.draft) : null;
    this.undoRevision = this.draft?.storageRevision ?? 0;
  }

  async #runAction(task) {
    if (!game.user?.isGM || this.actionPending) return;
    this.actionPending = true;
    this.element?.setAttribute?.("aria-busy", "true");
    const before = this.draft ? foundry.utils.deepClone(this.draft) : null;
    try { await task(); }
    catch (error) {
      console.warn("fbl-tavern-generator | GM action failed", error);
      const current = TavernState.getCurrent();
      this.draft = current?.id === before?.id ? current : TavernState.getSavedById(before?.id) ?? before;
      this.undoDraft = null;
      ui.notifications.warn(error.message ?? String(error));
      this.render();
    } finally {
      this.actionPending = false;
      this.element?.setAttribute?.("aria-busy", "false");
      // A dialog or external call can defer a purchase refresh. Synchronize once it
      // finishes, but preserve a draft intentionally edited or replaced by the action.
      if (this.#reconcileDraftUpdate()) {
        this.render();
      } else if (JSON.stringify(this.draft) === JSON.stringify(before)) {
        this.#syncFromStore();
        this.render();
      }
    }
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
    if (typeof foundry.utils.escapeHTML === "function") return foundry.utils.escapeHTML(text);
    return text.replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[char]));
  }

  #paramsFromTavern(tavern) {
    return {
      name: "",
      city: TavernLocation.normalizeCity(tavern?.city),
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
