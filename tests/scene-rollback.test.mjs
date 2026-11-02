import "./test-env.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { TavernSceneService } from "../scripts/services/TavernSceneService.js";

function sceneFixture(t, { existing = false, fallback = false } = {}) {
  const previous = { user: game.user, scenes: game.scenes, packs: game.packs, folders: game.folders, Scene: globalThis.Scene,
    place: TavernSceneService.placeTavernkeeperToken, archive: TavernSceneService.archiveScene };
  t.after(() => {
    game.user = previous.user; game.scenes = previous.scenes; game.packs = previous.packs; game.folders = previous.folders;
    globalThis.Scene = previous.Scene; TavernSceneService.placeTavernkeeperToken = previous.place;
    TavernSceneService.archiveScene = previous.archive;
  });
  game.user = { isGM: true };
  game.folders = null;
  const world = game.scenes = new Map(), deleted = [], imported = [];
  function scene(id) {
    return { id, uuid: `Scene.${id}`, name: "Таверна", views: 0,
      async view() { this.views++; },
      async delete() { deleted.push(id); world.delete(id); }
    };
  }
  const unrelated = scene("unrelated-scene"); world.set(unrelated.id, unrelated);
  const live = existing ? scene("linked-scene") : null;
  if (live) world.set(live.id, live);
  const tavern = { id: "rollback-tavern", tavernkeeper: { actorId: "keeper" },
    scene: { id: live?.id ?? "missing-scene", compendium: { pack: "world.scene-rollback", id: "archived-scene" } } };
  const archiveData = { _id: "archived-scene", name: "Таверна", flags: { "fbl-tavern-generator": { tavernId: tavern.id } } };
  const pack = { getDocument: async () => ({
    getFlag: (module, key) => archiveData.flags[module]?.[key], toObject: () => structuredClone(archiveData)
  }) };
  game.packs = new Map([[tavern.scene.compendium.pack, pack]]);
  const create = () => { const created = scene(`imported-${imported.length + 1}`); imported.push(created); world.set(created.id, created); return created; };
  if (fallback) globalThis.Scene = { create: async () => create() };
  else world.importFromCompendium = async (actualPack, id, _data, options) => {
    assert.equal(actualPack, pack); assert.equal(id, "archived-scene"); assert.equal(options.keepId, false); return create();
  };
  return { tavern, world, live, unrelated, deleted, imported };
}

test("PR review: a missing token discards only the scene imported for that attempt, including on retry", async t => {
  const f = sceneFixture(t), before = structuredClone(f.tavern.scene);
  TavernSceneService.placeTavernkeeperToken = async () => null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    assert.equal(await TavernSceneService.placeTavernkeeperOnLinkedScene(f.tavern, { archiveScene: false }), null);
    assert.equal(f.deleted.length, attempt);
    assert.equal(f.world.size, 1);
    assert.equal(f.world.get(f.unrelated.id), f.unrelated);
    assert.deepEqual(f.tavern.scene, before);
  }
});

for (const existing of [false, true]) for (const stage of ["archive", "flag"]) test(`archive rollback: ${stage} failure preserves metadata and ${existing ? "existing" : "imported"} scene ownership`, async t => {
  const f = sceneFixture(t, { existing }), before = structuredClone(f.tavern.scene), error = new Error(`${stage}-failed`);
  TavernSceneService.placeTavernkeeperToken = async scene => {
    scene.setFlag = async () => { if (stage === "flag") throw error; };
    return { id: "placed-token" };
  };
  TavernSceneService.archiveScene = async () => { if (stage === "archive") throw error; return { pack: "world.scene-rollback", id: "updated-archive" }; };
  for (let attempt = 1; attempt <= 2; attempt++) {
    await assert.rejects(TavernSceneService.placeTavernkeeperOnLinkedScene(f.tavern), actual => actual === error);
    assert.deepEqual(f.tavern.scene, before);
    assert.equal(f.world.get(f.unrelated.id), f.unrelated);
    if (existing) { assert.equal(f.world.get(f.live.id), f.live); assert.deepEqual(f.deleted, []); }
    else { assert.equal(f.world.size, 1); assert.equal(f.deleted.length, attempt); }
  }
});

