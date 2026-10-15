import { MODULE_ID } from "../constants.js";

const DICE = [null, "d6", "d8", "d10", "d12"];
const LABELS = { food: "Пайки", water: "Вода" };

export class ForbiddenLandsResourceAdapter {
  static plan(actor, purchases, receiptId) {
    const resources = purchases.filter((line) => line.resource);
    if (!resources.length) return null;
    if (resources.some((line) => !Object.hasOwn(LABELS, line.resource.kind) || line.resource.steps !== 1 || !Number.isInteger(line.quantity) || line.quantity < 1)) throw new Error("Некорректная позиция дорожных припасов.");
    if (game.system?.id !== "forbidden-lands" || actor.type !== "character") throw new Error("Пайки и вода поддерживают лист персонажа Forbidden Lands.");
    const before = {}, after = {}, items = [], messages = [];
    for (const kind of Object.keys(LABELS)) {
      const lines = resources.filter((line) => line.resource.kind === kind);
      if (!lines.length) continue;
      const path = `system.consumable.${kind}.value`;
      const value = foundry.utils.getProperty(actor, path);
      if (!Number.isInteger(value) || value < 0 || value > 4) throw new Error(`Не распознано поле ресурса «${LABELS[kind]}» в листе персонажа.`);
      const automatic = lines.filter((line) => line.delivery !== "inventory").reduce((n, line) => n + line.quantity, 0);
      const inventory = lines.filter((line) => line.delivery === "inventory").reduce((n, line) => n + line.quantity, 0);
      const added = Math.min(4 - value, automatic);
      if (added) { before[path] = value; after[path] = value + added; messages.push(`${LABELS[kind]}: ${DICE[value] ?? "нет"} → ${DICE[value + added]}.`); }
      let remaining = inventory + automatic - added;
      while (remaining > 0) {
        const steps = Math.min(4, remaining);
        const quantity = Math.floor(remaining / steps);
        const name = `${LABELS[kind]} [${DICE[steps]}]`;
        items.push({
          _id: foundry.utils.randomID(16), name, type: "gear",
          img: kind === "food" ? "icons/consumables/grains/bread-loaf-boule-tan.webp" : "icons/consumables/drinks/water-skin-brown.webp",
          system: { quantity, weight: "regular", description: `Дорожный запас: ${steps} шаг(а) ресурса. Каждый шаг повышает ресурс на одну ступень: нет → d6 → d8 → d10 → d12. Вес одной упаковки — 1.` },
          flags: { "forbidden-lands": { state: "carried" }, [MODULE_ID]: { resource: { kind, steps }, purchaseReceipt: receiptId } }
        });
        messages.push(`В инвентарь: ${name} × ${quantity} (вес каждой упаковки: 1).`);
        remaining -= steps * quantity;
      }
    }
    if (items.length && (typeof actor.createEmbeddedDocuments !== "function" || typeof actor.deleteEmbeddedDocuments !== "function")) throw new Error("Лист не поддерживает добавление дорожных припасов в инвентарь.");
    return { before, after, items, messages, receiptId };
  }

  static async apply(actor, plan, progress = {}) {
    if (!plan) return;
    for (const [path, value] of Object.entries(plan.before)) {
      if (foundry.utils.getProperty(actor, path) !== value) throw new Error("Запас персонажа изменился во время оплаты. Повтори покупку.");
    }
    // A rejected precondition must not roll back somebody else's resource edit.
    progress.started = true;
    if (Object.keys(plan.after).length) await actor.update(plan.after);
    if (plan.items.length) {
      const created = await actor.createEmbeddedDocuments("Item", plan.items, { keepId: true });
      if (created.length !== plan.items.length) throw new Error("Не все дорожные припасы добавлены в инвентарь.");
    }
  }

  static async rollback(actor, plan) {
    if (!plan) return;
    // Inspect actor items as creation can fail after creating only part of a batch.
    const ids = Array.from(actor.items ?? []).filter((item) => item.flags?.[MODULE_ID]?.purchaseReceipt === plan.receiptId).map((item) => item.id);
    if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
    const restore = {};
    for (const [path, value] of Object.entries(plan.before)) {
      const current = foundry.utils.getProperty(actor, path);
      if (current === value) continue;
      if (current !== plan.after[path]) throw new Error("Ресурс персонажа изменён отдельно; необходима сверка ГМом.");
      restore[path] = value;
    }
    if (Object.keys(restore).length) await actor.update(restore);
  }
}
