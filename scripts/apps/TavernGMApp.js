import { TEMPLATES } from "../constants.js";
import { TAVERN_OPTIONS } from "../data/index.js";
import { TavernGenerator } from "../services/TavernGenerator.js";
import { TavernSceneService } from "../services/TavernSceneService.js";
import { TavernState } from "../services/TavernState.js";
import { TavernSocket } from "../services/TavernSocket.js";
import { CharacterForgeAdapter } from "../services/CharacterForgeAdapter.js";
import { TavernPlayerApp } from "./TavernPlayerApp.js";
import { TavernEntryEditorDialog } from "./TavernEntryEditorDialog.js";

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
    this.pendingDraftUpdate = null;
    gmInstances.add(this);
  }

  static renderOpenInstances({ syncCurrent = false } = {}) {
    for (const app of gmInstances) {
      if (!app.rendered) continue;
      if (syncCurrent) app.#syncFromCurrent();
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
    this.activeTavernId = current?.id === this.draft.id ? this.draft.id : null;
    this.params = this.#paramsFromTavern(this.draft);
    this.undoDraft = null;
    return true;
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
      saved,
      hasSaved: saved.length > 0,
      hasCurrent: Boolean(TavernState.getCurrent()),
      canUndo: Boolean(this.undoDraft),
      isGM: game.user.isGM
    };
  }

  async _onRender(context, options) {
    this.element.querySelector("[data-action='openTavern']")?.addEventListener("click", (event) => {
      event.preventDefault();
      if (game.user.isGM && this.draft) TavernPlayerApp.openSingleton({ tavern: this.draft, followCurrent: false });
    });

    this.element.querySelector("[data-action='generate']")?.addEventListener("click", (event) => this.#runAction(() => this.#onGenerate(event)));
    this.element.querySelector("[data-action='confirm']")?.addEventListener("click", (event) => this.#runAction(() => this.#onConfirm(event)));
    this.element.querySelector("[data-action='openPlayers']")?.addEventListener("click", (event) => this.#runAction(() => this.#onOpenPlayers(event)));
    this.element.querySelector("[data-action='clear']")?.addEventListener("click", (event) => this.#runAction(() => this.#onClear(event)));
    this.element.querySelector("[data-action='rerollName']")?.addEventListener("click", (event) => this.#runAction(() => this.#onRerollName(event)));
    this.element.querySelector("[data-action='applyPriceModifier']")?.addEventListener("click", (event) => this.#runAction(() => this.#onApplyPriceModifier(event)));
    this.element.querySelector("[data-action='saveDraft']")?.addEventListener("click", (event) => this.#runAction(() => this.#onSaveDraft(event)));
    this.element.querySelector("[data-action='loadSaved']")?.addEventListener("click", (event) => this.#runAction(() => this.#onLoadSaved(event)));
    this.element.querySelector("[data-action='deleteSaved']")?.addEventListener("click", (event) => this.#runAction(() => this.#onDeleteSaved(event)));
    this.element.querySelector("[data-action='browseSceneImage']")?.addEventListener("click", (event) => this.#runAction(() => this.#onBrowseSceneImage(event)));
    this.element.querySelector("[data-action='createScene']")?.addEventListener("click", (event) => this.#runAction(() => this.#onCreateScene(event)));
    this.element.querySelector("[data-action='openLinkedScene']")?.addEventListener("click", (event) => this.#runAction(() => this.#onOpenLinkedScene(event)));
    this.element.querySelector("[data-action='createTavernkeeper']")?.addEventListener("click", (event) => this.#runAction(() => this.#onCreateTavernkeeper(event)));
    this.element.querySelector("[data-action='openTavernkeeper']")?.addEventListener("click", (event) => this.#runAction(() => this.#onOpenTavernkeeper(event)));
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
      input.addEventListener("change", (event) => this.#runAction(() => this.#onLodgingChange(event)));
    }
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
    this.#reconcileDraftUpdate();
    this.draft = await TavernState.setCurrent(this.draft);
    this.activeTavernId = this.draft.id;
    TavernSocket.refreshAll(this.draft);
    ui.notifications.info(`Таверна активна: ${this.draft.name}`);
  }

  async #onOpenPlayers(event) {
    event.preventDefault();
    if (!game.user.isGM) return;
    if (!this.draft) this.draft = TavernGenerator.generate(this.params);
    this.#reconcileDraftUpdate();
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
    this.#readParams();
    this.draft = TavernGenerator.applyPriceMultiplier(this.draft, this.params.priceMultiplier);
    await this.#persistLiveDraft();
    this.render();
  }

  async #onSaveDraft(event) {
    event.preventDefault();
    if (!game.user.isGM) return;
    if (!this.draft) this.draft = TavernGenerator.generate(this.params);
    this.#reconcileDraftUpdate();
    const saved = await TavernState.saveTavern(this.draft);
    this.draft = saved;
    TavernSocket.refreshAll(saved);
    ui.notifications.info(`Таверна сохранена: ${saved.name}`);
    this.render();
  }

  #onLoadSaved(event) {
    event.preventDefault();
    const id = this.element.querySelector("select[name='savedTavernId']")?.value;
    if (!id) return ui.notifications.warn("Выбери сохраненную таверну.");
    const saved = TavernState.getSavedById(id);
    if (!saved) return ui.notifications.warn("Сохраненная таверна не найдена.");
    this.#checkpoint();
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
      this.#reconcileDraftUpdate();
      this.draft = await TavernState.saveTavern(this.draft);

      if (this.activeTavernId === this.draft.id || TavernState.getCurrent()?.id === this.draft.id) {
        this.#reconcileDraftUpdate();
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

      if (this.activeTavernId === this.draft.id || TavernState.getCurrent()?.id === this.draft.id) {
        this.#reconcileDraftUpdate();
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
      this.activeTavernId = active?.id === this.draft.id ? this.draft.id : null;
      this.params = this.#paramsFromTavern(this.draft);
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
    if (saved) this.draft = await TavernState.saveTavern(this.draft);
    else if (current?.id === this.draft.id) {
      this.draft = await TavernState.setCurrent(this.draft);
    }
    this.undoRevision = this.draft.storageRevision ?? 0;
    if (current?.id === this.draft.id) {
      this.activeTavernId = this.draft.id;
    }
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
    if (this.actionPending) return;
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

    if (Number(this.draft?.storageRevision ?? 0) !== Number(current.storageRevision ?? 0)) this.undoDraft = null;
    this.draft = foundry.utils.deepClone(current);
    this.activeTavernId = current.id;
    this.params = this.#paramsFromTavern(this.draft);
  }

  #checkpoint() {
    this.undoDraft = this.draft ? foundry.utils.deepClone(this.draft) : null;
    this.undoRevision = this.draft?.storageRevision ?? 0;
  }

  async #runAction(task) {
    if (this.actionPending) return;
    this.actionPending = true;
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
      // A dialog or external call can defer a purchase refresh. Synchronize once it
      // finishes, but preserve a draft intentionally edited or replaced by the action.
      if (this.#reconcileDraftUpdate()) {
        this.render();
      } else if (JSON.stringify(this.draft) === JSON.stringify(before)) {
        this.#syncFromCurrent();
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
