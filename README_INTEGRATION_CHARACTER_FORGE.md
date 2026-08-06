# Tavern Generator + Character Forge

`fbl-tavern-generator` can create a tavernkeeper through `fbl-character-forge` v1.4.0+.

Workflow:

1. Enable both modules.
2. Generate a tavern.
3. In the tavernkeeper block, press the user-plus button.
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
