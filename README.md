# Labyrinth of Worlds Odds — UW2 skill check and combat simulator

**Live:** https://karlclinckspoor.github.io/UltimaUnderworldsSimulator/uw2/ (UW2) · https://karlclinckspoor.github.io/UltimaUnderworldsSimulator/uw1/ (UW1, branch `main`)

The `uw2` branch of the Underworld combat simulator: the same static, client-side site for **Ultima Underworld II: Labyrinth of Worlds**, in a darker blue theme. (The `main` branch is the UW1 version, *Stygian Abyss Odds*.) Two tabs:

- **Creation**: character creation by class, exactly: histograms of each attribute, max HP and max mana, and of every skill the class can get (overlaid for a skill added once or twice), plus a "desired stats" form giving the chance that one roll meets every minimum with the best menu picks, marking the improbable fields in red and comparing all eight classes.
- **Skills**: the exact odds (n/32768, from the game's own `rand()`) of every `skill_check` outside combat — casting by circle (with the Britannia cap), lore, traps (whose targets grow with the world), locks (with the pick-breaking fumble), repair, swimming, falling, thin ice, skill traps, regeneration, the mushroom quirk, character creation — with a Details card per check (what it does, the rule as LaTeX and Python, how often timed checks run), grade bars, P(grade)-vs-value curves, threshold values per goal, a value × target heatmap, pinned scenarios, and for the timed checks (HP and mana regeneration, drowning) the exact distribution of the time to full / to 0 HP with 50 / 65 / 95% ranges over time. Value is shown in blue and target in red throughout.
- **Combat**: pick any of the 746 monsters in the 42 levels of LEV.ARK, by world, fight it N times in melee or at range, and see outcomes with 95% Wilson intervals, fight length, HP left, damage dealt by source, damage received per body part with armour absorption, the monster's attacks by source, wear, casting and special-weapon statistics, experience, and the exact one-blow damage distribution. **All enemies** runs every combat-capable monster and plots how many the character can beat.

A shared character panel holds attributes, skills, the dungeon level (its world sets the casting and XP rules), equipment slots 0–10 (item, quality, enchantment — including UW2's special weapons), runes, buffs (Luck, Resist Blows, Valor, Speed, Poison Weapon, Flameproof, Thick Skin, Missile Protection, Freeze Time, Iron Flesh) and easy mode, and loads a save's `PLAYER.DAT` in the browser (nothing is uploaded).

The rules are ported from the UW2 sources in [abedegno/underworld-exhumed](https://github.com/abedegno/underworld-exhumed); `PLAN.md` opens with the list of everything UW2 does differently and then carries the full UW1 specification the engine was built from.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/ (open with any static server, e.g. npm run preview)
```

## Publishing

`.github/workflows/pages.yml` builds this branch into `/uw2/` and the `main` branch into `/uw1/` of one GitHub Pages site, with `pages/index.html` as the landing page; a push to either branch runs the tests and redeploys both.

## Test it

```bash
npm test           # Vitest: C cross-check, PLAYER.DAT reader, simulator vs exact distributions
npm run build && npm run smoke   # Playwright smoke test (screenshots in test/screenshots)
```

The C cross-check (`test/c/harness.c`) copies `skill_check`, `pickloc`, the damage dice of `do_damage`, UW2's `check_res`, the arithmetic of `player_get_exp` and `player_killed_a`, the Poison Weapon term of `frp_check`, `should_i_flee` and `rollem` verbatim from the game source, replaces `rand()` with enumerated values, and requires the TypeScript ports to agree exactly; `test/rng-vectors.test.ts` replays vectors measured on UW2.EXE (same generator state in, same result and state out) (it needs `cc`, `gcc` or `clang`; skipped otherwise).

## Rebuild the data

```bash
python3 -I uw2-data/tools/extract_uw2.py --objects DATA/OBJECTS.DAT --comobj DATA/COMOBJ.DAT --levark DATA/LEV.ARK \
  --weap DATA/WEAP.DAT --asan CRIT/AS.AN --cran CRIT/CR.AN \
  --items <exhumed>/uw2/src/include/items.h --spells-c <exhumed>/uw2/src/combat/SPELLS.C --out uw2-data/json
node tools/compact-data.mjs      # -> src/data/game.json
```

## Layout

| Path | What |
|---|---|
| `src/core/` | `skill_check` model, seeded RNG, UW2 PLAYER.DAT reader (chained cipher), character and derived values (`FixPlayerEquips`) |
| `src/combat/` | blow pipeline (`blow.ts`), profiles and spell table (`setup.ts`), fight loop (`fight.ts`), exact distributions (`exact.ts`), worker pool |
| `src/ui/` | character panel, Skills tab, Combat tab, d3 charts |
| `src/data/game.json` | compact game data, built by `node tools/compact-data.mjs` from `uw2-data/json` |
| `uw2-data/` | the extractor (with the LZSS decoder), the reference PLAYER.DAT reader and the full JSON extracts |
| `test/` | Vitest suites, the C harness, the sample save as a fixture, the smoke test |

## Model in brief (see PLAN.md)

- Nobody moves. Melee: face to face (optional hit angle for your blows). Ranged: the monster is held at a distance (default 3 tiles; slingers only fire under 4 tiles).
- Random numbers come from the game's own generator, Borland `rand()` (`seed × 0x015A4E35 + 1`, bits 16–30), used the way each call site uses it, so `rand() % 31`'s 1058-vs-1057 imbalance and its kin are in the simulation and in the exact odds (n/32768). It is checked call for call against vectors measured on the executable (`test/vectors`). An ideal-uniform model survives only in the core, as a reference for the tests.
- Time runs in 1/16 s ticks. A monster acts every 4 ticks (8 under Speed, never under Freeze Time): one time in four it starts an attack that lands on its 4th step (16 ticks) with a charge from `atk_charge` by its wind-up, and recovers after its CR.AN sequence (4–7 steps, per creature); casters and slingers roll their ranged chances.
- Your swing follows WEAP.DAT's frames (one per 2 ticks) and charges to full before release: a slash takes UW1's time, a stab or a bare-handed blow is four ticks quicker, a sword bash two ticks slower. Launcher shots and spells add 1 s of aiming.
- Each blow: hit location (`pickloc`), to-hit `skill_check` with Valor, Poison Weapon on bleeding foes, critical ×1 or ×2, dice `(d/6)d6 + 1d(d%6)`, × charge/128, + hit angle, − armour (×5/3 for a powerful monster), easy mode halves damage to you, then `check_res` (fire and cold double against the opposite resistance). Special weapons fire their power after a hit on a critical.
- Casting: `skill_check(Casting, 3 × circle)`; nothing above circle 3 in Britannia; missile, area (Sheet Lightning, Flame Wind, Frost, Shockwave, Repel Undead) and targeted (Bleeding, Smite Foe, Smite Undead) attack spells with their real geometry.
- Experience comes only from a kill: (exp × 4 + 2d(exp)) halved, halved again (+1) when your level is above twice the world plus two, nothing past 524272 raw. The Combat tab totals it; the all-enemies view gives the expected XP for fighting everything once.
- A monster you hit re-evaluates `should_i_flee` at its next step; fleeing ends the fight. You never flee; your death ends it too; otherwise the time limit is a timeout.
- Not modelled: movement, line of sight and projectile flight (a hit-chance setting stands in), healing and potions, buff durations and failed buff casts, summons, poison, Paralyze/Charm/Fear, multiple enemies.
