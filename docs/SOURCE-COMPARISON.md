# UW1 simulator against the game's source

This document compares the UW1 combat and skill-check simulator (`src/`) with the
decompiled DOS source of Ultima Underworld: The Stygian Abyss, function by function. It
records what agrees, what is a deliberate simplification, what was wrong and has been
corrected, and what is still missing.

## 1. Scope and method

**Game source.** `underworld-exhumed-enhanced`, HEAD `e4d83de` (2026-11), directory
`uw1/src`. Game code is cited as `uw1/src/FILE.C:line`. The repository's optional
enhancements (`ENHANCED(...)`, `#ifndef __TURBOC__` blocks) were ignored: only the DOS
behaviour counts.

**Byte-matched segments.** Every file used here compiles, with the original Turbo C
options, to the same bytes as UW.EXE: its first line names the target segment, and that
segment is listed in `uw1/matched.txt`.

| File | Segment | Used for |
|---|---|---|
| `combat/COMBAT.C` | seg022_230E | pickloc, frp_check, do_damage, player swing, missile_thwack, critter_attack, experience |
| `combat/DAMAGE.C` | seg023 | check_res, damage_item, damage_object |
| `combat/SPELLS.C` | seg038_3307 | cast, do_spell, heals, backfire, missile and area spells, damage_square, the spell table |
| `combat/RUNES.C` | ovr119 | player_cast |
| `combat/MISSILE.C` | seg025 | player_fire, critter_fire, spell_fire |
| `critter/AI.C` | seg007_1798 | critter_ai, critter_mv, crit_offense, crit_attack, crit_magik_attack, crit_missile_attack, should_i_flee, damage_critter, move_mobile |
| `critter/CREATURE.C` | ovr101 | creature_obj_init (rolled HP) |
| `game/PLAYDATA.C` | ovr133 | FixPlayerEquips, player_affected_by, parse_spells, armor_val |
| `game/PLAYTIME.C` | seg028_2985 | duration_check, set_curmagic |
| `game/SKILLCHK.C` | seg037_32E6 | skill_check, player_get_exp |
| `inv/INVDATA.C` | ovr120 | ObjWorn, DamageInventory |
| `motion/OBJPHYS.C` | seg029_29EE | missile_newhit, mob_to_static |
| `motion/PLAYMOVE.C` | seg034_2F89 | the frame clock, Haste, Freeze Time |
| `obj/EFFECT.C` | seg044 | mts_doanim (missile explosions) |
| `ui/INTERACT.C` | seg024_24DC | the 21-second duration timer |
| `ui/PANELS.C` | seg036_3087 | weapon animation frames |
| `sys/UTIL.C` | seg041_37AA | rollem |

**How claims were checked.**

- Code reading of the C above against `src/combat/{fight,blow,setup,exact}.ts`,
  `src/core/{character,skillcheck,rng,randdist,timed}.ts` and `src/data/gameData.ts`.
- EXE bytes, where a claim is surprising: the armour-spell bug was confirmed in
  `gamedata/UW/UW.EXE` (section 4.1).
- Data: `src/data/game.json` and `uw1-data/json/comobj.json` (extracted from OBJECTS.DAT,
  COMOBJ.DAT and LEV.ARK by `uw1-data/tools/extract_uw1.py`).
- Tests: `npm test` (Vitest). `test/source-comparison.test.ts` covers the corrections of
  this pass. `test/c-crosscheck.test.ts` runs verbatim copies of `skill_check`,
  `pickloc`, the damage dice, `check_res`, `should_i_flee` and `rollem` against the
  TypeScript; it needs `cc`, `gcc` or `clang` and was **skipped** in this pass because no C
  compiler is installed on this machine. `test/rng-vectors.test.ts` replays generator
  vectors measured on UW.EXE and passed.

## 2. Function-by-function comparison

Verdicts: **Exact** (same formula, same random draws, same order within the model);
**Model choice** (a deliberate simplification, section 3); **Corrected** (wrong before this
pass, section 4); **Remaining gap** (section 5).

### 2.1 Random numbers and checks

| Simulator | Game | Verdict | Note |
|---|---|---|---|
| `borland`, `makeRng` (src/core/rng.ts:67, 107) | Borland `rand()` (linked library) | Exact | `seed × 0x015A4E35 + 1`, bits 16-30. Replays UW.EXE vectors. |
| `Rng.int` (src/core/rng.ts:73) | `rand() % n` at each call site | Exact | Also used for `rand() & (2^k - 1)`, which is the same value. |
| `Rng.rollem` (src/core/rng.ts:74) | `rollem` (uw1/src/sys/UTIL.C:72) | Exact | `dice + Σ (rand() × sides) / 0x8000`; no draw when dice or sides is 0. |
| `skillCheck`, `gradeOfRoll` (src/core/skillcheck.ts:16, 25) | `skill_check` (uw1/src/game/SKILLCHK.C:48) | Exact | Thresholds 28, 15, 2. |
| `gradeCounts`, `modProbs`, `faceProbs` (src/core/skillcheck.ts:44, src/core/randdist.ts) | the same draws enumerated | Exact | Counts out of 32768. |

