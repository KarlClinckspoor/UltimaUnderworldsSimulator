# UW2 simulator against the game's source

How the combat and casting code of this branch (`uw2`, *Labyrinth of Worlds Odds*) compares with the source of Ultima Underworld II, what is modelled on purpose rather than copied, and what was wrong and has been corrected. The UW1 branch (`main`) has its own copy of this document.

## 1. Scope and method

- **Game source.** [underworld-exhumed](https://github.com/abedegno/underworld-exhumed), read in the `underworld-exhumed-enhanced` checkout at commit `e4d83de` (2026-11). Every file cited here (`uw2/src/...`) belongs to a segment listed in `uw2/matched.txt`: its C compiles to the bytes of `UW2.EXE`, so it says what the shipped game does. The checkout's optional enhancements (`ENHANCED(...)`, `#ifndef __TURBOC__` blocks) are port-only and ignored.
- **Simulator code reviewed.** `src/combat/blow.ts`, `fight.ts`, `setup.ts`, `exact.ts`, `src/core/character.ts`, `skillcheck.ts`, `rng.ts`, and the data in `src/data/game.json`.
- **How claims were checked.**
  - Line-by-line reading of both sides.
  - The original bytes where the C looked surprising. The armour-spell bug (section 4.1) was confirmed by decoding `parse_spells` in `UW2.EXE` (segment ovr142, offset 0x615).
  - The existing tests: the C cross-check (`test/c/harness.c` runs `skill_check`, `pickloc`, the `do_damage` dice, `check_res`, `player_get_exp`, `player_killed_a`, the Poison Weapon term, `should_i_flee` and `rollem` verbatim against the TypeScript), and the generator vectors measured on `UW2.EXE`.
  - New tests in `test/accuracy.test.ts`, one per correction.
- **Verdicts used below.**
  - *Exact*: the same arithmetic and the same random draws as the game.
  - *Model*: a deliberate simplification (section 3).
  - *Corrected*: was wrong, fixed in this pass (section 4).
  - *Gap*: not modelled (section 5).

## 2. Function by function

| Simulator | Game | Verdict | Notes |
|---|---|---|---|
| `skillCheck`, `gradeOfRoll` (core/skillcheck.ts:16) | `skill_check` (uw2/src/game/SKILLCHK.C:39) | Exact | `value - target + rand() % 31`; thresholds 28/15/2. C cross-check. |
| `borland` rng (core/rng.ts:67) | Borland C++ `rand()` | Exact | LCG `× 0x015A4E35 + 1`, bits 16–30; matches vectors measured on the EXE. |
| `rollem` (core/rng.ts) | `rollem` (uw2/src/sys/UTIL.C:73) | Exact | `dice + Σ (rand() × sides) / 0x8000`. |
| `pickloc` (combat/blow.ts:15) | `pickloc` (uw2/src/combat/COMBAT.C:98) | Exact | C cross-check. |
| `meleeProbe` (blow.ts:42) | `resolve_attack` (COMBAT.C:229) | Exact, Model | `z + height × (towhere / 3) / 3`, height `(wsize × 2 + 1) × 4`. The player's pitch term (`PlayerPitch / 0x200`) is taken as 0. |
| `rollDamage` (blow.ts:48) | `do_damage` dice (COMBAT.C:370) | Exact | Minimum 2, then `(d/6)d6 + 1d(d%6)`. |
| `critMultiplier` (blow.ts:74) | `frp_check` (COMBAT.C:330) | Exact | `((rand() & 0x1F) + 0x30) >> 5`. |
| `creatureArmourAt` (blow.ts:77) | `do_damage` (COMBAT.C:401) | Exact | 0xFF uses location 0; powerful × 5/3. |
| `checkRes` (blow.ts:92) | `check_res` (uw2/src/combat/DAMAGE.C:247) | Exact | Includes UW2's fire/cold doubling. C cross-check. |
| `isSharp` (blow.ts:114) | `is_sharp` (COMBAT.C:275) | Exact | |
| `shouldIFlee` (blow.ts:117) | `should_i_flee` (uw2/src/critter/AI.C:1358) | Exact | C cross-check. |
| `ATK_CHARGE` (blow.ts:128) | `atk_charge` (AI.C:78) | Exact | |
| `meleeFrom` to-hit and damage (combat/setup.ts:106) | `DoPlayerWeapon` (COMBAT.C:616) | Exact; corrected | Attack/2 + weapon skill + Valor + DEX/7 (+7 easy); damage byte + STR/9, or the barehand formula; class-12 enchantments. **Corrected:** effect 15's +5 damage (4.7). |
| Player power at full charge (`maxCharge`) | `player_attack` (COMBAT.C:784) | Exact, Model | `wd[3] + (wd[5] − wd[3]) × play_pow / 100` with `play_pow` = 100, so `wd[5]`. Full charge is a design choice. |
| `swingFrames` / `swingTimes` / `shotTimes` (fight.ts:30, 48, 60) | `player_attack` (COMBAT.C:700), `adjust_weapon` / `do_weapload` (uw2/src/ui/PANELS.C:548, 608) | Model | WEAP.DAT frames, charge every 16 clock units at the hold frame, blow at the first 0x80 frame. The frame pacing follows the 256 Hz clock as the plan traces it; the exact frame scheduler was not re-derived in this pass. |
| `playerMelee` (fight.ts:298) | `frp_check` + `do_damage` + `player_attack`'s special powers | Exact; corrected | Order: pickloc, to-hit, Poison Weapon, critical, then (miss) the attacker is still recorded and a bad miss wears the weapon, or (hit) dice × power / 128 + hitangle − armour, `& 0xFF`, `check_res`. **Corrected:** bad-miss draw (4.9), killing-blow heal (4.6), hold (4.4), bare-hand Poison Weapon (4.8). |
| Weapon wear on a bad miss | `frp_check` (COMBAT.C:341) → `DamageInventory` (uw2/src/inv/INVDATA.C:400) → `damage_object` (DAMAGE.C:294) | Exact | `rollem(2,3) >> qualclass`; FixPlayerEquips only when the weapon breaks. Weapons' resist bytes are all 0, so `check_res` changes nothing here. |
| `MonsterActor.melee` (actor.ts:81) | `critter_ai` frame 3 (AI.C:1127) → `critter_attack` (COMBAT.C:891) | Exact; corrected | To-hit `chance + equip/2` (+7..12 powerful) − `cmbModTH[loc]` against the player's defence; damage + STR/5 (+4..15 powerful); power `atk_charge[k]`. **Corrected:** draw order (4.9). |
| `wearArmour` (fight.ts:447) | `frp_check` critical on the player (COMBAT.C:331) | Exact | Location → slot `(loc + 1) & 3`: the shield for 0 and 1, legs or (1 in 5) boots for 2, the helmet for 3; the torso piece never wears. `check_res`, `>> qualclass`; recomputed only when an item breaks, as `DamageInventory` calls `FixPlayerEquips` only then. |
| `armourAndApply` (fight.ts:465) | `do_damage` with the player as target (COMBAT.C:398–416) | Exact | Creature[63] armour by location, then easy mode halves, `& 0xFF`, `check_res`. |
| `MonsterActor.step` timing (actor.ts:158, fight.ts loop) | `move_mobile` / `timetodo` (AI.C:1542, 1554), `check_physics` (uw2/src/motion/PLAYMOVE.C:317) | Exact; corrected | One AI step per `rate` frames of 16 clock units (1/16 s); rate 4 in combat; Speed halves the frames (8 ticks); Freeze Time stops `move_mobile`. **Corrected:** rate 7 while held (4.4). |
| Attack choice and wind-up | `crit_attack` (AI.C:383) | Exact, Model | 1 in 4 starts sequence 3–5 by `attacks[i].prob`; otherwise the attack frame counts up to 15. The positioning moves before it (back off, dodge) are not made (Model: nobody moves). |
| Attack sequence | `critter_ai` (AI.C:1121–1153) | Exact | The blow lands on the step that finds frame 3; the sequence ends on frame `seq_len − 1` (CR.AN). |
| Ranged choice | `crit_offense` / `maybe_cast_defensive_spell` / `crit_magik_attack` / `crit_missile_attack` (AI.C:331, 481, 499, 522) | Exact, Model | Defensive spell `caster/256`; attack spell `caster/128`, slot 1 eleven times in 16 when `b2D_0` is set and within 8 tiles; a missile `rand() % 192 <= DEX` within 4 tiles. Line of sight and anti-magic are assumed clear. |
| Monster spells (`monsterSpell`, setup.ts:201) | `cast` / `do_spell` (uw2/src/combat/SPELLS.C:62, 83) | Corrected | Packed spell bytes (4.3) and Heal (4.5). |
| Flee check | `critter_mv` (AI.C:1229–1256) | Exact; corrected | Only outside an attack sequence; bound to fight at range (`tdistsqr > 2` and no `b2D_0`). **Corrected:** the damage tally wraps as a byte (`OBJ_DAMAGE`, 4.10). |
| `hurtMonster`, `hurtPlayer` | `damage_critter` (AI.C:1472) | Exact | Dies when `hp <= damage`; a miss (0 damage) still sets `last_hit`. |
| `thwackMonster` (fight.ts:220), `MonsterActor.missile` (actor.ts:113) | `missile_newhit` (uw2/src/motion/OBJPHYS.C:93) → `missile_thwack` (COMBAT.C:861) | Exact, Model; corrected | Power 0x80, no angle, location + 4, type `-ammo`; the player's arrows and bolts are scaled by `(Missile << 3) + 0xC0` with `skill_check(Missile, 10)`. The missile's height at impact is taken as mid-body (Model). **Corrected:** explosions (4.2). |
| `playerCast` (fight.ts:382) | `player_cast` (uw2/src/combat/RUNES.C:219) | Exact | Britannia rule, level ≥ 2c−1, mana ≥ 3c, `skill_check(Casting, 3c)`; 0 fizzles with no cost and no delay; −1 backfires for (c/2)d8 (never below 3 HP) and pays; missiles pay on launch; class 7 pays only on success; delay `(2c − level) × 4 + 0x80` clock units. |
| `areaOnMonster` / `MonsterActor.area` (fight.ts:235, actor.ts:127) | `gronk_area` / `process_area` (SPELLS.C:674, 602), `area_spells` (SPELLS.C:729) | Exact, Model; corrected | A `(2r+2)²` rectangle from `dist − r` to `dist + r + 1` ahead, x outer and y inner. Sheet Lightning: random squares, chance `count / (w·h + 3)`, up to five passes, 6d5 type 3 each. Flame Wind: every square, 1 in 3 when empty, 10d6 type 0x0B. Frost: 10 type 0x23. Shockwave: Casting/2 + 15 type 3, the player's Casting even when a monster casts it. The line of fire is taken along the iteration's inner axis (Model). **Corrected:** Repel Undead (4.1b). |
| Targeted spells | `target_spells`, `sp_bleed`, `sp_smite`, `sp_ward_undead` (SPELLS.C:758, 473, 490, 331) | Exact | Bleeding Casting/2 + 10 and Smite Foe Casting × 3 + 110, type 4, bleeding creatures only; Smite Undead 255 (liches half HP), type 3. No armour step. |
| Special weapon powers | `player_attack` (COMBAT.C:790–831), `get_hp_back`, `sp_ward_undead`, `damage_square`, `sp_hold` | Exact; corrected | See 4.4 and 4.6. |
| `derive` armour and defence (core/character.ts:107) | `FixPlayerEquips`, `armor_val`, `player_affected_by`, `parse_spells` (uw2/src/game/PLAYDATA.C:347, 322, 197, 294) | Exact; corrected | `quality × protection >> 6 + 1` by slot; the shield on locations 0–1; defence = Defense + weapon skill / 2; Luck +3 protection; resistances; Valor; Poison Weapon; item protection and toughness (with the game's slip: toughness from rings and shoulders goes to location 0 only). **Corrected:** armour spells (4.1), the level buffs are judged on (4.11). |
| Buff durations (fight.ts loop) | `set_curmagic`, `duration_check` (uw2/src/game/PLAYTIME.C:246, 70), the 20 s timer (uw2/src/ui/INTERACT.C:111) | Exact, Model | 1 / 2d3 / 2d8 + 6 / 3d20 + 24 checks by stability; the check that finds 1 ends it. The phase of the 20 s clock is a model draw. |
| Mana regeneration and poison | `duration_check` (PLAYTIME.C:127), `restore_mana` (SPELLS.C:155), `critter_attack` (COMBAT.C:910) | Exact; corrected | Every third check: the poison tick (`poison--` HP of type 0x10), then `skill_check(Mana, 10)` adds the grade (nothing in the Academy except its level 1, though the roll is still drawn). **Corrected:** poison was not modelled (4.12). |
| `killedExp` / `getExpAfter` (fight.ts:80, 96) | `player_killed_a` (COMBAT.C:935), `player_get_exp` (SKILLCHK.C:63) | Exact | C cross-check. |
| `critterDefender` (duel.ts:59), arena | `frp_check` / `do_damage` / `critter_attack` with a critter as `hitobj` (COMBAT.C:300, 362, 891) | Exact | To-hit against the defender's `Creature.defence` with no `cmbModTH` (only `if (hitobj == 1)`); its armour at the location, ×5/3 when powerful (`hitobj != 1 && OBJ_POWERFUL(def)`); no easy-mode halving, no poison (`critter_attack` poisons only `hitobj == 1`), no wear (`frp_check`'s critical wear is `defender == 1`); a miss still calls `damage_item(…, 0)`. |
| `duel` (duel.ts:88), arena | `critter_mv` hit reaction (AI.C:1166), `do_attack` ally test (COMBAT.C:536) | Model | Critters only hit and react to each other when one is the player's ally; the arena takes one side as an ally so both fight and flee as they do against the player. Both stand still, step every 4 ticks from a random phase; on a shared tick half the fights let each side go first. |
| `monsterStartHp` "roll" (fight.ts:114) | creature generation (uw2/src/critter/CREATURE.C:90) | Exact | `avghit × (16 + rand() % 24) / 32`. The simulator keeps at least 1 HP; the game could give 0 for avghit 1, which no listed creature has. |

## 3. Deliberate modelling choices

These are design decisions (PLAN.md, README) and are kept. Each changes results in a known direction.

1. **Nobody moves.** The game's monsters back off, sidestep and dodge (`crit_attack`, AI.C:396–416), and at range a melee monster walks up. Here they stand still: in reach in melee, held at the set distance at range. Effect: monsters attack a little more often in melee than they would while repositioning, and a melee-only monster never reaches you at range.
2. **Full charge.** The player always releases at full power. Effect: the best damage per swing and the slowest swings. A player who clicks quickly does less damage per hit and swings more often.
3. **A hit-chance setting stands in for projectile flight** for the player's missiles. Monster missiles always hit. Effect: monster ranged damage is an upper bound.
4. **Impact geometry.** A missile strikes at mid-body, and an explosion lands on the struck monster's square (section 4.2). The player's pitch is 0.
5. **One enemy, no allies, no line-of-sight or anti-magic squares.** A Repel Undead budget shared by several undead never arises.
6. **The fight ends when the monster flees.** This includes Repel Undead's flee. The game's fleeing monster backs away and can turn and fight when cornered. Chasing it is not modelled.
7. **The 20 s duration clock's phase** is a model draw (the simulator does not know when the last check was), as is the monster's first AI step within its 4-tick cycle.
8. **Random numbers.** The game's own generator, drawn in the game's form (`% n`, `& mask`, `rollem`). The call order follows the game where it is cheap (section 6). Model-only choices (hit chance, phases) use a separate stream.

## 4. Errors found and corrected in this pass

### 4.1 Armour spells add no armour (Resist Blows, Thick Skin, Iron Flesh)

- **Before:** an active armour spell added its level (2, 3 or 5) to the armour of every location.
- **Game:** `player_affected_by` keeps the best armour level in bits 4–7 of the bonus word (PLAYDATA.C:202–205). `parse_spells` (PLAYDATA.C:294) first loops over the stealth bits with `for (i = 0; i < 4; i++, bonuses = bonuses >> 1)`, which shifts the word right four times, and only then adds `(bonuses >> 4) & 0xF`, that is the original bits 8–11. Nothing ever sets those bits, so the armour bonus is always 0.
- **Checked in the EXE:** at ovr142:0615 the loop is `mov ax,si; shr ax,1; mov si,ax` four times, then `mov ax,si; shr ax,4; and al,0Fh`. The same code is in UW1's `parse_spells`.
- **After:** armour spells and class-2 enchantments add nothing. The character panel says so, and the buff and enchantment labels read "adds nothing (game bug)". `ARMOUR_SPELLS_WORK` in `core/character.ts` documents the switch. The game itself is what the site is meant to reproduce, so it stays off.

### 4.1b Repel Undead makes the undead flee; it does not deal 255 damage

- **Before:** an undead monster in the area took 255 damage (liches half their HP), so Repel Undead killed it outright.
- **Game:** `sp_repel_undead` (SPELLS.C:546) works for the player only. An undead critter (`check_res(…, 0x80) == 0`) within a budget of Casting × 10 HP is either sent fleeing (`hit_critter_goal(6, …)`, which magic resistance can shrug off, SPELLS.C:364) or, if it is already fleeing, takes Casting damage of type 3. The 255 belongs to Smite Undead and the undead-slaying weapon (`sp_ward_undead`, SPELLS.C:331).
- **After:** a successful Repel Undead ends the fight as a flee. The random draws for every square's effect are made in order.

### 4.2 Fireballs and lightning bolts explode where they stop

- **Before:** the Fireball spell did its missile damage only (28, type 0x0B), and Lightning 16, type 3.
- **Game:** items 0x14, 0x1D (fireballs) and 0x15 (lightning bolt) have fate 9 in COMOBJ.DAT. When the projectile comes to rest, `mob_to_static` (OBJPHYS.C:434) calls `mts_doanim` (uw2/src/obj/EFFECT.C:326), which runs `damage_square` (SPELLS.C:1061) on the square. That is 10d6 type 0x0B for a fireball and 6d5 type 3 for a lightning bolt, to every object there, with no armour step. `bounce_obj` (OBJPHYS.C:59) sets `XP, YP` to the struck object's tile.
- **After:** a hit by these missiles is followed by the explosion on the target. This applies to the player's Fireball and Lightning, and to the Fire elemental's, Destroyer's, Liche's, Dire reaper's, Gazer's and the mages' casts at the player.
- **Uncertainty:** that the projectile settles on the target's own square is read from `bounce_obj`. It was not traced through the rest of the physics frame. If it settled on the square in front, the explosion would miss a lone target.

### 4.3 Creatures' packed spell bytes: acid and snowball missiles

- **Before:** the spell bytes 0x48 and 0x49 (Acid slug and Despoiler: 0x48; Yeti: 0x49) were looked up as entries 72 and 73 of the 69-entry spell table, so these creatures had no ranged attack.
- **Game:** `cast` (SPELLS.C:62) reads a byte with bit 6 or 7 set as class `12 + (byte >> 6)`, minor `byte & 0x3F`. Class 13 minors 8 and 9 are `do_spell(5, 4)` and `do_spell(5, 6)` (`special_spells`, SPELLS.C:1005). Through `release_missile` these become the acid missile (item 0x16: 8 damage, type 0x10) and the snowball (0x1C: 10 damage, type 0x63).
- **After:** these creatures fire them at range.

### 4.4 The holding weapon: steps at rate 7, and a swing under way still lands

- **Before:** the monster was frozen for `(rand & 15) × Casting/3 + 16` ticks of 1/16 s, and its attack in progress was cancelled.
- **Game:** `sp_hold` → `hit_critter_goal(15, 1, time)` sets goal 15 with `GTARG = time`. Goal 15 (AI.C:1304) sets rate 7 and decrements `GTARG` once per AI step, then one more step drops the goal. `critter_ai` plays attack and cast sequences 3–6 without calling `critter_mv` (AI.C:1121–1153), so a blow already wound up still lands. The time is drawn before the resistance checks.
- **After:** the hold lasts `time + 1` steps of 7 frames, about 7/16 s each (doubled under Speed). With Casting 30 that is 16 to 166 steps, 7 to 73 s, where it used to be 1 to 10 s. The pending hit is processed when the hold ends, as `critter_mv` skips the `last_hit` test while the goal is 15.

### 4.5 Monster Heal spells heal

- **Before:** a creature's Heal (class 4, e.g. the defensive slot of the Great troll, Human 0x5B and Liche 0x69) was counted as "no effect on you".
- **Game:** `do_spell` case 4 calls `healing(who, sub)` on the caster (SPELLS.C:105, 207): `rollem(sub, 8)` HP, all for sub 15. `get_hp_back` caps the total at `avghit`.
- **After:** the monster heals itself, and the result card shows the casts and the HP regained. Defensive spells are only cast outside melee reach (`crit_offense`), so this shows in ranged fights.

### 4.6 The healing weapon heals on the killing blow too

- **Before:** the special power was skipped when the blow killed.
- **Game:** `do_attack` returns 1 for any hit, and the dying critter is still a mobile object, so `player_attack` runs the power (COMBAT.C:790–802). For LifeStealer, `get_hp_back(ThePlayer, ddone)` still heals.
- **After:** it heals then too. The other powers have no effect on a dead target.

### 4.7 Special weapon effect 15 adds 5 damage

- **Game:** `spec_damage[8]` and `spec_skill[9]` (COMBAT.C:59–60) are 17 contiguous bytes: 0 × 8, then 5, then 0 × 8. `DoPlayerWeapon` adds `spec_damage[specweap]` and `spec_skill[specweap]`. For specweap 8 (effect 15), `spec_damage[8]` reads the 5 just past its table, and the to-hit byte is 0.
- **After:** effect 15 gives +5 damage. It was +0 before.

### 4.8 Poison Weapon works bare-handed

- **Before:** no Poison Weapon bonus without a weapon.
- **Game:** `frp_check` (COMBAT.C:322) calls `is_sharp(AskInventory(slot))`. An empty hand gives a null far pointer, and `is_sharp` reads the `id` word at 0000:0000. That is the offset of the int 0 vector, 0x0019 (`int0_trap`, uw2/docs/PORT.md "Null pointers"), which decodes as item 0x19, a bow, so `is_sharp` returns 1.
- **After:** bare hands get the bonus against bleeding creatures. A non-weapon held in the weapon hand does not.
- **Note:** this follows DOS. The port's `is_sharp` is not marked for null reads, so the port may differ.

### 4.9 Random-number call order

The monster's `rand() % 9` swing is now drawn before the powerful bonus. The player's bad-miss `rollem(2,3)` is drawn even when there is no weapon to wear. The holding weapon's duration is drawn before its resistance checks. None of these change a distribution (section 6).

### 4.10 The damage tally is a byte

- **Game:** `OBJ_DAMAGE` / `SET_DAMAGE` (uw2/src/include/object.h:261) mask with 0xFF, so the tally wraps.
- **Before:** the simulator saturated it at 255.
- **Impact:** none in practice, since a monster's HP is at most 255.

### 4.11 Buffs are judged on the fight's level

- **Before:** whether a buff took (Britannia refuses circles above 3) was decided on the character's own dungeon level, while attack spells used the fight's level.
- **After:** both use the fight's level, as the game casts on the level the fight is on.

### 4.12 Poison from monster attacks

- **Before:** not modelled.
- **Game:** on a hit, a creature whose poison level (`b0F`, 11 creature types, levels 2–14) is above the player's poisons him at that level. This needs `rand() % (poison + 6)` to beat twice his armour at the location hit, and he must not resist poison (`check_res(…, 0x10)`; COMBAT.C:910). Every third duration check, about 60 s apart, `duration_check` deals `poison--` HP of type 0x10 before the mana roll (PLAYTIME.C:127).
- **After:** both are simulated. Poison shows as its own source on the attacks card. A two-minute fight holds at most two or three ticks, so the effect is modest. The UW1 branch models the same rule without the armour roll, which UW1's `critter_attack` does not have.

## 5. Remaining gaps (not modelled)

| Gap | Game | Expected impact |
|---|---|---|
| Player HP regeneration | `skill_check(STR, 15)` every 30th check, about 10 min; regeneration items (xt 14/15) +1 HP or mana every check | Negligible within the default 120 s limit, except with a regeneration ring (+1 HP every 20 s). |
| Paralyze, Charm, Cause Fear, Mass spells as player attacks | SPELLS.C | Not offered as attack spells. |
| Mind Blast and the other class-13 specials | `special_spells` | No creature in LEV.ARK casts them. |
| Movement, pursuit of a fleeing monster | `crit_attack`, `crit_flee` | See section 3. |
| What a monster does after a hold | `critter_discard_goal` drops it to wandering until the pending hit re-targets it | It resumes attacking on the next step, a little sooner than in the game. |
| The Academy's level 8, x ≥ 25 mana rule | `restore_mana` | Treated as not reached. |

## 6. Random-number draw order

The simulator draws from the game's generator, so the sequence matters only for replaying a fight draw for draw. Distributions do not depend on it. These differences remain:

- `crit_attack`'s positioning draws before each attack roll (`rand() % 4`, `% 2`, `% 0x40`, `% 8`, and `% 3` for fliers) are not made, because nobody moves.
- Visual effects draw too: `build_new_obj`'s height, `add_animobj`'s frame, `fireball_effect`'s flames, `put_effect`. The simulator skips these.
- Sheet Lightning picks all its squares before rolling the 6d5s; the game interleaves them.
- The experience roll for a kill is drawn at the end of the fight; the game draws it at the moment of the kill. Only the order changes.

## 7. What was already right

Most of the model matched the source before this pass:

- the skill check;
- hit locations;
- damage dice, charge, angle and armour;
- resistances and UW2's doubling;
- the player's to-hit and damage, including Valor, Poison Weapon on weapons and the swapped weapon-enchantment names;
- weapon and armour wear, with the torso never wearing and recomputation only on breaking;
- the monster's AI cadence, wind-up and CR.AN sequence lengths;
- ranged chances, the flee rule and binding at range;
- missiles and the Missile-skill scaling;
- player casting rules, costs, delays and backfire;
- area-spell geometry and counts;
- targeted spells;
- experience;
- mana regeneration and buff durations.

The C cross-check and the generator vectors pin the arithmetic of the core functions to the game's own code.

## 8. Where UW1 and UW2 differ (for readers of both branches)

Checked side by side in `uw1/src` and `uw2/src`:

- **A critter's Heal.** UW1's `do_spell` heals the *target*, which a critter's `cast` leaves null, so it does nothing. UW2's heals the caster.
- **Spell bytes.** UW1's `cast` ignores indices of 53 and above. UW2 packs special spells (acid, snowball) into bits 6–7.
- **Poison.** UW2's `critter_attack` adds the armour roll `rand() % (poison + 6) > 2 × armour`. UW1 has none.
- **Repel Undead.** UW2's makes the undead flee. UW1 has no such area spell in the simulator.
- **Special weapons, Valor, Poison Weapon and the hold** are UW2 only.
- **The armour-spell bug, the fireball and lightning explosions, and the byte-sized damage tally** are the same in both games, and both branches now model them.
