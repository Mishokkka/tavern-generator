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
    // Terrain phrases already contain their own case/adjective and are not interchangeable nouns.
    const nouns = table.nouns ?? [];
    const adjectives = table.adjectives ?? NAME_TABLE.common.adjectives;
    const fallbackNouns = NAME_TABLE.common.nouns ?? [];
    const pattern = this.#pick(patterns).replace(/^\{noun\} у дороги$/, "Трактир у {noun}");
    const noun = this.#pick(nouns.length ? nouns : fallbackNouns);
    let adjective = this.#pick(adjectives);
    if (region === "lezhnizem") {
      if (["чаши", "бочки", "свечи"].includes(noun)) adjective = adjective.replace(/княжьего$/, "княжьей").replace(/(?:ого|аго)$/, "ой").replace(/его$/, "ей");
      if (noun === "рукавиц") adjective = adjective.replace(/княжьего$/, "княжьих").replace(/(?:ого|аго)$/, "ых").replace(/его$/, "их");
    }

    return pattern.replace(/\{(adj|noun|terrain)\}/g, (_match, token) => {
      if (token === "adj") return adjective;
      if (token === "terrain") return this.#pick(terrainWords.length ? terrainWords : nouns.length ? nouns : fallbackNouns);
      // Repeated noun tokens ("X and Y") must remain independent.
      return pattern.includes("{adj}") ? noun : this.#pick(nouns.length ? nouns : fallbackNouns);
    });
  }

  static #pick(items) {
    return items[Math.floor(Math.random() * items.length)];
  }
}
