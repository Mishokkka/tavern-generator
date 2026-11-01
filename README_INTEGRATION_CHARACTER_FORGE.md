# Tavern Generator + Character Forge

`fbl-tavern-generator` can create a tavernkeeper through `fbl-character-forge` v1.4.0+.

Workflow:

1. Enable both modules.
2. Generate a tavern.
3. Open **Сцена и тавернщик** and press **Создать тавернщика**.
4. Character Forge creates an Actor with a region-mapped name, portrait and token.
5. Tavern Generator saves the Actor link into the tavern data.

Actor placement:

World Actors are placed into:

`Тавернщики/<region label>`

The root folder name can be changed in the module setting `Папка актеров тавернщиков`.

Actor compendium archive:

If the `в компендиум` checkbox is enabled in the tavernkeeper block, the created tavernkeeper is also saved into the configured Actor compendium.

Default pack:

`world.fbl-tavernkeepers`

The module will try to create this world Actor compendium automatically if it does not exist. Archived tavernkeepers are placed into region folders inside the compendium.

If a linked tavernkeeper was deleted from the world Actors list but still exists in the compendium, the open-actor button can restore it from the archive for the GM.


## Tavernkeeper art subset

When Tavern Generator creates a tavernkeeper through Character Forge, it now requests the `tavern` art subset.

Expected optional structure:

```text
Data/3_F00L/Art/NPC/Human/Named/Random/Male/Novand/tavern/
Data/3_F00L/Art/NPC/Human/Named/Random/Female/Novand/tavern/
```

If the `tavern` folder is missing or empty for the resolved culture and gender, Character Forge falls back to the ordinary culture folder.

Requires fbl-character-forge v1.7.0+ for subset-aware selection. Older versions still create tavernkeepers, but ignore the `tavern` subset request.

## Paired tokens (Tavern Generator 0.8.0)

For art sets with `pairByName`, Tavern Generator validates the token returned by Character Forge before archiving the Actor. This prevents Forge's random-token fallback from assigning a different NPC's token when the selected portrait has no available pair. The check supports the set's suffixes and token naming patterns, Forge's global naming patterns, and same-folder culture/gender subsets.

If the returned token is unrelated, the adapter checks the portrait and returned token folders for an available matching file. If no free pair can be found, it uses the same character's portrait and reports this to the GM. Art sets with `pairByName: false` keep their independent art selection. The Actor prototype token, Forge token flag, tavern metadata and subsequent archive agree; wildcard token selection is disabled for the generated keeper.

The generator shows both the portrait and token preview. Use **Открыть лист** to open the created Actor. The automatic token option works whether the scene or the keeper is created first; **Добавить / обновить токен на сцене** places it explicitly and retains its existing position when updating.

For existing keepers this explicit update also validates the current art pair, repairs it when possible, and updates the Actor archive if the art changed. It keeps the same Actor and name.