### 2.2 Player

| Simulator | Game | Verdict | Note |
|---|---|---|---|
| `derive`: armour from slots 0-4 and shield (src/core/character.ts:103) | `FixPlayerEquips` (uw1/src/game/PLAYDATA.C:397-409), `armor_val` (:364) | Exact | `(quality × protection >> 6) + 1`; shield items 0x3B..0x3F on locations 0 and 1. |
| `derive`: defence (src/core/character.ts:116-119) | `FixPlayerEquips` (uw1/src/game/PLAYDATA.C:410-425) | Exact | Defense + weapon skill (clamped 3..5) / 2; Barehand for no weapon or a non-weapon. |
| `derive`: `affect` class 3 and 11 (src/core/character.ts:123) | `player_affected_by` (uw1/src/game/PLAYDATA.C:235-262) | Exact | Protection +3 to every `cmbModTH`; resist bits from `damage_protection_flags`; Haste, Freeze Time. |
| `derive`: `affect` class 12 (src/core/character.ts:134-143) | `player_affected_by` (uw1/src/game/PLAYDATA.C:271-290) | Exact | Toughness of a ring or shield goes twice to location 0, as the code does. |
| `derive`: armour spell (src/core/character.ts:125, 164-171) | `player_affected_by` (uw1/src/game/PLAYDATA.C:231-234), `parse_spells` (:336-356) | **Corrected** | Was +level on all four locations; the game adds 0 (section 4.1). |
| `objWorn` (src/core/character.ts:79) | `ObjWorn` (uw1/src/inv/INVDATA.C:401) | Exact | |
| `spellStatus` (src/core/character.ts:205) | `player_cast` (uw1/src/combat/RUNES.C:245-248) | Exact | Level `(level + 1) / 2 ≥ circle`, mana `3 × circle`; runes as in `try_cast`. Checked against max mana for the panel, current mana in the fight. |
| `activeEffectOf`, `stabilityOf` (src/core/character.ts:183, 198) | `xt_spells` (uw1/src/combat/SPELLS.C:769, 811), `set_curmagic` (uw1/src/game/PLAYTIME.C:219) | Exact | Speed sets xt 2 (Hasted), Freeze Time xt 0; durations 1, 2d3, 2d8 + 6, 3d20 + 24 checks. |
| `meleeFrom` (src/combat/setup.ts:86) | `GetPlayerWeapon` (uw1/src/combat/COMBAT.C:538), `DoPlayerWeapon` (:572) | Exact, one case **Corrected** | to-hit Attack / 2 + skill + DEX / 7 (+7 easy) + enchantment; damage byte + STR / 9, or Barehand × 2/5 + STR / 6 + 4. A class-12 enchantment on a non-weapon held in the weapon hand now applies to the fist (section 4.6). |
| `playerProfile` launcher (src/combat/setup.ts:112) | `GetPlayerWeapon` (uw1/src/combat/COMBAT.C:545-553), `player_fire` (uw1/src/combat/MISSILE.C:89) | Exact | Ammunition's Missile[] damage; the launcher adds nothing. |
| `swingTimes` (src/combat/fight.ts:25) | `adjust_weapon` (uw1/src/ui/PANELS.C:799), `update_screen` (:336), `player_attack` (uw1/src/combat/COMBAT.C:650) | Model choice | One weapon frame per 32 clock units; charge `+speed` per 16 units from frame 3; strike at frame 6. The model uses 1/16 s ticks (one call of `player_attack` per tick), so the release can differ by one tick from a real frame rate; `while (elapsed > 0x10)` also needs one clock unit more for the first step. Always full charge (decision v4.2). |
| `shotTimes` (src/combat/fight.ts:35) | `player_attack` fire mode (uw1/src/combat/COMBAT.C:682-697), `missile_finish` (:604) | Model choice | Frames 0-3, a fixed aiming time, fire, back to ready. |
| `playerMelee` (src/combat/fight.ts:235) | `do_attack` (uw1/src/combat/COMBAT.C:491), `resolve_attack` (:232), `frp_check` (:282), `do_damage` (:333) | Exact, one draw **Corrected** | Probe z from `towhere / 3`, height `(wsize × 2 + 1) × 4`; `pickloc`; `skill_check(askill + hitangle, defence)`; critical ×1 or ×2; dice; `× power >> 7`; `+ hitangle`; creature armour (0xFF → location 0, ×5/3 powerful); `& 0xFF`; `check_res`. A miss still calls `damage_item(..., 0)`, so the monster reacts. The 2d3 of weapon wear is now drawn on every bad miss against a non-passive monster, bare-handed too (section 4.4). |
| weapon wear (src/combat/fight.ts:248-270) | `frp_check` (uw1/src/combat/COMBAT.C:316-320), `DamageInventory` (uw1/src/inv/INVDATA.C:419), `damage_object` (uw1/src/combat/DAMAGE.C:241) | Exact | Only class-0 weapons, `check_res`, `>> qualclass`, class 3 never wears; destroyed at quality 0, then `FixPlayerEquips`. |
| `playerShot` (src/combat/fight.ts:288) | `missile_newhit` (uw1/src/motion/OBJPHYS.C:105), `missile_thwack` (uw1/src/combat/COMBAT.C:761) | Exact within the model | `scale = Missile × 8 + 192`, −128 on −1, +192 on 2, only for ammunition with ammo field −64 (now checked; all UW1 ammunition has it); power 0x80, hitangle 0, location + 4. The hit chance is a model setting. |
| `playerCast` (src/combat/fight.ts:303) | `player_cast` (uw1/src/combat/RUNES.C:236), `backfire` (uw1/src/combat/SPELLS.C:231), `release_missile` (:250) | Exact within the model | `skill_check(Casting + 5, 2 × circle)`: 0 fizzles before any mana or delay; −1 is a backfire of `circle / 2` d8, never below 3 HP, full mana spent; delay `(2 × circle − level) × 4 + 0x40` units. Aiming time is a model setting, applied to every spell. |
| missile spell explosion (src/combat/fight.ts:201, 209) | `mob_to_static` (uw1/src/motion/OBJPHYS.C:483), `mts_doanim` (uw1/src/obj/EFFECT.C:318), `damage_square` (uw1/src/combat/SPELLS.C:861) | **Corrected** | Fireball and Lightning Bolt now burst on the target's square after hitting (section 4.2). |
| `areaHits`, `areaOnMonster` (src/combat/fight.ts:51, 223) | `nail_area` (uw1/src/combat/SPELLS.C:545), `gronk_area` (:487), `process_area` (:416), `sp_sheet_light` (:306), `sp_meteor` (:322) | Exact within the model | 3d4 activations; 6 × 6 block (inclusive loop bounds) around the square 4 ahead; each square with chance `count / 28`; up to five passes. Assumes open floor and an axis-aligned heading. |
| `killXp` (src/combat/fight.ts:73) | `player_killed_a` (uw1/src/combat/COMBAT.C:830), `player_get_exp` (uw1/src/game/SKILLCHK.C:70) | Exact | `exp × 4 + 2d(exp)`; powerful `(int16)(exp × (24 + rand % 24)) / 16`; loss floored at 0; nothing above 0x17700; halved + 1 above `2 × dungeon level + 2`. Only kills pay, also through missiles, spells and explosions. |
| mana regeneration (src/combat/fight.ts:488) | `duration_check` (uw1/src/game/PLAYTIME.C:118-127), `display_scr` (uw1/src/ui/INTERACT.C:242-253) | Exact within the model | One duration check every 21 s; the mana roll `skill_check(Mana, 10)` every third, `+grade` if positive. The phase is a model draw. |
| buff expiry (src/combat/fight.ts:475) | `duration_check` (uw1/src/game/PLAYTIME.C:89-108), `set_curmagic` (:219) | Exact within the model | A spell found at 1 ends, others lose 1; `FixPlayerEquips` follows. Buffs cast just before the fight. |
| poison on the player (src/combat/fight.ts:355, 490-497) | `critter_attack` (uw1/src/combat/COMBAT.C:807-810), `duration_check` (uw1/src/game/PLAYTIME.C:120-124) | **Corrected** | Was not modelled; now a poisonous bite poisons and the poison ticks (section 4.3). |
| HP regeneration | `duration_check` (uw1/src/game/PLAYTIME.C:128-140) | Remaining gap | Every 24th check (8.4 min). |

