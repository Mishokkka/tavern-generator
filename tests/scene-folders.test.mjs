import "./test-env.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../scripts/constants.js";
import { TavernGenerator } from "../scripts/services/TavernGenerator.js";
import { TavernSceneService } from "../scripts/services/TavernSceneService.js";

class Collection extends Map {
  find(predicate) {
    for (const entry of this.values()) if (predicate(entry)) return entry;
    return undefined;
  }
}

function fixture(t) {
  const previousGame = { user: game.user, folders: game.folders, packs: game.packs, scenes: game.scenes };
  const previousClasses = { Folder: globalThis.Folder, Scene: globalThis.Scene, Image: globalThis.Image };
  t.after(() => {
    Object.assign(game, previousGame);
    Object.assign(globalThis, previousClasses);
  });

  game.user = { isGM: true };
  const worldFolders = game.folders = new Collection();
  const worldScenes = game.scenes = new Collection();
  const archiveScenes = new Collection();
  const pack = {
    collection: TavernSceneService.compendiumPackId(), documentName: "Scene", locked: true,
    folders: new Collection(),
    async configure({ locked }) { this.locked = locked; },
    async getDocument(id) { return archiveScenes.get(id); },
    // In v13 the index only contains Scene entries. Folder documents are in pack.folders.
    async getIndex() { return Array.from(archiveScenes.values(), scene => scene.toObject()); }
  };
  game.packs = new Map([[pack.collection, pack]]);

  let folderCount = 0;
  async function createFolder(data, { pack: packId } = {}) {
    const folders = packId ? pack.folders : worldFolders;
    if (packId) assert.equal(pack.locked, false);
    assert.ok(!data.folder || folders.has(data.folder));
    await Promise.resolve();
    const id = `folder-${++folderCount}`;
    const folder = {
      id, name: data.name, type: data.type, _source: { folder: data.folder ?? null },
      get folder() { return folders.get(this._source.folder) ?? null; }
    };
    folders.set(id, folder);
    return folder;
  }
  globalThis.Folder = {
    create: createFolder,
    async createDocuments(data, options) { return Promise.all(data.map(folder => createFolder(folder, options))); }
  };

  let sceneCount = 0;
  function createScene(data, scenes, folders) {
    const id = `scene-${++sceneCount}`;
    const source = { ...structuredClone(data), _id: id };
    const scene = {
      id, uuid: `Scene.${id}`, name: data.name,
      get folder() { return folders.get(source.folder) ?? null; },
      get flags() { return source.flags; },
      getFlag(scope, key) { return source.flags?.[scope]?.[key]; },
      toObject() { return structuredClone(source); },
      async view() {},
      async setFlag(scope, key, value) { await this.update({ [`flags.${scope}.${key}`]: value }); },
      async update(update) {
        if (folders === pack.folders) assert.equal(pack.locked, false);
        for (const [key, value] of Object.entries(update)) {
          foundry.utils.setProperty(source, key, structuredClone(value));
        }
        return this;
      }
    };
    scenes.set(id, scene);
    return scene;
  }
  globalThis.Scene = {
    create: async data => createScene(data, worldScenes, worldFolders),
    implementation: {
      async createDocuments(entries, { pack: packId }) {
        assert.equal(packId, pack.collection);
        assert.equal(pack.locked, false);
        return entries.map(entry => createScene(entry, archiveScenes, pack.folders));
      },
      async updateDocuments(entries, { pack: packId }) {
        assert.equal(packId, pack.collection);
        assert.equal(pack.locked, false);
        return Promise.all(entries.map(entry => archiveScenes.get(entry._id).update(entry)));
      }
    }
  };
  globalThis.Image = class { set src(_src) { this.onload(); } };
  worldScenes.importFromCompendium = async (_pack, id, update) => Scene.create({ ...archiveScenes.get(id).toObject(), ...update });

  const config = { mode: "manual", manualImagePath: "tavern.webp", createShopNote: false, placeTavernkeeper: false };
  const create = async (options) => {
    const tavern = TavernGenerator.generate(options);
    const result = await TavernSceneService.createSceneForTavern(tavern, config);
    tavern.scene = result.meta;
    return { ...result, tavern, archived: archiveScenes.get(result.archive.id) };
  };
  return { create, pack, worldFolders, worldScenes, archiveScenes, createFolder };
}

