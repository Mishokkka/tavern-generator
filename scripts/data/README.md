# Tavern data layout

Public imports should go through `scripts/data/index.js`.

Food and drinks are split into:
- `food/common.js` / `drinks/common.js` for entries usable across regions.
- `food/regions/*.js` / `drinks/regions/*.js` for regional entries.
- `food/regions/shared.js` / `drinks/regions/shared.js` for entries shared by several specific regions.

Names are split into `names/regions/*.js`. Each region can use:
- `patterns` with `{adj}`, `{noun}` and `{terrain}` placeholders.
- `adjectives` and `nouns` vocabulary.
- `terrain` vocabulary by terrain key.
- `fixedNames` for curated tavern names that should sometimes appear without assembly.

After editing data, run in Foundry console:

```js
game.fblTaverns.validateData()
```

Special regions:
- `izuaver` has its own name table, but no own food table. Food is drawn from other regional food tables as imported city food.
- `izuaver` food prices are increased and lodging prices are reduced in `scripts/services/TavernPricing.js`.

## Lore pass 0.2.2

Regional tavern names use local in-world vocabularies and avoid Earth-language fallbacks in region tables. `common` remains a neutral road fallback.

Izuaver is modeled as a huge import market: food is assembled from other regional food tables, food prices are high, and lodging is cheap.

Boltrask and Dichtbeir were added as full selectable regions with their own names, food and drinks.