### 2.3 Monster

| Simulator | Game | Verdict | Note |
|---|---|---|---|
| step timing `interval` (src/combat/fight.ts:138) | `check_physics` (uw1/src/motion/PLAYMOVE.C:324-356), `move_physics` (:372), `move_mobile` (uw1/src/critter/AI.C:1547), `timetodo` (:1535), `critter_ai` (:1183) | Exact within the model | Frames of 16 units; a critter at rate 4 steps every 4 frames (0.25 s); Haste halves the frames (8); Freeze Time stops `move_mobile`. The initial phase is now a model draw (section 4.6). |
| `MonsterActor.step` sequences (src/combat/actor.ts:150) | `critter_ai` (uw1/src/critter/AI.C:1149-1180) | Exact | An attack, cast or shot started at frame 0 strikes on the fifth step; the counter `k` resets after a melee strike; a sequence under way is never interrupted. |
| `MonsterActor.step` hit reaction (src/combat/actor.ts:170) | `critter_mv` (uw1/src/critter/AI.C:1226-1265), `should_i_flee` (:1364) | Exact within the model | Only between sequences; bA_1 creatures skip it; `tdistsqr > 2` and no offensive spells sets "bound to fight" (b19 bit 5) for good; else `should_i_flee`; the damage tally is cleared in every branch. A flight ends the fight (model). |
| damage tally (src/combat/actor.ts:82) | `damage_critter` (uw1/src/critter/AI.C:1479), `OBJ_DAMAGE` (uw1/src/include/object.h:285) | **Corrected** | A byte that wraps; was capped at 255 (section 4.5). |
| melee start (src/combat/actor.ts:176) | `crit_attack` (uw1/src/critter/AI.C:442-455) | Exact within the model | `rand() % 4 == 0` starts; slot by `rand() % 100` over the probabilities (i capped at 2); else `k++` up to 15. Movement draws are left out (section 6). |
| `MonsterActor.melee` (src/combat/actor.ts:89) | `critter_ai` (uw1/src/critter/AI.C:1156), `critter_attack` (uw1/src/combat/COMBAT.C:788), `frp_check`, `do_damage` | Exact, draw order **Corrected** | `rand() % 9` swing, then powerful +7..12 to hit and +4..15 damage; probe height 20 from `z + height × (swing / 3) / 3`; `cmbModTH` off the to-hit; critical wears armour; power `atk_charge[k]`; player armour, easy halving, `check_res`. The swing used to be drawn after the powerful bonus. |
| `wearArmour` (src/combat/fight.ts:361) | `frp_check` (uw1/src/combat/COMBAT.C:306-312), `DamageInventory` (uw1/src/inv/INVDATA.C:419) | Exact | Slot `(hitloc + 1) & 3`: locations 0 and 1 wear the shield hand, 2 the legs (boots one time in five), 3 the head; only worn items; `check_res`, `>> qualclass`. |
| `armourAndApply` (src/combat/fight.ts:383) | `do_damage` (uw1/src/combat/COMBAT.C:361-379) | Exact | Player armour is `Creature[0x3F].armour`, which `FixPlayerEquips` fills. |
| ranged choice (src/combat/actor.ts:182) | `crit_offense` (uw1/src/critter/AI.C:361-368), `maybe_cast_defensive_spell` (:506), `crit_magik_attack` (:526), `crit_missile_attack` (:552) | Exact within the model | In reach: melee only. Else a caster: defensive spell (slot 3) with `rand % 256 < caster`, else with offensive spells and `tdistsqr < 0x40` an attack spell with `rand % 128 < caster`, slot 1 eleven times in sixteen. Else a slinger with `tdistsqr < 0x10`: `rand % 192 ≤ DEX`. Line of sight assumed. |
| `monsterSpell` (src/combat/setup.ts:156) | `cast` (uw1/src/combat/SPELLS.C:82), `do_spell` (:95), `release_missile` (:250) | Exact | Index ≥ 53 does nothing (UW1 has no packed special spells); missile spells map to items 0x17, 0x15, 0x14, 0x16; the target is null, so heals do nothing, and active spells, class 7 and xt spells are player-only. |
| `MonsterActor.missile` (src/combat/actor.ts:121) | `critter_fire` (uw1/src/combat/MISSILE.C:125), `missile_newhit`, `missile_thwack` | Model choice | Missile[] damage, no skill scaling, armour and easy mode apply. Always hits; location from `pickloc` against the player's middle. |
| `MonsterActor.area` (src/combat/actor.ts:130) | `nail_area`, `process_area`, `damage_square` | Exact within the model | No armour, no easy halving, `check_res`. |
| `MonsterActor.burst` (src/combat/actor.ts:143) | `mts_doanim`, `damage_square` | **Corrected** | New (section 4.2). |
| `critterDefender` (src/combat/duel.ts:60), arena | `frp_check` / `do_damage` / `critter_attack` with a critter as `hitobj` (uw1/src/combat/COMBAT.C:299-312, 357-379, 807) | Exact | To-hit against the defender's `Creature.defence` with no `cmbModTH` (only `if (hitobj == 1)`); its armour at the location, ×5/3 when powerful (`hitobj != 1 && OBJ_POWERFUL(def)`); no easy-mode halving, no poison (`critter_attack` poisons only `hitobj == 1`), no wear (`defender == 1`); a miss still calls `damage_item(…, 0)`. |
| `duel` (src/combat/duel.ts:88), arena | `critter_mv` hit reaction (uw1/src/critter/AI.C:1238-1240), `do_attack` ally test (uw1/src/combat/COMBAT.C:497) | Model | Critters only hit and react to each other when one is the player's ally; the arena takes one side as an ally so both fight and flee as they do against the player. Both stand still and step every 4 ticks from a random phase; on a shared tick half the fights let each side go first. |
| `monsterStartHp` roll (src/combat/fight.ts:89) | `creature_obj_init` (uw1/src/critter/CREATURE.C:86) | Exact, **Corrected** wrap | `avghit × (16 + rand % 24) / 32`, stored in a byte (only item 0x7C, avghit 250, wraps); the simulator keeps a minimum of 1. |
| `pickloc`, `meleeProbe`, `rollDamage`, `critMultiplier`, `creatureArmourAt`, `checkRes`, `shouldIFlee`, `ATK_CHARGE` (src/combat/blow.ts:15-119) | `pickloc` (uw1/src/combat/COMBAT.C:107), `resolve_attack` (:241-244), `do_damage` (:346-374), `frp_check` (:305), `check_res` (uw1/src/combat/DAMAGE.C:202), `should_i_flee` (uw1/src/critter/AI.C:1364), `atk_charge` (:92) | Exact | Same arithmetic, bytes masked where the C has bytes. |
| `playerBlowDist`, `monsterBlowDist`, `attackFrameDist`, `monsterExpectedBlow` (src/combat/exact.ts:33-110) | the same functions, enumerated | Exact | The armour fix reaches them through `P.armour`. |

