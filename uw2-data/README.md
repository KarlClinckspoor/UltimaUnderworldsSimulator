# uw2-data

Full JSON extracts of the pristine Ultima Underworld II data files, made by `tools/extract_uw2.py`
(no game data is bundled with the tool; the outputs are derived from the shipped files):

| file | from | what |
|---|---|---|
| `objects.json` | `DATA/OBJECTS.DAT` | melee weapons, missiles and launchers, armour, the 64 creature records (`struct Creature`, provisional names from `uw2/src/include/critter.h`), containers, lights, food, trigger modes, animation classes |
| `comobj.json` | `DATA/COMOBJ.DAT` | the 512 common object records: height, radius, mass, resistances, quality class |
| `spells.json` | `uw2/src/combat/SPELLS.C` | the 69-entry `spells[]` table with class, minor, runes and names; the player's 64 are eight per circle |
| `level-monsters.json` | `DATA/LEV.ARK` | every monster on the 42 shipped levels (LZSS blocks decoded), with level, world, tile, HP, powerful bit, attitude, goal and inventory; trap-spawned ones with their spawn chance |
| `animation.json` | `DATA/WEAP.DAT`, `CRIT/AS.AN`, `CRIT/CR.AN` | the player's swing frames by hand and weapon kind; each creature's animation page and the 8 sequence lengths (3..5 attacks, 6 cast / fire) |

`tools/read_playerdat.py` is the reference reader for a save's `PLAYER.DAT` (the 0x37D-byte record under the chained cipher of `sys/MISCUTIL.C`, the inventory workspace and the equipment slots); `src/core/playerdat.ts` is its port and `test/core.test.ts` checks the two agree on the sample save.

`node tools/compact-data.mjs` (from the repository root) turns these into `src/data/game.json`, the compact data the site ships.
