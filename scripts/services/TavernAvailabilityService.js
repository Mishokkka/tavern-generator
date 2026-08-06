import { TavernMigrations } from "./TavernMigrations.js";

const AFFECTED_CATEGORIES = new Set(["food", "drinks", "services"]);

const CROWD_TIERS = [
  { min: 0, label: "свободно", reserveRate: 0, goodsCap: 99, servicesCap: 99 },
  { min: 25, label: "умеренная нагрузка", reserveRate: 0.1, goodsCap: 24, servicesCap: 8 },
  { min: 50, label: "заметная нагрузка", reserveRate: 0.2, goodsCap: 12, servicesCap: 4 },
  { min: 70, label: "высокая нагрузка", reserveRate: 0.35, goodsCap: 6, servicesCap: 2 },
  { min: 85, label: "перегрузка", reserveRate: 0.5, goodsCap: 3, servicesCap: 1 },
  { min: 95, label: "аншлаг", reserveRate: 0.65, goodsCap: 1, servicesCap: 0 }
];

export class TavernAvailabilityService {
  static profile(tavern) {
    const crowd = this.#crowd(tavern);
    const tier = [...CROWD_TIERS].reverse().find((entry) => crowd >= entry.min) ?? CROWD_TIERS[0];
    const reservePercent = Math.round(tier.reserveRate * 100);

    return {
      crowd,
      label: tier.label,
      reserveRate: tier.reserveRate,
      reservePercent,
      goodsCap: tier.goodsCap,
      servicesCap: tier.servicesCap,
      goodsCapLabel: tier.goodsCap >= 99 ? "без ограничений" : `до ${tier.goodsCap} единиц каждой позиции`,
      servicesCapLabel: tier.servicesCap >= 99 ? "без ограничений" : tier.servicesCap > 0 ? `до ${tier.servicesCap} заказов каждой услуги` : "услуги временно недоступны",
      summary: reservePercent
        ? `Посетители удерживают около ${reservePercent}% конечных запасов. Безлимитные товары: ${tier.goodsCap >= 99 ? "без ограничений" : `до ${tier.goodsCap}`}; услуги: ${tier.servicesCap >= 99 ? "без ограничений" : tier.servicesCap > 0 ? `до ${tier.servicesCap}` : "недоступны"}.`
        : "Заполненность не ограничивает товары и услуги."
    };
  }

  static forEntry(tavern, category, entry) {
    const normalizedCategory = TavernMigrations.categoryToInventoryKey(category) ?? category;
    if (!entry || !AFFECTED_CATEGORIES.has(normalizedCategory)) return this.#unrestricted(entry);

    // Embedded availability is a public snapshot. Never let it override the live GM atmosphere.
    const embedded = tavern?.atmosphere ? null : entry.crowdAvailability;
    if (embedded && typeof embedded === "object") {
      const embeddedMax = Math.max(0, Math.trunc(Number(embedded.maxPurchaseQuantity ?? 0) || 0));
      const actualMax = entry.unlimited ? embeddedMax : Math.min(embeddedMax, Math.max(0, Math.trunc(Number(entry.stock ?? 0) || 0)));
      return {
        maxPurchaseQuantity: actualMax,
        disabled: actualMax <= 0 || Boolean(embedded.disabled),
        limited: Boolean(embedded.limited),
        stockLabel: actualMax <= 0 ? "временно недоступно" : String(embedded.stockLabel ?? actualMax),
        note: String(embedded.note ?? ""),
        profile: null
      };
    }

    const profile = this.profile(tavern);
    if (entry.unlimited) {
      const cap = normalizedCategory === "services" ? profile.servicesCap : profile.goodsCap;
      const used = this.#usage(tavern, normalizedCategory, entry.id);
      const remaining = Math.max(0, cap >= 99 ? 99 : cap - used);
      const disabled = remaining <= 0;
      const limited = cap < 99;

      return {
        maxPurchaseQuantity: remaining,
        disabled,
        limited,
        stockLabel: disabled ? "временно недоступно" : limited ? `до ${remaining}` : "без ограничения",
        note: disabled ? "Персонал и доступные запасы заняты другими посетителями." : limited ? "Количество ограничено текущей заполненностью таверны." : "",
        profile
      };
    }

    const stock = Math.max(0, Math.trunc(Number(entry.stock ?? 0) || 0));
    const maxStock = Math.max(stock, Math.trunc(Number(entry.maxStock ?? stock) || stock));
    const reserved = Math.min(stock, Math.ceil(maxStock * profile.reserveRate));
    const available = Math.max(0, stock - reserved);
    const limited = available < stock;

    return {
      maxPurchaseQuantity: available,
      disabled: available <= 0,
      limited,
      stockLabel: String(available),
      note: limited ? "Часть запаса уже предназначена посетителям в зале." : "",
      profile
    };
  }