function folderPath(document) {
  const names = [];
  for (let folder = document.folder; folder; folder = folder.folder) names.unshift(folder.name);
  return names;
}

test("country folders are reused from the v13 pack folder collection", async t => {
  const f = fixture(t);
  f.pack.locked = false;
  const region = await f.createFolder({ type: "Scene", name: "Нованд" }, { pack: f.pack.collection });
  f.pack.locked = true;
  const first = await f.create({ region: "novandia" });
  const second = await f.create({ region: "novandia" });
  assert.equal(first.archived.folder, region);
  assert.equal(second.archived.folder, region);
  assert.equal(f.pack.folders.size, 1);
  assert.deepEqual(folderPath(second.scene), ["ТАВЕРНЫ", "Нованд"]);
  assert.equal(f.worldFolders.size, 2);
  assert.equal(f.pack.locked, true);
});

test("city folders use the region as parent and reuse equivalent city names on concurrent creates", async t => {
  const f = fixture(t);
  const [first, second] = await Promise.all([
    f.create({ region: "novandia", city: "Берёзовка" }),
    f.create({ region: "novandia", city: " березовка " })
  ]);
  const other = await f.create({ region: "sangren", city: "Берёзовка" });
  assert.deepEqual(folderPath(first.scene), ["ТАВЕРНЫ", "Нованд", "Берёзовка"]);
  assert.deepEqual(folderPath(first.archived), ["Нованд", "Берёзовка"]);
  assert.equal(first.scene.folder, second.scene.folder);
  assert.equal(first.archived.folder, second.archived.folder);
  assert.deepEqual(folderPath(other.scene), ["ТАВЕРНЫ", "Сангрен", "Берёзовка"]);
  assert.deepEqual(folderPath(other.archived), ["Сангрен", "Берёзовка"]);
  assert.equal(f.pack.folders.size, 4);
  assert.equal(f.worldFolders.size, 5);
  assert.equal(f.pack.locked, true);
});

test("re-archiving and restoring follow the latest city, including a cleared city", async t => {
  const f = fixture(t);
  const { tavern, scene, archive, archived } = await f.create({ region: "novandia", city: "Берёзовка" });
  tavern.city = "Каменка";
  const updatedArchive = await TavernSceneService.archiveScene(scene, tavern);
  assert.equal(updatedArchive.id, archive.id);
  assert.equal(f.archiveScenes.size, 1);
  assert.deepEqual(folderPath(archived), ["Нованд", "Каменка"]);
  assert.equal(archived.getFlag(MODULE_ID, "tavernPublicView").city, "Каменка");

  f.worldScenes.delete(scene.id);
  tavern.city = "Верхний Посад";
  const restored = await TavernSceneService.openLinkedScene(tavern);
  assert.deepEqual(folderPath(restored.scene), ["ТАВЕРНЫ", "Нованд", "Верхний Посад"]);

  tavern.city = "";
  await TavernSceneService.archiveScene(scene, tavern);
  assert.deepEqual(folderPath(archived), ["Нованд"]);
  assert.equal(archived.getFlag(MODULE_ID, "city"), "");
});

test("archives made using v0.8.0 snapshots can supply the city when the tavern has no city field", async t => {
  const f = fixture(t);
  const { scene, tavern, archived } = await f.create({ region: "novandia", city: "Берёзовка" });
  const { city, ...legacyTavern } = tavern;
  const archive = await TavernSceneService.archiveScene(scene);
  assert.equal(archive.id, archived.id);
  assert.deepEqual(folderPath(archived), ["Нованд", "Берёзовка"]);
  f.pack.locked = false;
  await archived.update({ [`flags.${MODULE_ID}.city`]: undefined });
  f.pack.locked = true;
  f.worldScenes.delete(scene.id);
  const restored = await TavernSceneService.openLinkedScene(legacyTavern);
  assert.deepEqual(folderPath(restored.scene), ["ТАВЕРНЫ", "Нованд", "Берёзовка"]);
});

