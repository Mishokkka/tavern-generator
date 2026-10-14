export const MODULE_ID = "fbl-tavern-generator";
export const SOCKET_NAME = `module.${MODULE_ID}`;

export const TEMPLATES = {
  library: `modules/${MODULE_ID}/templates/library.hbs`,
  gm: `modules/${MODULE_ID}/templates/gm.hbs`,
  player: `modules/${MODULE_ID}/templates/player.hbs`,
  soundSettings: `modules/${MODULE_ID}/templates/sound-settings.hbs`,
  cart: `modules/${MODULE_ID}/templates/cart.hbs`,
  quantityDialog: `modules/${MODULE_ID}/templates/quantity-dialog.hbs`,
  entryEditor: `modules/${MODULE_ID}/templates/entry-editor.hbs`
};

export const CURRENCY = {
  copper: { label: "ММ", rate: 1 },
  silver: { label: "СМ", rate: 10 },
  gold: { label: "ЗМ", rate: 100 }
};
