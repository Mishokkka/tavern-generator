import { TEMPLATES } from "../constants.js";
import { PurchaseSoundService } from "../services/PurchaseSoundService.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TavernSoundSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "fbl-tavern-sound-settings",
    classes: ["fbl-tavern", "fbl-tavern-sound-settings"],
    tag: "form",
    window: {
      title: "Звуки покупок таверны",
      icon: "fa-solid fa-volume-high",
      resizable: true
    },
    position: {
      width: 680,
      height: 520
    }
  };

  static PARTS = {
    main: { template: TEMPLATES.soundSettings }
  };

  async _prepareContext(options) {
    const categories = PurchaseSoundService.categories();
    return {
      volumePercent: Math.round(PurchaseSoundService.getVolume() * 100),
      rows: Object.entries(categories).map(([category, config]) => ({
        category,
        label: config.label,
        hint: config.hint,
        value: PurchaseSoundService.getPath(category)
      }))
    };
  }

  async _onRender(context, options) {
    for (const button of this.element.querySelectorAll("[data-action='browseSound']")) {
      button.addEventListener("click", (event) => this.#onBrowseSound(event));
    }

    for (const button of this.element.querySelectorAll("[data-action='clearSound']")) {
      button.addEventListener("click", (event) => this.#onClearSound(event));
    }

    this.element.querySelector("[data-action='save']")?.addEventListener("click", (event) => this.#onSave(event));
    this.element.querySelector("[data-action='cancel']")?.addEventListener("click", (event) => {
      event.preventDefault();
      this.close();
    });
  }

  async #onBrowseSound(event) {
    event.preventDefault();
    const category = event.currentTarget.dataset.category;
    const input = this.element.querySelector(`[data-sound-path='${category}']`);
    const current = input?.value || PurchaseSoundService.getPath(category) || "";

    const FilePickerClass = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    if (!FilePickerClass) return ui.notifications.error("FilePicker недоступен.");

    const picker = new FilePickerClass({
      type: "audio",
      current: PurchaseSoundService.normalizePath(current),
      allowUpload: true,
      callback: (path) => {
        if (input) input.value = PurchaseSoundService.normalizePath(path);
      }
    });

    return picker.render(true);
  }

  #onClearSound(event) {
    event.preventDefault();
    const category = event.currentTarget.dataset.category;
    const input = this.element.querySelector(`[data-sound-path='${category}']`);
    if (input) input.value = "";
  }

  async #onSave(event) {
    event.preventDefault();

    for (const input of this.element.querySelectorAll("[data-sound-path]")) {
      await PurchaseSoundService.setPath(input.dataset.soundPath, input.value);
    }

    const volumePercent = Number(this.element.querySelector("[name='volumePercent']")?.value ?? 55);
    await PurchaseSoundService.setVolume(volumePercent / 100);
    ui.notifications.info("Звуки покупок таверны сохранены.");
    this.close();
  }
}