test("applying the city moves linked scenes and their archive records in place", async t => {
  const f = fixture(t);
  const { tavern, scene, archived } = await f.create({ region: "novandia" });
  tavern.city = "Берёзовка";
  await TavernSceneService.syncLinkedSceneFolders(tavern);
  assert.deepEqual(folderPath(scene), ["ТАВЕРНЫ", "Нованд", "Берёзовка"]);
  assert.deepEqual(folderPath(archived), ["Нованд", "Берёзовка"]);
  assert.equal(archived.getFlag(MODULE_ID, "tavernPublicView").city, tavern.city);
  await TavernSceneService.syncLinkedSceneFolders(tavern);
  assert.equal(f.pack.folders.size, 2);
  assert.equal(f.worldFolders.size, 3);

  tavern.city = "";
  await TavernSceneService.syncLinkedSceneFolders(tavern);
  assert.deepEqual(folderPath(scene), ["ТАВЕРНЫ", "Нованд"]);
  assert.deepEqual(folderPath(archived), ["Нованд"]);
  assert.equal(archived.getFlag(MODULE_ID, "tavernPublicView").city, "");
  assert.deepEqual([...f.worldScenes.values()], [scene]);
  assert.deepEqual([...f.archiveScenes.values()], [archived]);
  assert.equal(f.pack.locked, true);
});

test("re-archiving from the scene keeps the new city or an explicitly cleared city", async t => {
  const f = fixture(t);
  const { tavern, scene, archived } = await f.create({ region: "novandia", city: "Берёзовка" });
  const oldSnapshot = { id: tavern.id, name: tavern.name, region: tavern.region, city: tavern.city };
  await scene.update({
    [`flags.${MODULE_ID}.tavernData`]: oldSnapshot,
    [`flags.${MODULE_ID}.shopButton`]: { tavernPublicView: oldSnapshot, tavernData: oldSnapshot }
  });

  for (const [city, destination] of [["Каменка", ["Нованд", "Каменка"]], ["", ["Нованд"]]]) {
    tavern.city = city;
    await TavernSceneService.syncLinkedSceneFolders(tavern);
    assert.deepEqual(folderPath(scene), ["ТАВЕРНЫ", ...destination]);
    const archive = await TavernSceneService.archiveScene(scene);
    assert.equal(archive.id, archived.id);
    assert.deepEqual(folderPath(archived), destination);

    for (const document of [scene, archived]) {
      const flags = document.flags[MODULE_ID];
      assert.equal(flags.city, city);
      for (const snapshot of [flags.tavernPublicView, flags.tavernData, flags.shopButton.tavernPublicView, flags.shopButton.tavernData]) {
        assert.equal(snapshot.city, city);
        assert.equal(snapshot.name, oldSnapshot.name);
      }
    }
  }
  assert.equal(f.archiveScenes.size, 1);
});

test("applying the city leaves documents linked to another tavern in their own folders", async t => {
  const f = fixture(t);
  const owned = await f.create({ region: "novandia", city: "Берёзовка" });
  const other = await f.create({ region: "sangren", city: "Белый берег" });
  const tavern = { ...owned.tavern, city: "Каменка", scene: other.tavern.scene };
  await TavernSceneService.syncLinkedSceneFolders(tavern);
  assert.deepEqual(folderPath(other.scene), ["ТАВЕРНЫ", "Сангрен", "Белый берег"]);
  assert.deepEqual(folderPath(other.archived), ["Сангрен", "Белый берег"]);
  assert.equal(f.pack.folders.size, 4);
  assert.equal(f.worldFolders.size, 5);
});
