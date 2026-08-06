import { NAME_TABLE } from "../data/index.js";

export class TavernNames {
  static generate(region, terrain) {
    const table = NAME_TABLE[region] ?? NAME_TABLE.common;
    const fixedNames = table.fixedNames ?? [];

    // Curated names handle grammar and local language flavor better than fully procedural pieces.
    // The procedural branch remains useful for extra variation.
    if (fixedNames.length && Math.random() < 0.25) {
      return this.#pick(fixedNames);
    }

    const patterns = table.patterns ?? NAME_TABLE.common.patterns;
    const terrainWords = table.terrain?.[terrain] ?? [];
    const nouns = [...(table.nouns ?? []), ...terrainWords];
    const adjectives = table.adjectives ?? NAME_TABLE.common.adjectives;
    const fallbackNouns = NAME_TABLE.common.nouns ?? [];
    const pattern = this.#pick(patterns);

    return pattern.replace(/\{(adj|noun|terrain)\}/g, (_match, token) => {
      if (token === "adj") return this.#pick(adjectives);
      if (token === "terrain") return this.#pick(terrainWords.length ? terrainWords : nouns.length ? nouns : fallbackNouns);
      return this.#pick(nouns.length ? nouns : fallbackNouns);
    });
  }

  static #pick(items) {
    return items[Math.floor(Math.random() * items.length)];
  }
}
