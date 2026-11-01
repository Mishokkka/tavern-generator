const FORGE_ID = "fbl-character-forge";
const DEFAULT_PATTERNS = ["{id}T", "T{id}", "T {id}", "T-{id}", "T_{id}", "token-{id}", "token_{id}", "token {id}", "{id}-token", "{id}_token", "{id} token", "processed- {id}", "processed-{id}"];

const decode = (value) => { try { return decodeURIComponent(value); } catch { return value; } };
const normalize = (value) => decode(String(value ?? "")).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().toLocaleLowerCase();
const directory = (path) => String(path ?? "").replace(/\\/g, "/").split("/").slice(0, -1).join("/");
const stem = (path) => decode(String(path ?? "").split(/[?#]/)[0].replace(/\\/g, "/").split("/").pop() ?? "").replace(/\.[^.]+$/, "");
const list = (value) => Array.isArray(value) ? value.map(String) : typeof value === "string" ? value.split(/[\n,;]+/).map((part) => part.trim()).filter(Boolean) : [];
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Validate Forge's pair before its random-token fallback reaches the Actor archive. */
export class TavernkeeperArt {
  static matches(portrait, token, { suffixes = [], patterns = DEFAULT_PATTERNS, sameFolder = false } = {}) {
    if (!portrait || !token) return false;
    if (sameFolder && normalize(directory(portrait)) !== normalize(directory(token))) return false;
    const portraitId = normalize(stem(portrait).replace(/[-_\s]*(portrait|actor|avatar)$/i, ""));
    const tokenId = normalize(stem(token));
    if (portraitId === tokenId) return true;
    for (const suffix of suffixes) {
      const normalized = normalize(suffix);
      if (normalized && tokenId.endsWith(normalized) && normalize(tokenId.slice(0, -normalized.length)) === portraitId) return true;
    }
    for (const pattern of patterns) {
      if (!pattern.includes("{id}")) continue;
      const regex = new RegExp(`^${normalize(pattern).split("{id}").map(escapeRegex).join("(.+?)")}$`, "i");
      const match = regex.exec(tokenId);
      if (match && normalize(match[1]) === portraitId) return true;
    }
    return false;
  }

  static async synchronize(result, api) {
    const actor = result?.actor;
    const portrait = result?.art?.portrait;
    if (!actor || !portrait) return;
    const setKey = result.artSetKey ?? actor.getFlag?.(FORGE_ID, "artSet");
    const set = this.#contextSet(api.getArtSets?.()?.[setKey] ?? {}, result);
    const portraitFolder = set.portraitFolder || set.folder;
    const tokenFolder = set.tokenFolder || set.folder;
    let token = result.art.token || portrait;
    const rules = {
      suffixes: list(set.tokenSuffixes),
      patterns: [...new Set([...DEFAULT_PATTERNS, ...list(set.tokenNamePatterns), ...list(this.#setting("tokenNamePatterns"))])],
      sameFolder: Boolean(set.sameFolderTokenSuffix || (portraitFolder && tokenFolder && normalize(portraitFolder) === normalize(tokenFolder)))
    };
    const matchesToken = (path) => {
      const folder = normalize(String(set.tokenFolder ?? "").replace(/\/+$/, ""));
      const parent = normalize(directory(path));
      return this.matches(portrait, path, rules) && (!folder || parent === folder || parent.startsWith(`${folder}/`));
    };

    // Unpaired sets intentionally allow independent artwork; older APIs may not
    // expose their pairing configuration. Still synchronize the returned token.
    if (set.pairByName && !matchesToken(token)) {
      const candidates = new Set(list(set.tokenFiles ?? set.tokens));
      const folders = new Set([directory(portrait), directory(token), set.tokenFolder]);
      const FilePickerClass = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
      for (const folder of folders) {
        if (!folder || !FilePickerClass?.browse) continue;
        try {
          const result = await FilePickerClass.browse(set.source || "data", folder, set.bucket ? { bucket: set.bucket } : {});
          for (const path of result.files ?? []) candidates.add(path);
        } catch (error) {
          console.debug("fbl-tavern-generator | Could not check tavernkeeper art folder", error);
        }
      }
      const registry = api.exportAssetRegistry?.()?.[setKey]?.assets ?? {};
      token = [...candidates].find((path) => /\.(?:avif|gif|jpe?g|png|svg|webp|webm|mp4)(?:[?#].*)?$/i.test(path)
        && normalize(path) !== normalize(portrait) && matchesToken(path)
        && (!registry[path] || registry[path].actorId === actor.id)) || portrait;
      if (token === portrait) ui.notifications.warn("Для портрета тавернщика не найдена свободная пара токена. Для токена использован его портрет.");
    }

    const patch = {};
    if (actor.prototypeToken?.texture?.src !== token) patch["prototypeToken.texture.src"] = token;
    if (actor.prototypeToken?.randomImg) patch["prototypeToken.randomImg"] = false;
    const flagToken = actor.getFlag?.(FORGE_ID, "token") ?? actor.flags?.[FORGE_ID]?.token;
    if (flagToken !== token) patch[`flags.${FORGE_ID}.token`] = token;
    if (Object.keys(patch).length) {
      await actor.update(patch);
    }
    result.art.token = token;
  }

  static #setting(key) {
    try { return game.settings.get(FORGE_ID, key); } catch { return null; }
  }

  static #contextSet(base, result) {
    const culture = result.art?.cultureKey || result.nameDetails?.setKey || null;
    const gender = result.art?.gender || result.nameDetails?.gender || null;
    const branchFor = (genderKey, cultureKey) => {
      const candidates = [];
      if (genderKey && cultureKey) candidates.push(base.folders?.[genderKey]?.[cultureKey], base.folders?.[cultureKey]?.[genderKey],
        base.cultures?.[cultureKey]?.[genderKey], base.byCulture?.[cultureKey]?.[genderKey], base.byGenderCulture?.[genderKey]?.[cultureKey],
        base.byGender?.[genderKey]?.[cultureKey], base[genderKey]?.[cultureKey]);
      if (cultureKey) for (const entry of [base.folders?.[cultureKey], base.cultures?.[cultureKey], base.byCulture?.[cultureKey], base[cultureKey]]) {
        candidates.push(entry?.default, entry?.folder);
      }
      if (genderKey) for (const entry of [base.folders?.[genderKey], base.byGender?.[genderKey], base[genderKey]]) candidates.push(entry?.default, entry?.folder);
      if (genderKey) candidates.push(base[genderKey]);
      candidates.push(base.default);
      for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate) return { folder: candidate };
        if (Array.isArray(candidate)) return { portraitFiles: candidate };
        if (candidate && ["folder", "portraitFolder", "tokenFolder", "portraitFiles", "tokenFiles", "portraits", "tokens"].some((key) => candidate[key])) return candidate;
      }
      return null;
    };
    return { ...base, ...(branchFor(gender, culture) || branchFor("neutral", culture) || branchFor(gender, null) || branchFor(null, culture) || {}) };
  }
}
