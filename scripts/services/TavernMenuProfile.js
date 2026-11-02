// Preferences change selection, never the price or the catalogue's hard filters.
const PREFERENCES = {
  poor:   { basic: 3, standard: 1, premium: 0.2 },
  modest: { basic: 1.6, standard: 1.4, premium: 0.6 },
  good:   { basic: 0.8, standard: 1.6, premium: 1.6 },
  fine:   { basic: 0.4, standard: 1.2, premium: 3 }
};

export class TavernMenuProfile {
  static tier(entry) {
    if (["basic", "standard", "premium"].includes(entry.menuTier)) return entry.menuTier;
    // Use the unmodified catalogue price so country, terrain and the GM's markup
    // cannot change the menu tier. Drinks have a cheaper scale than meals.
    const midpoint = (Number(entry.min) + Number(entry.max)) / 2;
    const [basic, standard] = entry.type === "drink" ? [3, 7] : [5, 12];
    return midpoint <= basic ? "basic" : midpoint <= standard ? "standard" : "premium";
  }

  static weight(entry, quality) {
    const profile = PREFERENCES[quality] ?? PREFERENCES.modest;
    return (entry.weight ?? 1) * profile[this.tier(entry)];
  }
}
