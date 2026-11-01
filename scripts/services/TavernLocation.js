/** Free-form settlement metadata shared by generation, editing and library grouping. */
export class TavernLocation {
  static normalizeCity(value) {
    return typeof value === "string" ? value.normalize("NFC").trim().replace(/\s+/g, " ").slice(0, 120) : "";
  }

  static cityKey(value) {
    return this.normalizeCity(value).toLocaleLowerCase("ru").replace(/ё/g, "е");
  }
}
