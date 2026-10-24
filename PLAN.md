# UW1 skill check and combat simulator: implementation plan (v4)

One static website, two tabs at the top: **Skills** (exact odds of every skill check, Part A) and **Combat** (simulated fights against every enemy in the game, Part B). Both share one character panel.

**v4.2 decisions (2026-10-24):** the site is a new local repository (to be pushed to GitHub later); aiming time 1 s per spell or launcher shot; the player always attacks at full charge (the charge setting is fixed at 100%, not a UI control).

**v4.1 decisions (2026-10-24, later):** the player never flees (death just means a trip back to the silver sapling); a ranged fight against a melee-only monster is simulated normally and reported as damage over time; enemy HP defaults to the stored value with "roll" and "set" options; buffs are pre-cast at 100%, with a switch to take their mana from the starting mana; in ranged-only fights one attack spell may be chosen, with fizzles, backfires and mana modelled.

**v4 decisions (2026-10-24):** the combat simulator is a tab of the same site, not a separate app. Enemies picked from a per-level list; melee or ranged; N configurable; outcomes (victories, deaths, flees), damage dealt by source, damage received per body part with armour absorbed; an all-enemies run with a "how many can be defeated" graph. The character panel gains buff spells, equipment quality and enchantments; PLAYER.DAT loads equipment slots only. Carried over from v3: ideal uniform roll model (n/31); skills tab stays exact (no Monte Carlo there); static JSON data from OBJECTS.DAT and LEV.ARK.

Reference: https://github.com/abedegno/underworld-exhumed, read at the current default branch (2026-10-23): `uw1/src/game/SKILLCHK.C`, `PLAYTIME.C`, `SKILLS.C`, `PLAYDATA.C`, `combat/COMBAT.C`, `RUNES.C`, `SPELLS.C`, `obj/USEITEMS.C`, `event/WORLDEV.C`, `TRIGGER.C`, `ui/INTERACT.C`, `conv/BARTER.C`, `motion/PHYSICS.C`, `OBJPHYS.C`, `sys/MISCUTIL.C`, `docs/FORMATS.md`. Nothing was built or run. UW1 only; UW2 later. Items marked *not traced* were seen in a grep but not read.

Skills tab: no Monte Carlo, no worker; every number is an exact count. Combat tab: Monte Carlo in workers (the user asked for N simulated fights), with exact per-blow distributions used to test it (B10). PLAYER.DAT reader, character panel and dependency tables are in sections 3 and 4.

## Random numbers: the game's own generator (2026-10-24, supersedes the roll model of section 1)

The simulator now draws from the game's generator by default instead of the ideal n/31 model. UW.EXE links Borland/Turbo C++'s `rand()`: `seed = seed × 0x015A4E35 + 1 (mod 2^32)`, result bits 16–30 (0..32767). Every call site uses the draw in the game's form: `rand() % n`, `rand() & mask`, and `rollem`'s `(rand() × sides) / 0x8000`. So the small inhomogeneities are in: `rand() % 31` gives residue 0 in 1058 of 32768 draws and the others in 1057 (a d=0 skill check is 3172 / 13741 / 13741 / 2114 out of 32768 instead of 3/13/13/2 out of 31); the attack slot's `rand() % 100` favours 0..67 (328 vs 327); a missile's `rand() % 192` favours 0..127 (171 vs 170); a d6 face comes up 5461 or 5462 times. The exact distributions (Skills tab, the one-blow card, the tests) use the same weights (`core/randdist.ts`).

