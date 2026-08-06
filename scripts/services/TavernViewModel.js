import { TavernPricing } from "./TavernPricing.js";
import { MoneyFormatter } from "./MoneyFormatter.js";
import { TavernMigrations } from "./TavernMigrations.js";
import { TavernAtmosphereService } from "./TavernAtmosphereService.js";
import { TavernAvailabilityService } from "./TavernAvailabilityService.js";

export class TavernViewModel {
  static decorate(tavern) {
    const publicOnly = !tavern?.atmosphere && ["food", "drinks", "services"].some((key) =>
      (tavern?.inventory?.[key] ?? []).some((entry) => entry?.crowdAvailability)
    );
    const migrated = publicOnly ? TavernMigrations.migrate(tavern) : TavernAtmosphereService.ensure(tavern);
    if (!migrated) return migrated;

    const decorate = (entry, category) => {
      const effectivePrice = TavernPricing.effectiveEntryPrice(entry, migrated, { category });
      const rawPrice = Math.max(1, Number(entry.price ?? entry.basePrice ?? 1));
      const seasonalChanged = effectivePrice !== rawPrice;
      const availability = TavernAvailabilityService.forEntry(migrated, category, entry);
      return {
        ...entry,
        price: effectivePrice,
        rawPrice,
        seasonalChanged,
        priceLabel: MoneyFormatter.format(effectivePrice),
        priceParts: MoneyFormatter.partsFromCopper(effectivePrice),
        stockLabel: availability.stockLabel,
        availabilityNote: availability.note,
        crowdLimited: availability.limited,
        disabled: availability.disabled,
        maxPurchaseQuantity: availability.maxPurchaseQuantity,
        purchaseDefaultQuantity: 1,
        totalPriceLabel: MoneyFormatter.format(effectivePrice),
        totalPriceParts: MoneyFormatter.partsFromCopper(effectivePrice)
      };
    };

    const inventory = migrated.inventory ?? { food: [], drinks: [], lodging: [], services: [] };
    const food = (inventory.food ?? []).map((entry) => decorate(entry, "food"));
    const drinks = (inventory.drinks ?? []).map((entry) => decorate(entry, "drinks"));
    const lodging = (inventory.lodging ?? []).map((room) => {
      const decorated = decorate(room, "lodging");
      const stock = Number(room.stock ?? 0);
      const total = Number(room.total ?? 0);

      return {
        ...decorated,
        free: room.unlimited ? null : Math.max(0, stock),
        freeLabel: room.unlimited ? "без ограничения" : `${Math.max(0, stock)} / ${Math.max(0, total)}`,
        occupied: room.unlimited ? 0 : Math.max(0, Number(room.occupied ?? Math.max(0, total - stock))),
        maxPurchaseQuantity: room.unlimited ? 99 : Math.max(0, stock),
        purchaseDefaultDays: 1
      };
    });
    const services = (inventory.services ?? []).map((entry) => decorate(entry, "services"));

    return {
      ...migrated,
      priceMultiplier: TavernPricing.normalizeMultiplier(migrated.priceMultiplier ?? 1),
      priceMultiplierPercent: Math.round(TavernPricing.normalizeMultiplier(migrated.priceMultiplier ?? 1) * 100),
      publicSummary: migrated.publicSummary ?? "Доступные позиции указаны ниже.",
      summary: migrated.summary ?? this.summary(migrated),
      inventory: { food, drinks, lodging, services },
      food,
      drinks,
      menu: [...food, ...drinks],
      lodging,
      services,
      lodgingBookings: migrated.lodgingBookings ?? []
    };
  }

  static summary(tavern) {
    const inventory = tavern?.inventory ?? { food: [], drinks: [], lodging: [] };
    const food = (inventory.food ?? []).length;
    const drinks = (inventory.drinks ?? []).length;
    const beds = (inventory.lodging ?? []).reduce((sum, room) => sum + (room.unlimited ? 0 : Number(room.stock ?? 0)), 0);
    const open = (inventory.lodging ?? []).some((room) => room.unlimited) ? ", есть места без ограничения" : "";
    return `${tavern.labels?.quality ?? "Таверна"}, ${String(tavern.labels?.size ?? "").toLowerCase()}, ${String(tavern.labels?.terrain ?? "").toLowerCase()}. Еда: ${food}, напитки: ${drinks}, свободных мест: ${beds}${open}.`;
  }
}