  static clearEmbeddedAvailability(tavern) {
    const clone = TavernMigrations.migrate(tavern);
    if (!clone) return null;

    for (const category of AFFECTED_CATEGORIES) {
      for (const entry of clone.inventory?.[category] ?? []) {
        delete entry.crowdAvailability;
      }
    }

    return clone;
  }

  static embedPublicAvailability(tavern) {
    const clone = TavernMigrations.migrate(tavern);
    if (!clone) return null;

    for (const category of AFFECTED_CATEGORIES) {
      for (const entry of clone.inventory?.[category] ?? []) {
        const availability = this.forEntry(clone, category, entry);
        entry.crowdAvailability = {
          maxPurchaseQuantity: availability.maxPurchaseQuantity,
          disabled: availability.disabled,
          limited: availability.limited,
          stockLabel: availability.stockLabel,
          note: availability.note
        };
      }
    }

    return clone;
  }

  static recordPurchase(tavern, category, entry, quantity = 1) {
    const normalizedCategory = TavernMigrations.categoryToInventoryKey(category) ?? category;
    if (!entry || !AFFECTED_CATEGORIES.has(normalizedCategory)) return tavern;

    const count = Math.max(1, Math.trunc(Number(quantity) || 1));
    if (entry.crowdAvailability && typeof entry.crowdAvailability === "object") {
      const remaining = Math.max(0, Math.trunc(Number(entry.crowdAvailability.maxPurchaseQuantity ?? 0) || 0) - count);
      entry.crowdAvailability.maxPurchaseQuantity = remaining;
      entry.crowdAvailability.disabled = remaining <= 0;
      entry.crowdAvailability.stockLabel = remaining <= 0 ? "временно недоступно" : entry.unlimited ? `до ${remaining}` : String(remaining);
      return tavern;
    }

    if (!tavern?.atmosphere || !entry.unlimited) return tavern;
    tavern.atmosphere.availabilityUsage ??= {};
    const key = this.usageKey(normalizedCategory, entry.id);
    tavern.atmosphere.availabilityUsage[key] = Math.max(0, Math.trunc(Number(tavern.atmosphere.availabilityUsage[key] ?? 0) || 0)) + count;
    return tavern;
  }

  static resetUsage(tavern) {
    if (tavern?.atmosphere) tavern.atmosphere.availabilityUsage = {};
    return tavern;
  }

  static usageKey(category, entryId) {
    return `${String(category ?? "")}:${String(entryId ?? "")}`;
  }

  static #usage(tavern, category, entryId) {
    const key = this.usageKey(category, entryId);
    return Math.max(0, Math.trunc(Number(tavern?.atmosphere?.availabilityUsage?.[key] ?? 0) || 0));
  }

  static #crowd(tavern) {
    return Math.max(0, Math.min(100, Math.trunc(Number(tavern?.atmosphere?.crowd ?? tavern?.atmosphere?.mood?.crowd ?? 0) || 0)));
  }

  static #unrestricted(entry) {
    const unlimited = Boolean(entry?.unlimited);
    const stock = unlimited ? 99 : Math.max(0, Math.trunc(Number(entry?.stock ?? 0) || 0));
    return {
      maxPurchaseQuantity: stock,
      disabled: stock <= 0,
      limited: false,
      stockLabel: unlimited ? "без ограничения" : String(stock),
      note: "",
      profile: null
    };
  }
}
