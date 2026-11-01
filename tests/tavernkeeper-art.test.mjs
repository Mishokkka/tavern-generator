import "./test-env.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { TavernkeeperArt } from "../scripts/services/TavernkeeperArt.js";
import { CharacterForgeAdapter } from "../scripts/services/CharacterForgeAdapter.js";
import { TavernSceneService } from "../scripts/services/TavernSceneService.js";
import { TavernGenerationPlan } from "../scripts/services/TavernGenerationPlan.js";

const folder = "art/Male/Novand/tavern";
const portrait = `${folder}/1.webp`;
const pairedToken = `${folder}/1T.webp`;
const foreignToken = `${folder}/2T.webp`;

function fixture(t, { files = [portrait, pairedToken, foreignToken], set = {}, registry = {} } = {}) {
  const previousPicker = globalThis.FilePicker;
  const previousUser = game.user;
  game.user = { isGM: true };
  globalThis.FilePicker = { browse: async () => ({ files }) };
  t.after(() => { globalThis.FilePicker = previousPicker; game.user = previousUser; });
  const actor = {
    id: "keeper", uuid: "Actor.keeper", name: "Тавернщик", img: portrait, flags: {},
    prototypeToken: { texture: { src: foreignToken }, randomImg: false, width: 1, height: 1 },
    async update(patch) { for (const [key, value] of Object.entries(patch)) foundry.utils.setProperty(this, key, value); },
    async setFlag(moduleId, key, value) { foundry.utils.setProperty(this, `flags.${moduleId}.${key}`, value); },
    getFlag(moduleId, key) { return this.flags[moduleId]?.[key]; }
  };
  actor.prototypeToken.toObject = () => ({ texture: { ...actor.prototypeToken.texture }, randomImg: actor.prototypeToken.randomImg, width: 1, height: 1 });
  const result = { actor, artSetKey: "humans", art: { portrait, token: foreignToken, artSubsetKey: "tavern" } };
  const api = {
    getArtSets: () => ({ humans: { pairByName: true, sameFolderTokenSuffix: true, tokenSuffixes: ["T"], ...set } }),
    exportAssetRegistry: () => registry
  };
  return { actor, result, api };
}

test("token pairs respect IDs, naming patterns, encoding and culture folder", () => {
  assert.equal(TavernkeeperArt.matches(portrait, pairedToken), true);
  assert.equal(TavernkeeperArt.matches(portrait, foreignToken), false);
  assert.equal(TavernkeeperArt.matches(`${folder}/11.webp`, pairedToken), false);
  assert.equal(TavernkeeperArt.matches(portrait, "art/Female/Novand/tavern/1T.webp", { sameFolder: true }), false);
  assert.equal(TavernkeeperArt.matches(`${folder}/John%20Smith_portrait.png`, `${folder}/token_John Smith.webp`), true);
  assert.equal(TavernkeeperArt.matches(`${folder}/42.webp`, `${folder}/unit[42].png`, { patterns: ["unit[{id}]"] }), true);
  assert.equal(TavernkeeperArt.matches(`${folder}/42.webp`, `${folder}/42-mini.png`, { suffixes: ["-mini"] }), true);
});

test("Forge's unrelated random token is replaced with the portrait's actual pair", async (t) => {
  const { actor, result, api } = fixture(t);
  await TavernkeeperArt.synchronize(result, api);
  assert.equal(actor.prototypeToken.texture.src, pairedToken);
  assert.equal(result.art.token, pairedToken);
  assert.equal(actor.getFlag("fbl-character-forge", "token"), pairedToken);
});

test("a valid custom pairing and independent art sets remain valid", async (t) => {
  const { actor, result, api } = fixture(t, { set: { pairByName: false } });
  actor.prototypeToken.texture.src = "stale.webp";
  await TavernkeeperArt.synchronize(result, api);
  assert.equal(actor.prototypeToken.texture.src, foreignToken);
  assert.equal(result.art.token, foreignToken);
});

test("missing or occupied pairs use the same character portrait, never another NPC", async (t) => {
  for (const config of [
    { files: [portrait, foreignToken, `${folder}/1T.txt`] },
    { registry: { humans: { assets: { [pairedToken]: { actorId: "another-actor" } } } } }
  ]) {
    const { actor, result, api } = fixture(t, config);
    await TavernkeeperArt.synchronize(result, api);
    assert.equal(actor.prototypeToken.texture.src, portrait);
    assert.equal(result.art.token, portrait);
  }
});

test("failed folder browsing still avoids a foreign token", async (t) => {
  const { actor, result, api } = fixture(t);
  delete globalThis.FilePicker;
  await TavernkeeperArt.synchronize(result, api);
  assert.equal(actor.prototypeToken.texture.src, portrait);
});

test("a valid paired token is retained and wildcard selection is disabled", async (t) => {
  const { actor, result, api } = fixture(t);
  actor.prototypeToken.randomImg = true;
  result.art.token = pairedToken;
  await TavernkeeperArt.synchronize(result, api);
  assert.equal(actor.prototypeToken.texture.src, pairedToken);
  assert.equal(actor.prototypeToken.randomImg, false);
});

test("a stale Forge flag is synchronized even if the prototype already has the correct token", async (t) => {
  const { actor, result, api } = fixture(t);
  actor.prototypeToken.texture.src = pairedToken;
  actor.flags["fbl-character-forge"] = { token: foreignToken };
  result.art.token = pairedToken;
  await TavernkeeperArt.synchronize(result, api);
  assert.equal(actor.getFlag("fbl-character-forge", "token"), pairedToken);
});

