import { TAVERN_OPTIONS } from "../data/index.js";

/** Bounded pages keep large libraries out of the DOM. No changes to stored data. */
export function prepareTavernLibrary(taverns, filters = {}, currentId = null) {
  const normalize = (value) => String(value ?? "").toLocaleLowerCase("ru").replace(/ё/g, "е");
  const words = normalize(filters.query).trim().split(/\s+/).filter(Boolean);
  const rows = taverns.map((tavern) => ({
    id: tavern.id,
    name: tavern.name || "Без названия",
    region: tavern.region,
    regionLabel: tavern.labels?.region || TAVERN_OPTIONS.regions[tavern.region] || tavern.region,
    terrainLabel: tavern.labels?.terrain || TAVERN_OPTIONS.terrains[tavern.terrain] || tavern.terrain,
    qualityLabel: tavern.labels?.quality || TAVERN_OPTIONS.qualities[tavern.quality] || tavern.quality,
    sizeLabel: tavern.labels?.size || TAVERN_OPTIONS.sizes[tavern.size] || tavern.size,
    active: tavern.id === currentId,
    updated: Number(tavern.updatedAt || tavern.savedAt || 0),
    sceneName: tavern.scene?.name || "",
    foodCount: tavern.inventory?.food?.length ?? 0,
    drinkCount: tavern.inventory?.drinks?.length ?? 0,
    roomCount: tavern.inventory?.lodging?.length ?? 0,
    serviceCount: tavern.inventory?.services?.length ?? 0
  })).filter((row) => (!filters.region || row.region === filters.region)
    && (filters.status !== "active" || row.active)
    && words.every((word) => normalize(`${row.name} ${row.regionLabel} ${row.terrainLabel} ${row.sceneName}`).includes(word)));
  const nameOrder = (a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }) || String(a.id).localeCompare(String(b.id));
  rows.sort(filters.sort === "name" ? nameOrder
    : filters.sort === "region" ? (a, b) => a.regionLabel.localeCompare(b.regionLabel, "ru") || nameOrder(a, b)
      : (a, b) => b.updated - a.updated || nameOrder(a, b));
  const pageSize = 20;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const requestedPage = Number(filters.page);
  const page = Math.min(pages, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));
  return {
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: taverns.length, matched: rows.length, page, pages, multiplePages: pages > 1,
    start: rows.length ? (page - 1) * pageSize + 1 : 0,
    end: Math.min(page * pageSize, rows.length),
    previousDisabled: page === 1, nextDisabled: page === pages,
    emptyLibrary: taverns.length === 0
  };
}
