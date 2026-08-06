# Tavern Scene Backgrounds

Default Foundry path:

`3_F00L/Scenes/Interior/Taverns/`

Windows path inside Foundry User Data:

`Data\3_F00L\Scenes\Interior\Taverns\`

Expected region folders:

- `common`
- `novandia`
- `sangren`
- `flechenrand`
- `horslia`
- `ontakwa`
- `yaknizem`
- `tirabor`
- `lezhnizem`
- `sirost`
- `sarroyo`
- `royu_sageki`
- `royu_mideki`
- `naerder`
- `kaldvelg`
- `izuaver`
- `boltrask`
- `dichtbeir`

Expected quality folders inside each region:

- `poor`
- `modest`
- `good`
- `fine`

Fallback order:

1. `region/quality`
2. `common/quality`
3. other quality folders in the same region
4. other quality folders in `common`
5. `region`
6. `common`
7. root `Taverns`

Generated Scene placement:

World Scenes are placed into:

`ТАВЕРНЫ/<region label>`

Archived compendium scenes are placed into region folders inside the configured Scene compendium.

Default scene pack:

`world.fbl-tavern-scenes`

Generated Scene names are exactly tavern names. No `Таверна —` prefix is added.