test("culture and gender branches keep their custom token naming rules", async (t) => {
  const token = `${folder}/mini[1].webp`;
  const { actor, result, api } = fixture(t, { files: [portrait, token, foreignToken], set: {
    folders: { male: { novand: { folder, tokenNamePatterns: ["mini[{id}]"] } } }
  } });
  result.art.gender = "male"; result.art.cultureKey = "novand";
  await TavernkeeperArt.synchronize(result, api);
  assert.equal(actor.prototypeToken.texture.src, token);
});

test("explicit refresh repairs an existing keeper and its archive without changing identity", async (t) => {
  const { actor, api } = fixture(t);
  const oldActors = game.actors; const oldApi = game.fblCharacterForge;
  const oldArchive = CharacterForgeAdapter.archiveActor;
  t.after(() => { game.actors = oldActors; game.fblCharacterForge = oldApi; CharacterForgeAdapter.archiveActor = oldArchive; });
  actor.flags["fbl-character-forge"] = { artSet: "humans" };
  game.actors = new Map([[actor.id, actor]]); game.fblCharacterForge = api;
  let archived;
  CharacterForgeAdapter.archiveActor = async (actor) => { archived = actor.prototypeToken.texture.src; return { pack: "world.keepers", id: "archive" }; };
  const tavern = { id: "tavern", name: "У моста", tavernkeeper: { actorId: actor.id, tokenImg: foreignToken, createdAt: 123, compendium: { id: "archive", pack: "world.keepers" } } };
  const meta = await CharacterForgeAdapter.refreshTavernkeeperArt(tavern);
  assert.equal(meta.actorId, actor.id);
  assert.equal(meta.createdAt, 123);
  assert.equal(meta.token, pairedToken);
  assert.equal(meta.tokenImg, pairedToken);
  assert.equal(archived, pairedToken);
});

test("tavernkeeper art is corrected before archiving and persisted in both metadata fields", async (t) => {
  const { actor, result, api } = fixture(t);
  const oldApi = game.fblCharacterForge;
  const oldModule = game.modules.get("fbl-character-forge");
  const archive = CharacterForgeAdapter.archiveActor;
  t.after(() => {
    game.fblCharacterForge = oldApi;
    if (oldModule) game.modules.set("fbl-character-forge", oldModule); else game.modules.delete("fbl-character-forge");
    CharacterForgeAdapter.archiveActor = archive;
  });
  game.modules.set("fbl-character-forge", { active: true });
  let requested;
  game.fblCharacterForge = { ...api, getNameSets: () => ({ novand: { label: "Нованд" } }), createActor: async (options) => { requested = options; return result; } };
  let archivedImage;
  CharacterForgeAdapter.archiveActor = async (created) => { archivedImage = created.prototypeToken.texture.src; return { pack: "world.keepers", id: "archived" }; };
  const meta = await CharacterForgeAdapter.createTavernkeeper({ id: "tavern", region: "novandia", name: "У моста" });
  assert.equal(requested.artSubsetKey, "tavern");
  assert.equal(requested.openSheet, false);
  assert.equal(archivedImage, pairedToken);
  assert.equal(meta.token, pairedToken);
  assert.equal(meta.tokenImg, pairedToken);
  assert.equal(meta.artSet, "humans");
  assert.equal(meta.actorId, actor.id);
});

test("scene placement takes the corrected Actor token, updates in place and removes duplicates", async (t) => {
  const { actor, result, api } = fixture(t);
  await TavernkeeperArt.synchronize(result, api);
  const oldActors = game.actors;
  const oldMerge = foundry.utils.mergeObject;
  game.actors = new Map([[actor.id, actor]]);
  foundry.utils.mergeObject = (base, patch) => ({ ...structuredClone(base), ...patch });
  t.after(() => { game.actors = oldActors; foundry.utils.mergeObject = oldMerge; });
  const scene = {
    width: 1200, height: 800, grid: { size: 100 }, tokens: { contents: [] },
    async createEmbeddedDocuments(type, data) {
      assert.equal(type, "Token");
      const created = data.map((entry) => ({ id: "scene-token", ...entry }));
      this.tokens.contents.push(...created); return created;
    },
    async deleteEmbeddedDocuments(type, ids) { this.tokens.contents = this.tokens.contents.filter((entry) => !ids.includes(entry.id)); },
    async updateEmbeddedDocuments(type, data) {
      const entry = this.tokens.contents.find((entry) => entry.id === data[0]._id);
      Object.assign(entry, data[0]); return [entry];
    }
  };
  const tavern = { id: "tavern", name: "У моста", tavernkeeper: { actorId: actor.id, tokenImg: foreignToken } };
  const placed = await TavernSceneService.placeTavernkeeperToken(scene, tavern);
  assert.equal(placed.texture.src, pairedToken);
  assert.equal(placed.actorId, actor.id);
  placed.x = 200; placed.y = 300;
  scene.tokens.contents.push({ ...placed, id: "duplicate" });
  const updated = await TavernSceneService.placeTavernkeeperToken(scene, tavern);
  assert.equal(updated.id, placed.id);
  assert.equal(scene.tokens.contents.length, 1);
  assert.deepEqual([updated.x, updated.y], [200, 300]);
});

test("generation explanation uses current modifiers without generating random content", () => {
  const originalRandom = Math.random;
  try {
    Math.random = () => { throw new Error("Preview must not roll"); };
    const small = TavernGenerationPlan.describe({ size: "tiny", quality: "poor" });
    const large = TavernGenerationPlan.describe({ size: "large", quality: "fine", terrain: "port", priceMultiplier: 1.5 });
    assert.match(small.menu, /3.*1/);
    assert.match(large.menu, /11.*5/);
    assert.match(large.prices, /2,1.*1,25.*1,5/);
    assert.match(large.markup, /150%/);
  } finally { Math.random = originalRandom; }
});
