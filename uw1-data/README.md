# uw1-data

Derived from the pristine UW1 `DATA\OBJECTS.DAT` and `DATA\LEV.ARK`. The inputs are the same for every player, so the outputs are static data files for the calculator and the later combat simulator.

- `json/objects.json`: all OBJECTS.DAT tables (melee weapons, missiles, armour, 64 creatures with every field the port names, containers, lights, food, trigger modes, animation classes). Item names come from the port's `items.h` (descriptive, with the item id kept where a name repeats).
- `json/level-monsters.json`: every creature in LEV.ARK levels 1-9, with its stored hit points, powerful flag, attitude, goal, home tile, map tile or the create-object trap that holds it, carried items, and its combat numbers resolved from `objects.json` (defence, armour, to-hit base and damage base per attack slot).
- `json/spells.json`: the 53-entry spell table from `SPELLS.C` (class, minor, and for missile spells the Missile[] damage; for heals the dice). Indices 0-47 are the player's, 48-52 only appear in creature records.
- `json/comobj.json`: COMOBJ.DAT, 512 item types (height, radius, mass, value, quality class / toughness, resist byte with decoded names, render, flags).
- `tools/extract_uw1.py`: regenerates all four. `python3 -I tools/extract_uw1.py --objects OBJECTS.DAT --levark LEV.ARK --items uw1/src/include/items.h --spells-c uw1/src/combat/SPELLS.C --comobj COMOBJ.DAT --out json`
- `tools/read_playerdat.py`: reference reader for a save's PLAYER.DAT (record, equipment slots 0-10 with enchantments, rune bag, derived armour and defence); the expected values for the site's tests.

Format sources: `docs/FORMATS.md`, `uw1/src/include/{critter,object,level,items}.h` in abedegno/underworld-exhumed.

Checks done: OBJECTS.DAT is exactly 0xDE2 bytes; each level block is 0x7C08 bytes with the "uw" magic; for every level, free mobile slots + in-use slots = 254, the in-use slots are all creatures, and the count on tile chains equals the file's active-mobile count; every off-map creature is held by a create-object trap (item 0x187).

Creature fields added 2026-10-23: `arms` and `fires_missile_index` (the first version's `fires_missile` mixed melee weapons with missiles and was removed), `armour_by_zone` (255 resolved to zone 0), `offensive_spells_flag` (b2D_0).

Added 2026-10-24: `spells.json` `runes` and `rune_words` (from `try_cast`'s packing); creature `nerve` (b1C_0); missile `damage_type` (= -ammo). Attitude values: 0 hostile, 1 upset, 2 mellow, 3 friendly (critter.h).

Known limits: creature names come from the port's `items.h`, not the game's STRINGS.PAK (not parsed); `goal` and `old_goal` are raw numbers; level 9's creatures have no names in `items.h` for some ids (shown as `item 0x..`).