- `core/rng.ts`: the Borland LCG with jump-ahead. A run split over k workers gives each a disjoint block of 2^32 / k draws of the one cycle; the stats count draws, and the Combat tab reports the share of the period used and warns if a job overran its block. Model-only randomness (the missile hit-chance setting) has its own stream and never shifts the game's sequence.
- Checked call for call against vectors measured on UW.EXE (`test/vectors`, from underworld-exhumed's `uw1/vectors/`: `skill_check`, `rollem`, `pickloc`, `check_res`): the same 32-bit state in gives the same result and the same state out, for every row. The C harness test now requires the game-model counts to equal the C code run over all 32768 values exactly.
- The ideal model stays as an option (Skills and Combat tabs, "Random numbers") for comparison; the Skills tab shows both and the difference in ppm.
- Does it matter in long runs? The bias is per draw and does not grow with N; a large N only makes it measurable. Measured (Karl's save, 400,000 fights per model): Skeleton win 95.156% vs 95.133% (±0.034% each), Goblin 0x47 6.182% vs 6.193% (±0.038%), Giant Spider 17.611% vs 17.669% (±0.060%): no difference beyond noise. The game-model simulation matches the game-model exact one-blow mean over 1.8–3.9 million swings (|z| < 1), so the generator's serial structure does not show either. 400,000 such fights use 22–45 million draws, 0.5–1% of the period.

# Part A. Skills tab

## 1. The exact model

`skill_check(value, target)`: `score = value - target + rand() % 31`; score > 28 gives 2, > 15 gives 1, > 2 gives 0, else -1. With `d = value - target` and `C(t) = clamp(d + 31 - t, 0, 31)` (the number of rolls r in 0..30 with score >= t):

| grade | count out of 31 |
|---|---|
| 2 (critical) | C(29) |
| 1 (success) | C(16) - C(29) |
| 0 (near miss) | C(3) - C(16) |
| -1 (failure) | 31 - C(3) |

Check: d = 0 gives 2, 13, 13, 3, as the source comment states. This is the only place the rule lives; the test in section 6 verifies it against the real C.

**Roll model** (superseded: see "Random numbers" above; the ideal model remains an option). Ideal uniform: r is one of 31 equally likely values, every probability is n/31. The real `rand() % 31` on a 15-bit `rand()` is off by at most 1/32768 per outcome (residue 0 has 1058 of 32768, the others 1057); this is deliberately ignored. Counts stay integers; display as fraction and percent.

**Compound outcomes** are exact too, by integer convolution (BigInt, denominators 31^k): sums of independent checks (character creation), per-tick drowning, repair outcomes with their extra random draws, and the random bonuses listed below.

## 2. Architecture

- Vite + TypeScript, static site, no backend. d3 for charts. Nothing is uploaded: PLAYER.DAT is read with a file picker or drag-and-drop and stays in the browser. The game data (OBJECTS.DAT, LEV.ARK, SPELLS.C table, COMOBJ.DAT) ships as JSON built once by `uw1-data/tools/extract_uw1.py`.
- **Two tabs** in a header bar: *Skills* and *Combat* (state of each kept when switching; the active tab and settings live in the URL hash). One **character panel** (left, collapsible, content flows around it) is shared: attributes, skills, derived values, equipment slots with quality and enchantment, buffs, easy-mode flag, and the PLAYER.DAT loader.
- `core/` pure functions, no DOM: `gradeCounts`, `checkOutcome`, convolution helpers (Skills); `combat/` blow pipeline, monster AI timers, fight loop (Combat).
- `data/` parsers and JSON loaders: `playerdat.ts` (sections 4 and B3), `objects.json`, `level-monsters.json`, `spells.json`, `comobj.json`.
- `state/` one store: character, selected checks, roll model, combat settings. Skills tab recomputes synchronously (a heatmap is under 10^4 cells). Combat runs in a **Web Worker pool** with seeded PRNGs and a progress and cancel control.
- UI: CSS grid of chart cards (`auto-fit, minmax(...)`) with a ResizeObserver per card, so cards reflow when the panel collapses or the window changes.

## 3. Dependencies

### 3.1 Derived player values (what the panel shows beside the raw fields)

| value | formula | source |
|---|---|---|
| max carry weight | STR x 20 | SKILLS.C `player_compute` |
| max HP | 30 + level x STR / 5 (stored in one byte) | `player_compute` |
| max mana | (Mana skill + 1) x INT >> 3 (on level 7 it is parked in `saved_mana`) | `player_compute` |
| noise / visibility | 13 - Stealth / 3, 15 - Stealth / 5 | PLAYDATA.C:159 |
| load (swimming target) | weight x 32 / max_weight | PLAYTIME.C `sink_sink_sink` |
| level from XP | thresholds 500 x {1,2,3,4,6,8,12,16,24,32,48,64,96,128,192}; max 16 | SKILLCHK.C |
| skill points | one per 3000 XP, one per level | SKILLCHK.C, SKILLS.C |

Governing attribute (`prime`, for training and character creation): skills 0-6 (Attack, Defense, Barehand, Sword, Axe, Mace, Missile) STR; 7-9 (Mana, Lore, Casting) INT; 10-19 (Traps, Search, Track, Stealth, Repair, Charisma, Pick Lock, Acrobat, Appraise, Swimming) DEX. Skills cap at 30.

### 3.2 Every skill

| skill | used by | what it feeds |
|---|---|---|
| Attack, Defense, Barehand, Sword, Axe, Mace, Missile | Combat tab (Part B) | no check on the Skills tab |
| Mana | PLAYTIME.C:125, SKILLS.C | regen check against 10; max mana |
| Lore | INTERACT.C:650, BARTER.C:408 | identification checks against 10, 20 or 15 |
| Casting | RUNES.C:249 | value = Casting + 5 against 2 x circle; TRIGGER.C and SPELLS.C also read it (*not traced*) |
| Traps | INTERACT.C:533 | disarm check against 8 |
| Search | INTERACT.C:526, TRIGGER.C:126 | trap detection against 8; hidden trigger against the trap's own value; SPELLS.C reads it three times (*not traced*) |
| Track | SKILLS.C `use_skill` | F9 runs `mdetect(8, Track)`: one check per active creature within 8 squares |
| Stealth | PLAYDATA.C:159 | no skill check; sets noise and visibility |
| Repair | USEITEMS.C:389 | value of the repair check |
| Charisma | BARTER.C:201, 711 | no skill check; barter and a combat-style score |
| Pick Lock | USEITEMS.C:231 | value of the lock check |
| Acrobat | PHYSICS.C:432 | falling-damage check |
| Appraise | BARTER.C:757 | no skill check |
| Swimming | PLAYTIME.C:201, 205 | drowning checks |

### 3.3 Every `skill_check` call site on the Skills tab (the combat ones are Part B)

`hit` below means grade >= 1. "Target type": fixed = literal in the code; computed = from game state; data = from a game data table.

| # | check (file:line) | value | target (type) | grade effects |
|---|---|---|---|---|
| 1 | Casting (RUNES.C:249) | Casting + 5 | 2 x circle (circle 1-8 = spell index / 6 + 1) (computed) | 2 or 1: cast. 0: fail, mana kept. -1: backfire. Needs level >= 2 x circle - 1 and mana >= 3 x circle first |
| 2 | Track / Detect Monster (SPELLS.C:700) | Track skill (F9); the spell passes its own value (*not traced*) | 15 - creature `noise` (data, 4 bits), per creature | > 0: creature counted in its direction |
| 3 | Lore, inventory look (INTERACT.C:650) | Lore | 10 (fixed) | lore level = grade + 1 (at least 1): 2 -> 3, 1 -> 2, 0 and -1 -> 1; best result is kept on the object |
| 4 | Lore, barter (BARTER.C:408) | Lore | 20 on one side (lore 1 + [grade > 0]), 15 on the other (lore 1 + grade, so 0 to 3) | which side is which: *not traced* |
| 5 | Hidden look trigger (TRIGGER.C:126) | Search | the trap's own z value (data in the level) | <= 0: not triggered. Only for look triggers (type 5) and z > 0 |
| 6 | Detect trap (INTERACT.C:526, SKILLS.C:898) | Search | 8 (fixed) | > 0: offers to disarm |
| 7 | Disarm (INTERACT.C:533, SKILLS.C:928) | Traps | 8 (fixed) | > 0: removed. -1: set off. 0: unable |
| 8 | Remove Trap spell (SPELLS.C:738) | 45 (fixed) | 8 | same as 8 and 9 |
| 9 | Lock pick (USEITEMS.C:1028) | Pick Lock | 3 x the lock's z (data in the level; z 15 never opens; z 14 fails outright when the skill is below 31, so never with Pick Lock (cap 30), while the Open spell's 45 passes that guard and then rolls normally) | > 0: opens |
| 10 | Open spell (SPELLS.C:748) | 45 (fixed) | 3 x lock z | same |
| 11 | Monster opens a door (PATHFIND.C:1257) | creature `locks` (data) | 3 x lock z; tried half the time | same |
| 12 | Repair (WORLDEV.C:632) | Repair (anvil); an NPC repairer passes its own (*not traced*) | item durability (data: Weapons[] or Armor[] table) | 2: full repair. 1: +3 + skill/5 quality. 0: nothing. -1: destroyed if (rand & 63) > quality + skill, else -(4 + rand & 7) quality. Time: max(15, 3 x durability - skill - quality/2) minutes |
| 13 | Swimming, per tick when swim_count > 0x50 (PLAYTIME.C:201) | Swimming | load = weight x 32 / max_weight (computed) | grade < 1 adds rollem(3 - grade, 4) to swim_count; a second check above 0x78 sets damage dice |
| 14 | Drowning damage (PLAYTIME.C:205) | Swimming | load | hurt = 2 - grade; damage rollem(2, hurt + 2) when hurt != 0 |
| 15 | Fall (PHYSICS.C:432) | Acrobat | 2 x damage (computed from impact, doubled if vertical velocity is non-zero) | > 0: damage x (30 - Acrobat)/30 |
| 16 | Mana regen (PLAYTIME.C:125), every third tick | Mana | 10 (fixed) | mana + grade if grade > 0 |
| 17 | HP regen (PLAYTIME.C:139), every 24 ticks | STR | 15 (fixed) | > 0: +1 HP |
| 18 | Mushroom (USEITEMS.C:622) | INT | 20 (fixed) | the code tests the result as a truth value, so every grade except 0 counts (-1 included); then mana + 0..2. Looks like a quirk of the original; worth showing |
| 19 | Drunk (USEITEMS.C:694) | STR | drunk level (max 0x3F) | -1: passes out; 0: short effect; other grades *not traced* |
| 20 | Character creation (SKILLS.C:173) | prime attribute | 20 (fixed) | each grade (-1..2) is added to the skill; 3 checks for a new skill, 2 for one already held, plus base + attribute/divisor + a uniform 0..rolls-1 bonus, capped at 30. Exact distribution by convolution |

Not skill_check but random and worth modelling later: critical damage multiplier (x1 or x2, even odds: `(rand & 0x1F) + 0x30 >> 5`), repair destruction chance, mushroom mana.

## 4. PLAYER.DAT reader

Layout (docs/FORMATS.md "PLAYER.DAT", `sys/MISCUTIL.C:268` `xorread`, `game/PLAYDATA.C:104`):

1. File byte 0 is the key, equal to `name[0] ^ 0xAA`.
2. The next 0xD2 bytes are the record. Cipher: table t[i] = (key + 3 x (i + 1)) mod 256 for i in 0..0x4F, byte i of each 0x50-byte block XOR t[i]; the table restarts every 0x50 bytes (offsets 0x50 and 0xA0). The same routine decodes and encodes.
3. Then a word at 0xD3: saved object count plus one. Then the inventory workspace at 0xD5. Total length is 1 + 0xD2 + 2 + 0x5B + 8 x count, which is the integrity check.
4. Validation after decoding: `record[0] ^ 0xAA == key`, file length matches, level 1..16, skills <= 30.

**Validated on the attached sample** (320 bytes, decoded with a throwaway Python script written from the spec above): key 0xCB, name check passes, count word 2 gives length 1 + 0xD2 + 2 + 0x5B + 16 = 320 exactly. Decoded: STR 23, DEX 19, INT 18; Attack 10, Defense 6, Sword 8, Repair 5, Pick Lock 5, all other skills 0; HP 34/34, mana 2/2, hunger 192, fatigue 64, level 1, XP 23, 1 skill point, weight 63, max weight 460, easy flag 1. The derived formulas agree with the stored values: max weight 23 x 20 = 460, max HP 30 + 1 x 23 / 5 = 34, max mana (0 + 1) x 18 >> 3 = 2. So offsets, cipher and the three `player_compute` formulas are confirmed on one fresh level-1 character. Not yet confirmed (sample has them at zero or ambiguous): `drunk`, `shrooms`, `poison`, `swim_count`, `lore[]`, and the XP scale. Byte 0x64 is 0x61: lefty = 1, female = 0, body = 0, pclass = 3 by the declared bit order (3 is Tinker in `enum PlayerClass`); I cannot confirm the class from the game here, so the reader shows it as a number until you confirm.

Fields to parse (record offset = file offset minus 1; little-endian; from `include/player.h`): name 0x00 (0x1E bytes), STR 0x1E, DEX 0x1F, INT 0x20, skills 0x21-0x34 in the order of 3.2, health 0x35, max health 0x36, mana 0x37, max mana 0x38, hunger 0x39, fatigue 0x3A, level 0x3D, weight (u16) 0x4A, max weight (u16) 0x4C, XP (u32) 0x4E, skill points 0x52, dungeon level (i16) 0x5C, easy flag 0xB4, saved mana (level 7) 0xB0, swim_count 0xB9, game clock (u32) 0xCE. The header calls its bitfield names provisional: `drunk` (word 0x61, bits 4-9), `lefty` (0x64) and `pclass` are used by the calculator and must be checked against a real save before being trusted. FORMATS.md says experience is stored "in tenths"; confirm the display scale against a save before showing a number.

Equipment: the inventory workspace (player object 0x1B bytes, 28 slot words at 0x23) is read **for slots 0 to 10 only** (armour, shoulders, hands, rings): worn items, the weapon (`8 - lefty`) and the shield (`7 + lefty`) with their quality and enchantment, as specified in B3. The pack, bags and cursor object are not loaded. This also turns the repair target (item durability) on the Skills tab from a typed number into a computed one.

Also: write a PLAYER.DAT? Not in scope (read only), but the encoder is the same function, so a round-trip test comes free.

## 5. Game data (decided 2026-10-23: static JSON, no file picker)

OBJECTS.DAT and the pristine LEV.ARK are the same for every player, so they are converted once, at build time, by `uw1-data/tools/extract_uw1.py` and shipped as JSON: `objects.json` (weapons, missiles, armour, 64 creatures, containers, lights, food, trigger and animation tables), `level-monsters.json` (657 creatures in levels 1-9 with stored HP, powerful flag, tile or spawning trap, carried items and resolved combat numbers), `spells.json` (the 53-entry spell table), and, once the file is supplied, `comobj.json` (heights, resistances, toughness for every item; section B9). The extractor is the only code that reads the binary files and its source is in the repo. Creature names are the port's `items.h` names (STRINGS.PAK is not parsed yet). The creature table's STR is 0 for every creature, so the STR/5 term in monster damage is always 0.

Used on the Skills tab: creature `noise` (check 2), creature `locks` (check 11), weapon and armour `durability` (check 12). Everything else is for the Combat tab.

## 6. Tests

- **Exhaustive C cross-check.** A small C program (outside the web repo) copies `skill_check` verbatim and replaces `rand()` by a loop over 0..32767; it prints the four counts for d in -80..80. The TS `gradeCounts` (ideal n/31) must agree with the C counts scaled to 32768 within 1 outcome per grade, which is exactly the accepted approximation. This pins the one formula everything depends on.
- Boundary cases by hand (scores 2/3, 15/16, 28/29), d = 0 gives 2, 13, 13, 3.
- Each compound model checked by brute-force enumeration over all rolls (small cases): casting, repair, chargen sum, drowning tick.
- PLAYER.DAT: encode then decode round trip; the attached 320-byte sample as the fixture (expected values in section 4); key and length validation; corrupted files give a clear error.
- UI: Playwright smoke test (load a fixture, collapse the panel, switch tabs, charts resize). Combat tests are in B10.

## 7. Skills tab charts (all exact, all visible together)

1. Grade bars per scenario, labelled with the exact fraction and percent.
2. Score distribution: the 31 outcomes shifted by d, with the thresholds 3, 16, 29 drawn.
3. P(grade >= 1) against skill value for the chosen target, marker at the current value.
4. Heatmap: skill value x target, colour = P(hit); click a cell to load it.
5. Check-specific views: spell success and backfire for circles 1-8 at the current Casting; lore level distribution; repair outcomes; drowning per tick; chargen skill distribution.
6. Multi-scenario overlay of 1 and 3, colour-blind-safe palette.

# Part B. Combat tab

Reference for everything below: `combat/COMBAT.C` (`frp_check`, `do_damage`, `pickloc`, `critter_attack`, `player_attack`, `missile_thwack`), `critter/AI.C` (`critter_ai`, `critter_mv`, `crit_offense`, `crit_attack`, `crit_magik_attack`, `crit_missile_attack`, `should_i_flee`, `atk_charge`), `game/PLAYDATA.C` (`FixPlayerEquips`, `player_affected_by`, `armor_val`), `combat/DAMAGE.C` (`check_res`, `damage_object`), `combat/SPELLS.C`, `inv/INVDATA.C` (`DamageInventory`, `ObjWorn`), `obj/USEITEMS.C` (`decode_obj_spell`), `motion/PLAYMOVE.C` (frames, Haste). Read, not run. Items marked *to trace* are not read yet.

## B1. What the tab does

1. Pick an enemy from a list grouped by dungeon level (from `level-monsters.json`: 177 rows, one per creature type per level, with count, stored HP values and powerful count; expandable to single placed monsters).
2. Pick **melee** or **ranged**, and N (default 1000, configurable up to 10^6).
3. Run N seeded fights. Show: outcome counts (victory, death, monster flees, timeout) with Wilson intervals; fight length; damage dealt by source; damage received per body part with armour absorbed; hits, misses, criticals.
4. **All enemies** button: runs the same for every enemy on every level (586 combat-capable monsters) and plots how many the current character can beat.
5. The character panel (shared with the Skills tab) gets: equipment slot editor (item, quality, enchantment), a buff list, and the easy-mode flag. PLAYER.DAT loads equipment slots only (B3).

Engine: Monte Carlo in a Web Worker pool (the Skills tab stays exact and synchronous). The per-hit pieces (to-hit grade, damage dice, armour) also exist as exact distributions so the tests can check the simulator against them (B10).

## B2. No movement, two engagement modes

Nobody moves. **Melee**: the two stand facing each other in reach, so `hitangle` is 0 (facing: `(h + 12 - (h + 4)) & 7 = 0`); an optional "attack from the side/behind" (hitangle 1..4) for the player's blows only. **Ranged**: the monster is held at a fixed distance in line of sight (default 4 tiles, adjustable).

- Player ranged: a launcher in the weapon hand (ammunition unlimited, since the pack is not read), and/or **one attack spell** chosen from the castable list (B3, "Attack spell in ranged fights").
- Monster ranged: a monster with a missile in `arms[0]` fires within 4 tiles; a caster (creature `offensive_spells_flag`) casts within 8 tiles. A melee-only monster cannot hurt the player at range: the fight is simulated as normal and ends in a victory or a timeout, and the result card leads with damage per second and time to kill rather than the outcome split. Non-casters at range are bound to fight, so they never flee either.
- A monster in melee reach only melee-attacks, even if it is a caster (`crit_offense` takes the reach branch first).

## B3. Player model

Everything is derived from PLAYER.DAT plus the panel's overrides, then recomputed the way `FixPlayerEquips` does.

**PLAYER.DAT equipment only.** Read the 28 inventory slot words at workspace offset 0x23 (file 0xF8); a slot value is an object link: `value >> 6` is the saved-object number, 0 empty (validated on the sample: slot 11 = 64 is object 1, at file 0x138). Keep slots 0 to 10 only: 0 head, 1 torso, 2 gloves, 3 legs, 4 boots, 5 and 6 shoulders, 7 and 8 hands (8 minus `lefty` is the weapon hand, 7 plus `lefty` the shield hand), 9 and 10 rings. Slots 11 and up (pack and bags) are ignored. For each equipped object read its 8-byte record (item, quality, is_quant, enchanted flag, link) and follow its own link to the one spell object it may carry (`decode_obj_spell`); nothing else is read. **Validated on the second save (2026-10-24, `uw1-data/tools/read_playerdat.py`, the reference reader the TypeScript one is tested against):** STR 25, DEX 17, INT 18, HP 35/35, mana 2/2, Attack 12, Defense 6, Sword 9, Acrobat 5, all as you described; the stored XP is 69, so the display is XP / 10 = 6 (FORMATS.md's "in tenths" confirmed). Equipment decoded: dagger quality 15 in slot 7 (weapon hand `8 - lefty`, lefty = 1 in both saves), wooden shield quality 27 in slot 8 (shield hand `7 + lefty`), leather leggings quality 7 in slot 3, and the lit torch in slot 5 (a shoulder slot, where lights go; no combat effect). Three pack slots are present and ignored. Derived: armour torso 1, gloves 1 (the shield), legs 1, head 0; defence 6 + 9/2 = 10 (the dagger's skill is Sword). The first save (nothing equipped) stays as the empty-equipment fixture. The `lefty` name in the header is provisional: with lefty = 1 the weapon is in slot 7, which you call the right hand.

**Runes, the one inventory exception.** The rune bag is not in the inventory list: it is 3 bytes in the player record at 0x44, one bit per rune (`bit 7 - (rune & 7)` of `runebag[rune / 8]`, RUNES.C `add_rune`), runes numbered alphabetically An, Bet, Corp, Des, Ex, Flam, Grav, Hur, In, Jux, Kal, Lor, Mani, Nox, Ort, Por, Quas, Rel, Sanct, Tym, Uus, Vas, Wis, Ylem. Your save has Bet, In, Jux, Lor, Ort, Sanct; the first has none. The shelf (the three runes laid out for the next cast, 0x47) is read too but not used.

**Derived values** (`PLAYDATA.C`, `COMBAT.C`):

| value | formula |
|---|---|
| armour per zone | zone 0 torso: slot 1; zone 1 gloves: slot 2; zone 2 legs and boots: slots 3 and 4; zone 3 head: slot 0 (`defence_slot_index = {3,0,1,2,2,0}`, loop over slots 0 to 4 only); each item adds `armor_val = (quality x table_protection >> 6) + 1`; a shield in the shield hand (armour minor 3, in-class 11 to 15) adds its value to zones 0 and 1. Shoulders and rings add no base armour, only their enchantments |
| armour bonuses | the best Armour-class spell level is added to all four zones; a worn item's toughness enchant adds to its own zone (shoulders and rings: zones 0 and 1; the loop runs twice for them and adds the toughness to zone 0 each time, as the code reads) |
| player defence (monster to-hit target) | Defense + (skill of the wielded weapon's kind) / 2: Sword, Axe or Mace by the weapon's skill clamped to 3..5, Barehand when unarmed or the item is not a hand weapon |
| to-hit modifier per zone (`cmbModTH`) | the "protect minor 1" spell adds 3 to every zone; a worn item's to-hit enchant adds (minor & 7) + 1 to its zone. This is subtracted from the **monster's** to-hit value (`askill -= cmbModTH[hitloc]`); it is not armour. (Appendix A of v3 called it armour protection; that was wrong.) |
| resistances | protect minors 5 to 9 set resist bits 0x40 missile, 0x08 fire, 0x10 poison, 0x01, 0x02 (`damage_protection_flags`); applied by `check_res` before armour is considered |
| easy mode | PLAYER.DAT byte 0xB4 (the sample has it set): player to-hit +7, damage taken halved after armour. Exposed as a toggle because it changes every result |
| HP | PLAYER.DAT current health (max from the record); default is full. The player never flees: the fight goes on until one side dies, the monster flees, or the time limit |

**Melee attack** (`DoPlayerWeapon`, `player_attack`, `frp_check`):

- to-hit value = Attack / 2 + weapon skill + DEX / 7 (+7 easy) + weapon to-hit enchant + hitangle, graded by `skill_check` against the monster's `defence`; grade 2 is a critical, 1 a hit, 0 and -1 misses. A -1 against a non-passive monster wears the weapon (`DamageInventory`, 2d3).
- damage input = weapon damage byte for the swing kind + STR / 9 + weapon damage enchant; critical multiplies it by 1 or 2 at even odds. Barehand: Barehand x 2/5 + STR / 6 + 4.
- swing: the nine view cells. Cells 1-3 (bottom row) stab, 4-6 slash, 7-9 bash; the cell also sets the blow's height (`swing / 3`: cells 1-2 give 0, 3-5 give 1, 6-8 give 2, cell 9 gives 3, so low to high) and so the zone distribution on the monster. UI: pick one swing, or "best swing" (default: the swing kind with the highest damage byte, middle cell of its row).
- charge: the bar rises by the weapon's `speed` every 16 ticks (1/16 s) to 100; `power = min_charge + (max_charge - min_charge) x bar / 100`. Fixed at full charge (decision v4.2): `power = max_charge`, after `ceil(100 / speed)` sixteenths of a second of holding.

**Ranged attack** (`missile_thwack`): no to-hit roll at all. Damage = Missile-table damage of the ammunition x `scale / 256`, where `scale = Missile x 8 + 192`, minus 128 on a -1 grade and plus 192 on a 2 (check: Missile against 10; only when the ammo field is -64), full power (0x80), hitangle 0. Hit probability is a parameter (default 100%), because aiming and projectile flight are not modelled. Launcher and fire rate: *to trace* (`player_fire`, `missile_fire`).

**Wear.** A critical hit on the player wears the armour in the hit zone (`DamageInventory(slot, 2d4)`, scaled down by the item's toughness class from COMOBJ.DAT); a -1 swing wears the weapon. As the code reads, zones 0 and 1 map to the *shield hand* slot, zone 3 to the head, zone 2 to legs or, one time in five, boots. v1 tracks wear as a metric (events and quality lost) and models only one consequence: a weapon that reaches quality 0 is destroyed and the player continues barehanded. Armour values are not recomputed mid-fight, because the game only recomputes them at `FixPlayerEquips` calls.

**Buffs and debuffs the player can cast.** Spells are named by their rune words, decoded from the spell table (`runes = shelf[0] << 10 | shelf[1] << 5 | shelf[2]`, RUNES.C `try_cast`; for example 0 is In Lor, 1 Bet In Sanct, 2 Ort Jux). A spell is offered only if all three rules from `player_cast` hold, with mana taken as full:

1. **Runes**: every rune of the spell is in the rune bag.
2. **Circle**: `(level + 1) / 2 >= circle` (circle = index / 6 + 1), so circle 1 at levels 1-2, circle 2 at 3-4, ... circle 8 at 15-16.
3. **Mana**: `3 x circle <= max mana`. Selecting several spells spends from one budget: the total cost must fit in max mana, and at most three can be active at once (`set_curmagic` refuses a fourth).

Spells that fail a rule are listed greyed out with the reason ("needs 3 mana", "needs level 5", "missing rune Flam"), so the panel explains itself. Each offered spell shows its cast odds from the Skills tab check (`Casting + 5` against `2 x circle`: success, fizzle, backfire). The fight starts with the chosen spells active, cast at 100% success. A switch **"pay buff mana"** (default on) subtracts their total cost from the starting mana, which matters when an attack spell is also chosen. v1 does not model failed buff casts or durations (durations are `2d3`, `2d8 + 6` or `3d20 + 24` duration checks by the spell's stability flag, `set_curmagic`; shown as information).

Your save: level 1, 2 max mana, runes Bet In Jux Lor Ort Sanct. Bet In Sanct (+2 armour), In Lor and Ort Jux pass the rune and circle rules but each needs 3 mana, so **nothing is castable**; In Jux, Bet Sanct Lor, Sanct Jux and In Sanct also need a higher level.

Combat-relevant spells (from `spells.json`; the effect column is what the code does, traced in `player_affected_by`, `xt_spells` and `do_spell`):

| spell (index, circle) | runes | effect in the simulator |
|---|---|---|
| 1 (c1), 17 (c3), 42 (c8) | Bet In Sanct; In Sanct; In Vas Sanct | Armour class, +2, +3 or +5 on all four zones; the best one counts |
| 6 (c2) | An Sanct | protect minor 1: -3 on the monster's to-hit, every zone |
| 22 (c4) | Sanct Flam | resist fire (bit 0x08): Fireball and Flame Wind do nothing |
| 27 (c5) | Grav Sanct Por | resist missiles (bit 0x40): sling stones, arrows, Magic Missile |
| 12 (c3) | Rel Tym Por | **Speed** (xt 0 becomes active spell xt 2, `Hasted`): monster frames halved, so monsters act at half rate |
| 46 (c8) | An Tym | **Freeze time** (xt 11, `TimeStop`): monsters do not update at all; shown, but marked "trivial win while it lasts" |
| 8, 19, 30 | In Bet Mani; In Mani; Vas In Mani | heals: v1 only as "start the fight at full HP" (no mid-fight casting) |
| 10, 25, 37, 21, 33 | Quas Corp; An Corp Mani; In Mani Rel; Nox Mani; An Ex Por | **debuffs on the enemy** (class 7, `nail_1area`: fear, ward undead, charm, poison, hold); effects *to trace* (`sp_fear` ... `sp_hold`) before they are offered |
| 4, 13, 39 | Sanct Hur; Bet Sanct Lor; Vas Sanct Lor | stealth only: hidden in combat |

Correction to v4's first draft: it had "Haste = index 16" by matching the xt minor number. The spell table's xt minor is `xt_spells`' case number, not the active-spell number; index 16 (Sanct Jux) is one of the object spells, and Speed is index 12.

**Attack spell in ranged fights.** In ranged mode the player may pick one attack spell from the same castable list (runes, circle, mana): the missile spells Ort Jux (Magic Arrow) and the higher ones the table holds. Modelled from `player_cast` and `release_missile`:

- each attempt rolls `skill_check(Casting + 5, 2 x circle)`: grade 2 or 1 casts; **0 fizzles** (`fail_spell(2)`, returned before any mana is taken, so it costs only time); **-1 backfires**: the spell becomes a backfire of strength `circle / 2`, which does `(circle / 2)` d8 damage to the player but never takes him below 3 HP (`backfire`), and the full `3 x circle` mana is spent. For circle 1, `circle / 2 = 0`, so a backfire costs mana and does no damage. (A grade 2 is not a special "critical cast": it casts like a 1; the self-damage comes from the -1.)
- a successful missile spell spends `3 x circle` mana when it is released and launches the Missile-table projectile (Magic Missile 8 damage, type 0x43 magic and missile; Lightning 16, 0x23; Acid 8, 0x10; Fireball 28, 0x0B) with no to-hit roll, through the shared pipeline with the monster's armour, and through `check_res` (magic resistance is a chance).
- between casts the game enforces `spell_delay = (2 x circle - level) x 4 + 0x40` clock units (1/256 s), about 0.25 to 0.3 s; aiming adds 1 s per cast (decision v4.2).
- mana: starts full (minus buff costs when the switch is on); regenerates through the Mana check `skill_check(Mana, 10)` (+grade if > 0) every third duration check, and duration checks run every 21 s (`DurCount > 0x14` seconds in INTERACT.C), so about once a minute: included, though it rarely matters inside a fight.
- policy: cast while mana allows; then fall back to the launcher if one is equipped; otherwise the player stops attacking and the fight runs to the time limit. Chart lines: casts, fizzles, backfires, self-damage, mana left.

**Enchantment editor.** Per equipped item: quality 0..63 and an enchantment chosen from the combat-relevant set, encoded as the game does (class in the link's bits 4-8, effect in bits 0-3, from `decode_obj_spell`). Class 12: effect bit 3 = damage (weapon) or toughness (armour), otherwise to-hit (weapon) or to-hit protection (armour); magnitude (effect & 7) + 1. Other classes (armour, protect, xt) act exactly as the same spell does, through `player_affected_by`. Quality changes armour (`armor_val`) and nothing about weapon damage.

## B4. Monster model

Per instance, from `level-monsters.json` plus `objects.json`. Starting HP has three modes: **stored** (the placed monster's own HP, default), **roll** (a fresh `avghit x (16 + rand % 24) / 32` each fight, the game's formula for a newly made critter), or **set** (any value the user types).

- **Timing.** One monster step is 4 frames of 16 ticks of the 256 Hz clock, 0.25 s (doubled under Speed). The simulator advances in 1/16 s ticks so player charge (1/16 s granularity) and monster steps line up.
- **Melee.** Each step in reach (squared distance <= 0x64): 25% starts an attack; otherwise the attack-frame counter k rises by 1 (cap 15). The attack slot is picked by the creature's `prob` percentages, the blow lands 5 steps later with charge `atk_charge[k]` (50, 60 ... 255) and the counter resets. Expected charge about 81 (x0.63 damage), cycle about 9 steps, as computed earlier.
- **Hit.** `skill_check(attacks[slot].chance + equip / 2 (+7..12 if powerful) - cmbModTH[zone], player defence)` (hitangle 0). Grade 2 = critical (damage x1 or 2), 1 = hit, 0 and -1 = miss.
- **Damage.** `attacks[slot].damage` (+ STR / 5 = 0 for every creature in this OBJECTS.DAT, + 4..15 if powerful), critical multiplier, then the shared pipeline (B5). Zone: the blow's height is `monster z + height x (swing / 3) / 3` with swing 0..8 uniform, against the player's height box.
- **Missile** (`arms[0]` item in 0x10-0x1F; only goblin types 0x4D and 0x4E with sling stones in this data): in range (< 4 tiles), each step fires with chance (DEX + 1) / 192; lands 5 steps later; damage from the Missile table (5), no to-hit roll, always hits, damage type `-ammo` (0x40), zone from heights, shared pipeline.
- **Spells** (`caster` > 0, not in melee reach): each step a defensive spell from slot 3 with chance caster / 256, else (offensive flag set, within 8 tiles, in line of sight) an attack spell with chance caster / 128, slot 1 eleven times in sixteen else slot 2. Cast takes 5 steps. No mana, no cooldown, no skill check. Missile spells (Magic Missile 8, Lightning 16, Acid 8, Fireball 28) damage-type bits are `-ammo` (0x43 magic+missile, 0x23 cold+magic, 0x10 poison, 0x0B fire+magic), so resist buffs apply; they use the shared pipeline with armour. Area spells (Sheet Lightning 6d5, Flame Wind 10d6) hit by `damage_square` straight into `damage_item`: no armour, only resistances; their geometry (squares ahead of the caster) is *to trace*. Slot-3 heals do nothing (the target argument is null, read from `do_spell`); slot-3 *Summon Monster* (Mage 0x6A) and the two xt effects are flagged, not simulated, in v1.
- **Flee** (`should_i_flee(avghit, hp, nerve, damage)`), evaluated each time the monster has been hit and reaches its next step: never when `hp > 3/4 avghit` or `hp < 1/8 avghit`; always when the damage taken since the last evaluation exceeds `avghit / 2`; otherwise flees when `hp x 16 / avghit + rand % 4 <= 15 - nerve`. `nerve` is the low nibble of creature byte 0x1C, to be added to `objects.json`. A monster that is not adjacent (tile distance squared above 2) and has its offensive-spell flag clear is "bound to fight" (`b19 bit 5`) and never flees; in melee mode the test passes and flight is possible, at range only offensive casters can flee. A flee ends the fight as outcome **flee** (it escapes; no pursuit).
- **Resistances** (COMOBJ.DAT `resist`, applied by `check_res`; melee is type 0x04 physical). From the file: skeletons, ghouls and ghosts carry the undead flag 0x80 (it marks them for spells, it is not a damage resistance); ghosts also resist poison; the Fire Elemental and item 0x7B resist fire; item 0x7C resists everything, physical included, so a fight with it ends as **timeout**. No ordinary creature is immune to weapons.
- **Powerful.** +7..12 to hit, +4..15 damage on its attacks, its armour x5/3 against the player's blows, kill XP x1.5-2.9.

## B5. One blow, exact pipeline (shared by melee, missiles, spells)

1. Zone from `pickloc(defender box bottom, top, blow bottom, top)`: blow centre below the defender's bottom: zone 2 (low); above its top: zone 3 (high); otherwise inside: pick 2 or 3 by the half, else 0 with 2/3 and 1 with 1/3. Missiles add 4 to the zone (the armour index is zone mod 4). Boxes come from COMOBJ.DAT heights and a shared floor z.
2. To-hit grade from `skill_check` (not for missiles and spells).
3. `damage` (after the critical multiplier) is raised to at least 2, then rolled as `damage / 6` d6 plus 1d(`damage % 6`).
4. `ddone = roll x power >> 7`, plus `hitangle`.
5. Subtract the defender's armour for that zone (255 means use zone 0; x5/3 for a powerful defender against the player's blows); not below zero.
6. Player defender and easy mode: `ddone >>= 1`.
7. `check_res` with the damage type bits (magic is resisted by chance `rand % 3 < (resist & 3)`; other bits cancel the damage entirely).
8. `damage_critter`: HP minus damage, death at 0; on the monster, `damage_taken += damage` for the flee test.

Steps 3 to 5 are a sum of independent dice then a clamp, so the one-blow damage distribution is exact by convolution; the tests use it.

## B6. Simulator

- Seeded PRNG (mulberry32 or sfc32), one stream per worker, reproducible from a displayed seed.
- State per fight: player HP, monster HP, monster damage-since-decision, attack counters, player charge timer, player and monster action timers, weapon quality. Event loop in 1/16 s ticks; stop at death, flee, or a time limit (default 120 s of game time; configurable) which is reported as **timeout**.
- Player policy v1: attacks continuously with the chosen swing at the chosen charge (melee), or with the chosen attack spell then the launcher (ranged); never retreats; no healing or potions during the fight. Monster policy: as B4.
- Per fight record (typed arrays, no objects, to allow 10^6 runs): outcome, duration, player HP left, monster HP left, damage dealt and taken, per-source and per-zone counters, hits, misses, criticals, wear events. Aggregates are merged across workers.
- All enemies: the work is split by enemy across workers. 586 combat-capable monsters (503 distinct level-type-HP-powerful combinations once identical ones merge; 71 level 9 and inert entries have 0 average or current HP and are left out) x N x about 600 ticks is about 3 x 10^8 ticks at N = 1000: seconds to tens of seconds, with a progress bar and a cancel button.

## B7. Output, single enemy

1. Outcome bar and table: victories, deaths, monster flees, timeouts, each with count, percent and a 95% Wilson interval. When the monster cannot hurt the player (melee-only monster in a ranged fight), the card leads with damage per second, time-to-kill distribution and the share of fights finished within the time limit.
2. Fight duration histogram, split by outcome; player HP remaining on victories; monster HP remaining on deaths and flees.
3. **Damage dealt**, stacked by source, per fight (mean with spread) and as a total: weapon damage byte, STR bonus, weapon enchantment, critical extra, plus a separate negative bar for armour absorbed and resistance cancellations. The game does not track sources: damage is rolled once from the summed input, so the split is by proportional allocation of each blow's final damage over the components of its input (base : STR : enchant : critical extra) and the flat hit-angle term; an alternative counterfactual mode (paired runs with and without the enchantment on the same random stream) is offered for the enchantment line only.
4. **Damage received per body part** (torso, gloves/arms, legs/boots, head): hits landed, mean damage taken, mean armour absorbed, split into armour item, armour spell and toughness enchantment by their share of the zone's armour value; plus misses (with the to-hit protection effect), easy-mode halving and resisted damage as separate lines. Also by monster attack slot (melee 1-3, missile, spell).
5. Hit/miss/critical counts for both sides; weapon and armour wear events.
6. Average XP per victory (`exp x 4 + 2d(exp)`, scaled for powerful).

## B8. Output, all enemies

Filters first: include trap-spawned monsters (yes), include non-hostile creatures (yes; they fight when attacked), exclude entries with 0 average HP (inert level 9 objects), melee or ranged, win threshold (default 90%).

1. Strip chart: x = enemy (grouped by level, ordered by win rate), y = win probability, point colour = dominant non-win outcome (death, flee, timeout), with the threshold line.
2. Cumulative curve: x = win-probability threshold from 0 to 100%, y = number of enemies defeated at or above it; the chosen threshold is marked and the count printed ("412 of 657").
3. Per level bars: defeated vs not.
4. Table: level x creature type with win rate; click a row to open it in the single-enemy view.

## B9. Data additions this needs

| item | source | status |
|---|---|---|
| `comobj.json`: height, radius, mass, resist byte, quality class (toughness), render, for every item id | COMOBJ.DAT | **done** (heights: player 23, goblins and skeletons 20, giant spider 14, rats, bats, worms and slugs 9) |
| creature `nerve` (low nibble of byte 0x1C) | `objects.json` | **done** |
| attitude names (0 hostile, 1 upset, 2 mellow, 3 friendly) | `critter.h` | add to README and JSON notes |
| damage type per missile = -ammo bits | `objects.json` missiles | **done** (`damage_type`) |
| buff list, rune words | `spells.json` | **done** (`runes`, `rune_words`); class 7 debuff effects still to trace |
| spell, creature and item names | STRINGS.PAK | later; effect labels until then |
| equipped-item records, rune bag | PLAYER.DAT | **done** in the reference reader, validated on the second save |

## B10. Tests

- **C cross-check of the pipeline** (same method as `skill_check`): a small C program copies `pickloc`, the dice conversion, the armour clamp, `check_res` and `should_i_flee` verbatim and enumerates their inputs (all zone geometries, all `hp x damage x nerve x rand%4`); the TypeScript versions must agree exactly. The monster attack-frame process (25% start, counter, charge table) is checked against its exact distribution (geometric, cap 15).
- **Statistical:** simulated one-blow damage histograms against the exact convolution (chi-square), simulated outcome frequencies against hand-solvable cases (a monster with 1 HP and a 100% hit chance must lose in the first blow; zero armour and fixed damage give a known mean time to kill).
- **Invariants:** damage dealt equals the monster's HP lost; per-source and per-zone damage sums equal the totals; outcome counts sum to N; same seed same result; the all-enemies run agrees with the single-enemy runs.
- **Data:** the equipment reader against a second PLAYER.DAT with gear; `armor_val` and defence against stored values where the file has them (`maxhealth`, `defence` is not stored, so only HP and weight).
- **Sanity ladder (checked by eye and by monotonic tests, not asserted from memory of the game):** weaker enemies have higher win rates than stronger ones for the same character; adding armour, a better weapon or a buff never lowers a win rate.

## B11. Not modelled in v1 (stated so the numbers are read correctly)

Movement, distance closing and kiting; line of sight and projectile flight (ranged hit probability is a parameter); player healing, potions, HP regeneration, buff casting during the fight (buffs are pre-cast), attack spells in melee fights; monster summoning and slot-3 spells other than the heal no-op; multiple enemies at once; ally critters; the dying animation; armour value recomputation as armour wears; the other xt spells; hunger, fatigue, drunkenness and poison effects on the player; the 16-bit overflow in the powerful-XP product (shown as the nominal value).


# Both tabs

## Milestones

1. Scaffold, tabs, `gradeCounts`, the C cross-check harness for `skill_check`. Green before anything else.
2. Skills tab: grade bars and score distribution for one scenario; manual value and target inputs.
3. Character panel (collapsible, flowing layout), manual entry, derived values.
4. PLAYER.DAT reader: attributes, skills, equipment slots 0-10; fixtures and tests.
5. Skills tab: check catalogue with values and targets filled from the character; compound models in order 1, 12, 13/14, 20; curve, heatmap, overlay; URL state.
6. Data: done for `comobj.json`, `nerve`, missile damage types, rune words; port `read_playerdat.py` to TypeScript with both saves as fixtures.
7. Trace the remaining combat unknowns (below), each with a short note in this plan.
8. Combat core: blow pipeline and `should_i_flee`, with the C cross-check harness; exact one-blow distributions.
9. Combat tab, melee: enemy picker, simulator, outcome and damage charts for one enemy.
10. Combat tab, equipment editor, buffs, enchantments; ranged mode.
11. All-enemies run and its graphs.
12. UW2 later.

**Combat unknowns to trace before step 9:** the player's swing timing (animation frames between press, charge and strike: `weap_frame`, `set_screen_frame`); `player_fire` and `missile_fire` (launcher damage, fire rate); the class 7 debuff effects (`sp_fear`, `sp_ward_undead`, `sp_charm`, `sp_poison`, `sp_hold`); area-spell geometry (`gronk_area`); `duration_check` if buff durations are ever modelled; goal numbers (`GOAL_*`) for the level data; how `crit_attack` resets the attack-frame counter when the player is out of reach for a step.

## Open questions

1. (Skills tab) Character-creation odds (check 20) in v1 or later?

Resolved 2026-10-24 (v4.2): new local repo; aiming 1 s; always full charge.

Resolved later on 2026-10-24: the player never flees; melee-only monsters at range are simulated as normal; HP stored by default with roll and set; buffs pre-cast at 100% with an optional mana charge; one attack spell allowed in ranged fights with fizzle, backfire and mana modelled.

Resolved 2026-10-24: COMOBJ.DAT received and parsed; a second PLAYER.DAT with gear validated the equipment reader; the first save's class question is dropped (it no longer matters for any check).

# Starting the build (for a new session)

This plan, `uw1-data/` (JSON, `extract_uw1.py`, `read_playerdat.py`, README) and the two PLAYER.DAT fixtures are the whole hand-off; nothing else from the planning conversation is needed. In a new session:

1. Create the repo (Vite + TypeScript, d3, Vitest, Playwright); copy `uw1-data/json/*.json` to `src/data/` and the two saves to `test/fixtures/` (`player-empty.dat`: the first save, no gear, no runes, easy mode on; `player-karl.dat`: the second, expected values in section 4).
2. Clone https://github.com/abedegno/underworld-exhumed next to it for the C sources the plan cites (the C cross-check harnesses copy functions from it verbatim).
3. Follow the milestones in order; milestone 1's `skill_check` harness must be green before anything else.
4. Regenerate the JSON only if the extractor changes: it needs the game's OBJECTS.DAT, LEV.ARK and COMOBJ.DAT from the DATA folder of a UW1 install (not shipped in the repo).

# Build status (2026-10-24)

The site is built in this folder (see README.md): Vite + TypeScript + d3, both tabs, the shared character panel, the PLAYER.DAT reader, a Web Worker pool, and the all-enemies run. Tests: `npm test` (C cross-check of `skill_check`, `pickloc`, the damage dice, `check_res`, `should_i_flee` against verbatim copies of the C; PLAYER.DAT reader against `read_playerdat.py` on both saves; simulator against the exact one-blow distributions; invariants and monotonic checks) and `npm run smoke` (Playwright).

Traced while building, and how the code now reads (these refine Part B):

- **Player swing timing** (`PANELS.C adjust_weapon`, `update_screen`): the weapon picture steps one frame per 32 clock units (2 ticks of 1/16 s). Frames 0..3 wind up; charging starts only at frame 3 (`play_pow += speed` per 16 units after the first frame sets `otime`); on release frames 4, 5, 6 play and the blow lands at frame 6; frames 7..9 return to ready. A full-charge swing is about 20 + ceil(100 / speed) ticks: a dagger about 1.5 s. `swingTimes()` in `src/combat/fight.ts`.
- **Launchers** (`MISSILE.C player_fire`, `OBJPHYS.C missile_newhit`): the launcher adds nothing to damage. Damage is the ammunition's Missile[] damage (sling stone 5, arrow 8, bolt 10) × (Missile × 8 + 192 ± the skill check) / 256, then `missile_thwack` at power 0x80. Cycle: frames 0..3, aim (1 s), fire, back to ready.
- **Monster probe for melee**: `resolve_attack` uses a probe of height (wsize × 2 + 1) × 4 = 20 for both sides, starting at z + height × (swing / 3) / 3; the hit location comes from `pickloc` against the defender's box.
- **ObjWorn**: only slots 0..4, the rings (9, 10) and a shield in the shield hand count as worn. Shoulder slots (5, 6) and the weapon hand never apply item enchantments through `player_affected_by`; the weapon's class 12 enchantment acts only through `DoPlayerWeapon`. (B3 said shoulders add enchantments: corrected.) The shield test is items 0x3B..0x3F, so the Shiny Shield (0x37) adds no armour.
- **Armour spell** is applied after the item enchantments (`parse_spells` adds the high nibble of `bonuses` to all four locations).
- **Slingers' range**: `crit_missile_attack` needs `tdistsqr < 0x10`, so goblins with sling stones fire from 3 tiles but not from 4. The ranged default distance is therefore 3 tiles, not 4.
- **Area spells** (`nail_area`, `process_area` in AREA_RANDOM mode): 3d4 activations over a 6 × 6 block of squares (the loop bounds are inclusive) around the square 4 ahead, each square taken with chance count / 28; Sheet Lightning hits its square (6d5, magic), Flame Wind its square and the four beside it (10d6, fire and magic). They go straight to `damage_item`: no armour, no easy-mode halving. Simulated exactly with the target straight ahead.
- **Weapon wear** on a −1 against a non-passive monster: `rollem(2, 3) >> qualclass` quality (class 3 never wears); a weapon at quality 0 breaks and the fight continues barehanded.
- **Flee is common**: with the damage since the last evaluation above avghit / 2 the monster always flees once it is under 3/4 of avghit. Small monsters (rats, slugs, worms, bats) flee often against an early character; the all-enemies view can count flights as beaten.
- **Breaking equipment recomputes the player** (correction to B3, found in review): when `DamageInventory` destroys an item it calls `FixPlayerEquips` (`INVDATA.C:443`), so a broken weapon drops defence to Defense + Barehand / 2 and a destroyed armour piece (or any piece after wear) changes the armour values. The simulator now removes the item and recomputes. Wear from a critical goes to the slot for the location (0 and 1: the shield hand; 2: legs, one time in five boots; 3: head), only for a worn item, shifted right by its `qualclass`. Not modelled: the sheathe/redraw animation `load_weapon` starts after a weapon breaks.
- **Creatures that ignore fights** (`bA_1`, byte 0x0A bit 1): `critter_mv` skips the hit reaction, so they never run `should_i_flee` and a non-hostile one stays peaceful when hit. Among combatants only the Wisp has it. Now in `game.json` as `ignoresFights`.
- **Area spells that miss** do not alert the monster (only struck squares reach `damage_item`).
- **Launcher recovery**: after `missile_finish` the next `adjust_weapon` goes straight to ready (`swung`), so a new shot can start one tick after the next 32-unit boundary.
- **Open**: the charge release may be one tick earlier or later depending on the game's frame rate (`player_attack` runs per frame); the model uses one frame per tick.
- **Experience** (added after the first build): only a kill pays. `damage_critter` (AI.C:1495) calls `player_killed_a` when the critter dies and the attacker is the player (also through his missiles and spells); a monster that flees gives nothing. exp × 4 + 2d(exp); powerful: × (24 + rand % 24) / 16 computed in a 16-bit int (COMBAT.C:843), which wraps for powerful monsters with exp above about 116 (the Headless, Fighter 0x68, Great Troll, Dread Spider, Ghost 0x61, Dire Ghost, Feral Troll, Shadow Beast in LEV.ARK) and can take experience away. `player_get_exp` then floors a loss at 0, ignores gains above 0x17700 and halves gains (+1) when the level is above twice the dungeon level plus two. The Combat tab shows total and per-fight XP, fights to the next level and skill point; the all-enemies view the expected XP for fighting each monster once. `killXp()` in `src/combat/fight.ts`.
