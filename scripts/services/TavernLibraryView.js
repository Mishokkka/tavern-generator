import { TAVERN_OPTIONS } from "../data/index.js";
import { TavernLocation } from "./TavernLocation.js";

/** Bounded pages keep large libraries out of the DOM. No changes to stored data. */
export function prepareTavernLibrary(taverns, filters = {}) {
  const normalize = (value) => String(value ?? "").normalize("NFC").toLocaleLowerCase("ru").replace(/ё/g, "е");
  const words = normalize(filters.query).trim().split(/\s+/).filter(Boolean);
  const candidates = taverns.map((tavern) => ({
    id: tavern.id,
    name: tavern.name || "Без названия",
    region: tavern.region,
    regionLabel: TAVERN_OPTIONS.regions[tavern.region] || tavern.labels?.region || tavern.region || "Без региона",
    city: TavernLocation.normalizeCity(tavern.city),
    cityKey: TavernLocation.cityKey(tavern.city),
    terrainLabel: tavern.labels?.terrain || TAVERN_OPTIONS.terrains[tavern.terrain] || tavern.terrain,
    qualityLabel: tavern.labels?.quality || TAVERN_OPTIONS.qualities[tavern.quality] || tavern.quality,
    sizeLabel: tavern.labels?.size || TAVERN_OPTIONS.sizes[tavern.size] || tavern.size,
    updated: Number(tavern.updatedAt || tavern.savedAt || 0),
    sceneName: tavern.scene?.name || "",
    foodCount: tavern.inventory?.food?.length ?? 0,
    drinkCount: tavern.inventory?.drinks?.length ?? 0,
    roomCount: tavern.inventory?.lodging?.length ?? 0,
    serviceCount: tavern.inventory?.services?.length ?? 0
  }));
  const cityValue = row => JSON.stringify([row.cityKey]);
  const choices = new Map();
  for (const row of candidates) {
    if (filters.region && row.region !== filters.region) continue;
    if (!choices.has(cityValue(row))) choices.set(cityValue(row), { value: cityValue(row), label: row.city || "Без города", empty: !row.cityKey });
  }
  const cityFilter = choices.has(filters.city) ? filters.city : "";
  const cityChoices = [...choices.values()].sort((a, b) => Number(a.empty) - Number(b.empty) || a.label.localeCompare(b.label, "ru", { numeric: true }))
    .map(choice => ({ ...choice, selected: choice.value === cityFilter }));
  const rows = candidates.filter((row) => (!filters.region || row.region === filters.region)
    && (!cityFilter || cityValue(row) === cityFilter)
    && words.every((word) => normalize(`${row.name} ${row.regionLabel} ${row.city} ${row.terrainLabel} ${row.sceneName}`).includes(word)));
  const nameOrder = (a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }) || String(a.id).localeCompare(String(b.id));
  const withinCity = filters.sort === "name" || filters.sort === "region" ? nameOrder
    : (a, b) => b.updated - a.updated || nameOrder(a, b);
  // Group the complete result before slicing pages, so one city cannot be scattered
  // between other cities. Large groups may continue on the next bounded page.
  rows.sort((a, b) => a.regionLabel.localeCompare(b.regionLabel, "ru")
    || String(a.region).localeCompare(String(b.region))
    || Number(!a.cityKey) - Number(!b.cityKey)
    || a.cityKey.localeCompare(b.cityKey, "ru", { numeric: true })
    || withinCity(a, b));
  const pageSize = 20;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const requestedPage = Number(filters.page);
  const page = Math.min(pages, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));
  const offset = (page - 1) * pageSize;
  const pageRows = rows.slice(offset, offset + pageSize);
  const key = row => JSON.stringify(["city", row.region ?? "", row.cityKey]);
  const cityStats = new Map();
  const regionCounts = new Map();
  rows.forEach((row, index) => {
    const groupKey = key(row);
    if (!cityStats.has(groupKey)) cityStats.set(groupKey, { name: row.city || "Без города", total: 0, first: index });
    cityStats.get(groupKey).total += 1;
    regionCounts.set(row.region, (regionCounts.get(row.region) ?? 0) + 1);
  });
  const regions = new Map();
  for (const row of pageRows) {
    if (!regions.has(row.region)) regions.set(row.region, { key: JSON.stringify(["region", row.region ?? ""]), label: row.regionLabel, total: regionCounts.get(row.region), cities: new Map() });
    const cities = regions.get(row.region).cities;
    if (!cities.has(row.cityKey)) {
      const stats = cityStats.get(key(row));
      cities.set(row.cityKey, { key: key(row), name: stats.name, total: stats.total, continued: stats.first < offset, rows: [] });
    }
    cities.get(row.cityKey).rows.push(row);
  }
  return {
    rows: pageRows,
    cityChoices,
    cityFilter,
    regionGroups: [...regions.values()].map(region => ({ ...region, cities: [...region.cities.values()] })),
    total: taverns.length, matched: rows.length, page, pages, multiplePages: pages > 1,
    start: rows.length ? (page - 1) * pageSize + 1 : 0,
    end: Math.min(page * pageSize, rows.length),
    previousDisabled: page === 1, nextDisabled: page === pages,
    emptyLibrary: taverns.length === 0
  };
}