## 3. Deliberate modelling choices

| Choice | Why | Effect on results |
|---|---|---|
| Nobody moves; melee face to face (hit angle 0, or the setting for the player's blows), ranged at a fixed distance. | Movement, path finding and terrain are a separate simulation; the question is the odds of the exchange. | In the game a critter in melee backs off, sidesteps and closes (`crit_attack`), and can step out of reach for a while, which delays its attacks. Real fights are a little slower and less regular than simulated ones. |
| The player always swings at full charge, with the cell chosen (or the best one). | Decision v4.2. | Damage per swing is the maximum; quicker partial swings are not explored. |
| Missiles land at once; a hit-chance setting stands in for aiming and flight; the monster's missiles always hit. | Projectile flight needs geometry and physics. | At 100% hit chance the player's ranged damage is an upper bound; so is the monster's missile damage, since its missiles never miss. |
| A fixed aiming time (default 1 s) per launcher shot and per spell, area spells included. | Decision v4.2: time to aim, click and recast. | Spell and shot rates are set by the setting, not by the spell delay (at most 68 clock units, 0.27 s), which never binds at 1 s. |
| A struck Fireball or Lightning Bolt bursts on the target's square. | Creatures and missiles have radius 2 and 1 (COMOBJ.DAT), so a struck missile rests within 3/8 tile of the target's centre: inside its tile unless the target stands near the edge facing the shooter. | The burst is added on every hit. A target near a tile edge would escape it in the game. |
| One monster; no allies, no kin joining (`critter_mv` crithit logic), no summons. | Single-enemy scope. | Group fights are harder than the numbers show. |
| A flight ends the fight as outcome "flee"; the player never flees. | Pursuit is movement. | Flight is counted, not followed. |
| Only hostile monsters attack before being hit. | `crit_guard` only attacks for attitude 0 (uw1/src/critter/AI.C:283-290). | Upset, mellow and friendly monsters fight once struck. |
| Monster time phase, duration-check phase and missile hit chance come from a separate model stream. | They are not game draws; drawing them from the game generator would shift its sequence. | None on distributions. |
| Buffs are pre-cast at 100% just before the fight; their mana optionally comes off the starting mana. | Plan v4.1. | Failed buff casts are not shown. |
| Area-spell squares are all open floor and the caster faces the target along an axis. | No map. | Walls in the 6 × 6 block would concentrate the activations on fewer squares (higher chance per square). |
| A miss of the launcher (hit-chance setting) neither wears nor wakes the monster. | It did not reach it. | Matches the game when the arrow misses entirely. |

## 4. Errors found and corrected in this pass

### 4.1 Armour spells added armour; the game adds none

- **Before.** `derive` added the best armour-spell level (Resist Blows 2, Thick Skin 3, Iron
  Flesh 5, or a worn item's class-2 enchantment) to all four hit locations; the panel
  labelled them "+2 armour", "+3", "+5".
- **Game.** `player_affected_by` keeps the level in bits 4..7 of `bonuses`
  (`*bonuses = (*bonuses & 0xF) + (minor << 4)`, uw1/src/game/PLAYDATA.C:232-233).
  `parse_spells` runs a four-pass loop whose increment is `bonuses = bonuses >> 1`
  (uw1/src/game/PLAYDATA.C:340), and then adds `(bonuses >> 4) & 0xF` to each location
  (:356). After four shifts that is the original bits 8..11, which are never set. UW.EXE
  has the same: in ovr133 `parse_spells` (file offset 0x7E31D) SI holds `bonuses`
  (`8B 76 06`), the loop ends with `mov ax,si; shr ax,1; mov si,ax` (`8B C6 D1 E8 8B F0`,
  file offset 0x7E38D), and the second loop reads `mov ax,si; shr ax,4; and al,0Fh`
  (`8B C6 C1 E8 04 24 0F`, 0x7E39F).
- **After.** Armour spells add 0 (`armourParts[].spell` is always 0); the level is kept as
  `armourSpellLevel` and the panel shows a note. The spells are still offered because they
  take a spell slot (at most three) and mana, as in the game. Labels, the enchantment menu,
  the per-zone armour column and the "absorbed by armour spell" bar were updated.
- **Effect.** Example: a level-10 character with Thick Skin against a Troll on level 3:
  death 99.9% now, 96.6% with the old +3 armour (20,000 fights).

### 4.2 Fireball and Lightning Bolt explosions were missing

- **Before.** A Fireball or Lightning missile did its Missile[] damage only.
- **Game.** Both items have ComObjData fate 9 and bounce 0 (`comobj.json`). A struck
  missile is used on its target (`missile_newhit`, uw1/src/motion/OBJPHYS.C:105), stops,
  and `mob_to_static` calls `mts_doanim` for fate 9 (uw1/src/motion/OBJPHYS.C:474-485).
  `mts_doanim` knows two items, `ITEM_FIREBALL` and `ITEM_LIGHTNING_BOLT`, and calls
  `damage_square(x, y, i + 1, who)` on the square where the missile rests
  (uw1/src/obj/EFFECT.C:318-336). `damage_square` damages every object there: kind 1 10d6
  of type 0x0B (magic and fire), kind 2 6d5 of type 3 (magic), through `damage_item`, so no
  armour and no easy-mode halving, only `check_res` (uw1/src/combat/SPELLS.C:828-875).
  `who` is the missile's shooter, so the player's bursts credit him with the kill.
- **After.** After a hit by the player's Fireball or Lightning spell, the monster takes the
  burst (dealt-damage part "explosion"); after a monster's Fireball or Lightning hits the
  player, he takes it (source "explosion"). Monster spell names say "(bursts: 10d6)".
- **Effect.** Large. Examples (20,000 fights each): a level-9 caster with 30 mana and
  Fireball against a Troll (55 HP) at range: 100% wins now, 100% timeouts before (two casts
  did not kill it). A bowman against Mage 0x67 (Lightning) at 3 tiles: death 83.7% now,
  36.4% before; against a Gazer 83.7% now, 25.6% before.

### 4.3 Poison was not modelled

- **Before.** Listed as not modelled; the creature's b0F was in the data but unused.
- **Game.** `critter_attack` passes the creature's b0F as `poison`; after a hit on the
  player, if `player->poison < poison` and `check_res(ThePlayer, 1, DMG_POISON)` lets it
  through, the player's poison becomes that level (uw1/src/combat/COMBAT.C:807-810).
  Every third duration check, before the mana roll, `dmg = player->poison--` and
  `damage_item(ThePlayer, 0, 0, 0, dmg, DMG_POISON)` (uw1/src/game/PLAYTIME.C:118-124).
- **After.** Both are simulated, on the same duration-check phase as the mana roll. Poison
  Resistance (protect minor 7, resist bit 0x10) stops the poisoning and the damage.
  Source "poison" in the monster's table; the poisoned count in a hint.
- **Effect.** Small in two-minute fights (one or two ticks): Dread Spider (poison 8) against
  Karl's save: death 9.2% now, 6.4% without poison. Rats, bats and Wolf Spiders mostly flee
  before a tick.

### 4.4 Bad-miss weapon wear drew its dice only with a weapon

- **Before.** `rollem(2, 3)` was drawn only when a wearable weapon was in hand.
- **Game.** `DamageInventory(slot, rollem(2, 3), 4, 0, 1)` evaluates the dice as an
  argument on every −1 against a non-passive critter, bare-handed too
  (uw1/src/combat/COMBAT.C:316-320); `DamageInventory` returns −2 afterwards when there is
  no weapon (uw1/src/inv/INVDATA.C:428-436).
- **After.** Always drawn. The wear goes through `check_res` with the weapon's resist byte
  (all 0 in UW1), and a wear of 0 after the `qualclass` shift is no longer counted as an
  event (`damage_object` returns at once, uw1/src/combat/DAMAGE.C:251-253; the same for
  armour). A destroyed weapon or armour piece draws the debris `rand()` of
  `DamageInventory` (uw1/src/inv/INVDATA.C:440).
- **Effect.** Serial order and the wear-event count only.

### 4.5 The monster's damage tally saturated instead of wrapping

- **Before.** `dmgTaken = min(255, dmgTaken + d)`.
- **Game.** `SET_DAMAGE(obj, OBJ_DAMAGE(obj) + damage)` (uw1/src/critter/AI.C:1479) stores
  into the byte b11 (`& 0xFF`, uw1/src/include/object.h:285-286), so it wraps.
- **After.** `(dmgTaken + d) & 0xFF`.
- **Effect.** Only when more than 255 damage lands between two of the monster's
  evaluations (big hits while it is in an attack sequence); the wrapped tally can then be
  below `avghit / 2`, so "always flee" may not trigger.

### 4.6 Smaller corrections

- **Monster swing draw order.** `critter_ai` draws `rand() % 9` as the swing argument
  before `critter_attack` adds the powerful bonus (uw1/src/critter/AI.C:1156,
  uw1/src/combat/COMBAT.C:802-805); the simulator drew it after. Fixed; distributions were
  unaffected.
- **A non-weapon in the weapon hand.** `DoPlayerWeapon` decodes the enchantment of
  whatever object is in the weapon hand, also when the blow is the fist's
  (uw1/src/combat/COMBAT.C:591-599); the simulator ignored it. Fixed (reachable only from a
  PLAYER.DAT holding such an item).
- **Launcher scaling.** `missile_newhit` scales by the Missile skill only when the
  ammunition's ammo field is −64 (uw1/src/motion/OBJPHYS.C:115). The simulator scaled
  always; every UW1 ammunition has −64, so this is a guard, not a change in results.
- **Rolled HP.** `creature_obj_init` stores the roll in the byte `hp`
  (uw1/src/critter/CREATURE.C:86); the simulator now masks it (item 0x7C only).
- **Monster phase.** The monster's initial step phase was drawn from the game generator
  (`rng.int(4)`); it is a model choice and now comes from the model stream.

### 4.7 Points of the UW2 review checked against UW1

| UW2 finding | UW1 |
|---|---|
| 1. Armour spells add nothing (`parse_spells`). | Same bug, confirmed in the C and in UW.EXE. Corrected (4.1). |
| 2. Repel Undead is a flee effect, not 255 damage. | UW1 has no Repel Undead. Its class 7 minor 2, `sp_ward_undead` (uw1/src/combat/SPELLS.C:344), is 255 damage of type 3 to a critter with the undead bit, player-only (`nail_1area`, :555). The simulator does not offer it. Nothing to correct. |
| 3. Packed special spells in creature spell bytes. | UW1's `cast` ignores indices ≥ 53 (uw1/src/combat/SPELLS.C:84); no creature has one. Acid (spell 49) is a plain missile spell and is modelled. Nothing to correct. |
| 4. Monster heals were not applied. | In UW1 a critter casts with a null target and `do_spell` returns before `healing` (uw1/src/combat/SPELLS.C:113-118, uw1/src/critter/AI.C:1166). The simulator's "no effect" is correct. |
| 5. Held critters (goal 15). | UW1 has no goal 15; Paralyze (`sp_hold`) is goal 7, player-only, and not offered. Nothing to correct. |
| 6. Fireball and Lightning explode where they stop. | Same in UW1 (fate 9, `mts_doanim`). Corrected (4.2). |
| 7. Special weapon still fires on the killing blow. | UW1 has no special weapons (uw1/src/combat/COMBAT.C header). No UW1 effect after a killing blow changes the outcome: the fight ends at the kill and later effects only touch a dead critter. |
| 8. Poison Weapon's `is_sharp` on a bare hand. | UW1 has no `is_sharp` and no Poison Weapon term. Nothing to correct. |
| 9. Random-number order. | Corrected where cheap (4.4, 4.6); the rest is in section 6. |

## 5. Remaining known gaps

| Gap | Game | Expected impact |
|---|---|---|
| Movement in melee: backing off, sidestepping, dodging, closing (`crit_attack` movement, uw1/src/critter/AI.C:407-441). | A monster can step out of reach (squared distance over 0x64) and must close again; its attack counter only rises in reach. | Monsters attack somewhat less often in the game; their average charge is about the same. Not quantified. |
| HP regeneration of the player every 24th duration check (uw1/src/game/PLAYTIME.C:139-140). | +1 HP every 8.4 minutes on `skill_check(STR, 15) > 0`. | Negligible below several minutes of fighting. |
| Freeze Time freezes missiles too. `move_physics` skips `move_mobile` (uw1/src/motion/PLAYMOVE.C:372), which also moves missiles. | Shots and missile spells hang in the air until time resumes; melee and area spells act at once. | Only Freeze Time with ranged attacks: the simulator lands those hits during the freeze. |
| Scripted deaths (`death_check`, uw1/src/event/WORLDEV.C:555). | Thorlson (whoami 0x0B) is left at 60 HP and talks; the golem of level 6 (0x16) gives up, pays 500 experience once and talks. | The simulator lets the player kill them. |
| Summon Monster (Mage 0x6A's third spell, `creat_spell`, uw1/src/combat/SPELLS.C:570), kin joining a fight (`critter_mv`, uw1/src/critter/AI.C:1228-1237), allies. | More enemies. | Group fights are harder than shown. Summons are counted as "spells with no effect on you". |
| Projectile flight, aiming spread, line of sight, missile height. | Missiles fly and can miss; their location comes from their real height. | Covered by the hit-chance setting for the player; monster missiles always hit. |
| Knockback: a struck object is pushed (`bounce_obj`, uw1/src/motion/OBJPHYS.C:72). | The target gets the missile's heading and speed 0xEB. | Movement only. |
| A poison level already in PLAYER.DAT. | `player->poison` from the save. | The fight starts unpoisoned. |
| Charge release timing within a frame. | `player_attack` runs once per frame; the first charge step needs 17 units. | At most a tick per swing. |
| Explosion geometry. | The burst is on the square where the missile stops. | Assumed to be the target's square (section 3). |

## 6. Random-number draw order

The game has one `rand()` stream shared by everything that runs: every critter's AI, the
physics of moving objects, the screen (`update_screen` draws two values every 64 clock
units for the dragons and bubbles, uw1/src/ui/PANELS.C:362-369), the music
(`change_music_maybe` each second, uw1/src/ui/INTERACT.C:250) and more. A simulated fight
can therefore never reproduce the game's exact sequence; what matters is that each draw
has the game's form (`rand() % n`, `rollem`, masks), which the simulator does. Order
matters only within a single routine. The state of that, after this pass:

Matched within each routine (and now tested where it was wrong):

- Player blow: `pickloc` draws, `skill_check`, critical multiplier, then the damage dice,
  then `check_res`. On a −1 against a non-passive monster: the 2d3 always (fixed).
- Monster blow: the swing `rand() % 9` (fixed), the powerful `rand() % 6` and `% 12`,
  `pickloc`, `skill_check`; on a critical the multiplier, the boot roll `rand() % 5` (location
  2 only) and the wear 2d4, then the damage dice and `check_res`; the poison `check_res`
  draws nothing.
- Missile: hit-chance (model stream), the Missile skill check, `pickloc`, dice; then the
  burst dice for a Fireball or Lightning.
- Monster step: `should_i_flee`'s `rand() % 4` (when reached), then the attack draws.
- Duration check: poison damage, then the mana `skill_check`.
- Item destruction: the debris `rand()` of `DamageInventory` (fixed).

Not reproduced (they change the order of the stream, not any distribution):

- `crit_attack`'s movement draws before the attack roll: `rand() % 4` and `rand() % 2` when
  closer than 0x31, `rand() % 0x40` and `rand() % 8` from 0x31 to 0x51, `rand() % 3`
  for fliers' pitch (uw1/src/critter/AI.C:407-441). Which ones depend on the distance,
  which the model does not have.
- `get_phys_data`'s position jitter, three draws per AI step of a moving critter
  (uw1/src/motion/OBJPHYS.C:265-269).
- `crit_offense_find_target`'s `rand() % 8` when its destination is out of date
  (uw1/src/critter/AI.C:468).
- A missile coming to rest: `(rand() & 7) < fate` for fates 1..8 (arrows, stones, Magic
  Missile) and `fireball_effect`'s flame draws before a Fireball's burst
  (uw1/src/motion/OBJPHYS.C:456, uw1/src/obj/EFFECT.C:289-300).
- The game draws the duration-check and step phases from its own history; the simulator
  draws them from the model stream.
