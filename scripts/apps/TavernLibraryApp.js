import { MODULE_ID, TEMPLATES } from "../constants.js";
import { TAVERN_OPTIONS } from "../data/index.js";
import { prepareTavernLibrary } from "../services/TavernLibraryView.js";
import { TavernState } from "../services/TavernState.js";
import { TavernPlayerApp } from "./TavernPlayerApp.js";

const instances = new Set();
const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

export class TavernLibraryApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;
  static DEFAULT_OPTIONS = {
    id: "fbl-tavern-library", classes: ["fbl-tavern", "fbl-tavern-library"], tag: "div",
    window: { title: "Сохранённые таверны", icon: "fa-solid fa-book-open", resizable: true },
    position: { width: 920, height: 700 }
  };
  static PARTS = { main: { template: TEMPLATES.library } };

  constructor(options = {}) {
    const { onEdit, ...appOptions } = options;
    super(appOptions);
    instances.add(this);
    this.onEdit = onEdit;
    this.filters = { query: "", region: "", city: "", sort: "recent", page: 1 };
    this.collapsedGroups = new Set();
    this.visibleGroupKeys = [];
    this.scrollTop = 0;
  }

  static open({ onEdit } = {}) {
    if (!game.user?.isGM) return ui.notifications.warn("Менеджер таверн доступен только ГМу.");
    const app = this.instance ??= [...instances].find((entry) => entry.rendered) ?? new this();
    app.onEdit = onEdit;
    app.render(true);
    app.bringToFront?.();
    return app;
  }

  static refresh() {
    for (const app of instances) if (app.rendered && !app.pending) app.render();
  }

  async _onClose(options) {
    instances.delete(this);
    if (TavernLibraryApp.instance === this) TavernLibraryApp.instance = null;
    return super._onClose?.(options);
  }

  async _prepareContext() {
    if (!game.user?.isGM) return { isGM: false };
    const view = prepareTavernLibrary(TavernState.getSaved(), this.filters);
    this.filters.page = view.page;
    this.filters.city = view.cityFilter;
    this.visibleGroupKeys = [];
    for (const region of view.regionGroups) {
      region.closed = this.collapsedGroups.has(region.key);
      this.visibleGroupKeys.push(region.key);
      for (const city of region.cities) {
        city.closed = this.collapsedGroups.has(city.key);
        this.visibleGroupKeys.push(city.key);
      }
    }
    return { ...view, filters: this.filters, regions: TAVERN_OPTIONS.regions, isGM: true, pending: this.pending };
  }

  async _onRender() {
    this.element.querySelector("[data-library-search]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (this.pending) return;
      this.filters.query = this.element.querySelector("[name='libraryQuery']")?.value ?? "";
      this.filters.page = 1;
      this.scrollTop = 0;
      this.collapsedGroups.clear();
      this.focusAfterRender = "[name='libraryQuery']";
      this.render();
    });
    for (const input of this.element.querySelectorAll("[data-library-filter]")) {
      input.addEventListener("change", () => {
        if (this.pending) return;
        this.filters.query = this.element.querySelector("[name='libraryQuery']")?.value ?? this.filters.query;
        this.filters[input.dataset.libraryFilter] = input.value;
        if (input.dataset.libraryFilter === "region") this.filters.city = "";
        this.filters.page = 1;
        this.scrollTop = 0;
        this.collapsedGroups.clear();
        this.focusAfterRender = `[data-library-filter='${input.dataset.libraryFilter}']`;
        this.render();
      });
    }
    const scroller = this.element.querySelector("[data-library-scroll]");
    if (scroller) {
      scroller.scrollTop = this.scrollTop;
      scroller.addEventListener("scroll", () => { if (scroller.isConnected) this.scrollTop = scroller.scrollTop; });
    }
    for (const group of this.element.querySelectorAll("[data-library-group]")) {
      group.addEventListener("toggle", () => {
        if (!group.isConnected) return;
        if (group.open) this.collapsedGroups.delete(group.dataset.libraryGroup);
        else this.collapsedGroups.add(group.dataset.libraryGroup);
      });
    }
    for (const button of this.element.querySelectorAll("[data-library-action]")) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        return this.perform(button.dataset.libraryAction, button.dataset.tavernId);
      });
    }
    const focus = this.focusAfterRender;
    this.focusAfterRender = null;
    if (focus) this.element.querySelector(focus)?.focus?.({ preventScroll: true });
  }

  async perform(action, id) {
    if (!game.user?.isGM || this.pending) return;
    this.pending = true;
    this.element?.setAttribute?.("aria-busy", "true");
    try {
      if (action === "collapseGroups") {
        this.scrollTop = 0;
        this.focusAfterRender = "[data-library-action='collapseGroups']";
        for (const key of this.visibleGroupKeys) this.collapsedGroups.add(key);
        return;
      }
      if (action === "expandGroups") {
        this.scrollTop = 0;
        this.focusAfterRender = "[data-library-action='expandGroups']";
        this.collapsedGroups.clear();
        return;
      }
      if (action === "previous" || action === "next") {
        this.scrollTop = 0;
        this.focusAfterRender = "[data-library-scroll]";
        this.filters.page += action === "next" ? 1 : -1;
        return;
      }
      if (action === "reset") {
        Object.assign(this.filters, { query: "", region: "", city: "", page: 1 });
        this.collapsedGroups.clear();
        this.scrollTop = 0;
        this.focusAfterRender = "[name='libraryQuery']";
        return;
      }
      const tavern = TavernState.getSavedById(id);
      if (!tavern) return ui.notifications.warn("Таверна уже удалена. Список обновлён.");
      if (action === "edit") {
        if (this.onEdit) await this.onEdit(id);
        else game.fblTaverns.openGM({ tavernId: id });
      } else if (action === "preview") {
        TavernPlayerApp.openSingleton({ tavern, followCurrent: false });
      } else if (action === "delete") {
        const confirmed = await DialogV2.confirm({
          window: { title: "Удалить сохранённую таверну" }, modal: true, rejectClose: false,
          content: `<p>Удалить <strong>${foundry.utils.escapeHTML(tavern.name)}</strong> из библиотеки? Это нельзя отменить.</p><p>Связанная сцена и актёр останутся на месте.</p>`
        });
        if (!confirmed || !game.user?.isGM) return;
        await TavernState.deleteSaved(id);
        Hooks.callAll(`${MODULE_ID}.refresh`);
        ui.notifications.info("Таверна удалена из библиотеки.");
      }
    } catch (error) {
      console.warn(`${MODULE_ID} | Library action failed`, error);
      ui.notifications.warn(error.message ?? String(error));
    } finally {
      this.pending = false;
      this.element?.setAttribute?.("aria-busy", "false");
      this.render();
    }
  }
}