test("PR review: a thrown placement error discards the temporary imported scene and preserves the error", async t => {
  const f = sceneFixture(t), error = new Error("token-create-failed"), before = structuredClone(f.tavern.scene);
  TavernSceneService.placeTavernkeeperToken = async () => { throw error; };
  await assert.rejects(TavernSceneService.placeTavernkeeperOnLinkedScene(f.tavern), actual => actual === error);
  assert.deepEqual(f.deleted, ["imported-1"]);
  assert.equal(f.world.size, 1);
  assert.equal(f.world.get(f.unrelated.id), f.unrelated);
  assert.deepEqual(f.tavern.scene, before);
});

for (const throws of [false, true]) test(`PR review: ${throws ? "throwing" : "empty"} token placement preserves an existing world scene`, async t => {
  const f = sceneFixture(t, { existing: true }), error = new Error("existing-placement-failed");
  TavernSceneService.placeTavernkeeperToken = async () => { if (throws) throw error; return null; };
  if (throws) await assert.rejects(TavernSceneService.placeTavernkeeperOnLinkedScene(f.tavern), actual => actual === error);
  else assert.equal(await TavernSceneService.placeTavernkeeperOnLinkedScene(f.tavern), null);
  assert.deepEqual(f.deleted, []);
  assert.deepEqual(f.imported, []);
  assert.equal(f.world.get(f.live.id), f.live);
});

test("PR review: successful placement retains the imported scene and commits its link", async t => {
  const f = sceneFixture(t), token = { id: "keeper-token" }, archive = structuredClone(f.tavern.scene.compendium);
  TavernSceneService.placeTavernkeeperToken = async () => token;
  const placed = await TavernSceneService.placeTavernkeeperOnLinkedScene(f.tavern, { archiveScene: false });
  assert.equal(placed.token, token);
  assert.equal(f.world.get(placed.scene.id), placed.scene);
  assert.deepEqual(f.deleted, []);
  assert.equal(f.tavern.scene.id, placed.scene.id);
  assert.equal(f.tavern.scene.uuid, placed.scene.uuid);
  assert.deepEqual(f.tavern.scene.compendium, archive);
});

test("PR review: Scene.create fallback imports receive the same failure cleanup", async t => {
  const f = sceneFixture(t, { fallback: true });
  TavernSceneService.placeTavernkeeperToken = async () => null;
  assert.equal(await TavernSceneService.placeTavernkeeperOnLinkedScene(f.tavern), null);
  assert.deepEqual(f.deleted, ["imported-1"]);
  assert.equal(f.world.get(f.unrelated.id), f.unrelated);
});

test("PR review: opening a linked scene still resolves and views it without rolling it back", async t => {
  const f = sceneFixture(t);
  const opened = await TavernSceneService.openLinkedScene(f.tavern);
  assert.equal(opened.scene.views, 1);
  assert.equal(f.world.get(opened.scene.id), opened.scene);
  assert.deepEqual(f.deleted, []);
});

test("PR review: failed rollback reports both placement and cleanup errors without touching other scenes", async t => {
  const f = sceneFixture(t), placement = new Error("placement-failed"), cleanup = new Error("delete-failed");
  TavernSceneService.placeTavernkeeperToken = async scene => { scene.delete = async () => { throw cleanup; }; throw placement; };
  await assert.rejects(TavernSceneService.placeTavernkeeperOnLinkedScene(f.tavern), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [placement, cleanup]);
    assert.match(error.message, /imported-1/);
    return true;
  });
  assert.equal(f.world.get(f.unrelated.id), f.unrelated);
});
