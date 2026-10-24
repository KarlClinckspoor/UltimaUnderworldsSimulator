# Stygian Abyss Odds — UW1 skill check and combat simulator

A static, client-side website for Ultima Underworld 1 with two tabs:

- **Skills**: the exact odds (n/32768, from the game's own `rand()`) of every `skill_check` outside combat — casting by circle, lore, traps, locks, repair, swimming, falling, regeneration, the mushroom quirk, character creation — with grade bars, the 31 scores, a P(success)-vs-value curve, a value × target heatmap and pinned scenarios to compare.
- **Combat**: pick any of the 657 monsters in LEV.ARK (levels 1–9), fight it N times in melee or at range, and see outcomes with 95% Wilson intervals, fight length, HP left, damage dealt by source, damage received per body part with armour absorption, the monster's attacks by source, wear, casting statistics, and the exact one-blow damage distribution. **All enemies** runs every combat-capable monster and plots how many the character can beat.

A shared character panel holds attributes, skills, equipment slots 0–10 (item, quality, enchantment), runes, buffs and easy mode, and loads a save's `PLAYER.DAT` in the browser (nothing is uploaded).

The rules are ported from the reconstructed source in [abedegno/underworld-exhumed](https://github.com/abedegno/underworld-exhumed); `PLAN.md` is the full specification and lists every source function used.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/ (open with any static server, e.g. npm run preview)
```

## Test it

```bash
npm test           # Vitest: C cross-check, PLAYER.DAT reader, simulator vs exact distributions
npm run build && npm run smoke   # Playwright smoke test (screenshots in test/screenshots)
```

The C cross-check (`test/c/harness.c`) copies `skill_check`, `pickloc`, the damage dice of `do_damage`, `check_res`, `should_i_flee` and `rollem` verbatim from the game source, replaces `rand()` with enumerated values, and requires the TypeScript ports to agree exactly (it needs `cc`, `gcc` or `clang`; skipped otherwise). The `skill_check` test enumerates all 32768 values of the 15-bit `rand()` and requires the site's counts to equal them exactly. `test/rng-vectors.test.ts` replays vectors measured on UW.EXE: same generator state in, same result and state out.

## Layout

| Path | What |
|---|---|
| `src/core/` | `skill_check` model, seeded RNG, PLAYER.DAT reader, character and derived values (`FixPlayerEquips`) |
| `src/combat/` | blow pipeline (`blow.ts`), profiles (`setup.ts`), fight loop (`fight.ts`), exact distributions (`exact.ts`), worker pool |
| `src/ui/` | character panel, Skills tab, Combat tab, d3 charts |
| `src/data/game.json` | compact game data, built by `node tools/compact-data.mjs` from `uw1-data/json` |
| `uw1-data/` | the extractor, the reference PLAYER.DAT reader and the full JSON extracts |
| `test/` | Vitest suites, the C harness, the two saves as fixtures, the smoke test |

## Model in brief (see PLAN.md Part B)

- Nobody moves. Melee: face to face (optional hit angle for your blows). Ranged: the monster is held at a distance (default 3 tiles; slingers only fire under 4 tiles, `tdistsqr < 0x10`).
- Random numbers come from the game's own generator, Borland `rand()` (`seed × 0x015A4E35 + 1`, bits 16–30), used the way each call site uses it, so `rand() % 31`'s 1058-vs-1057 imbalance and its kin are in the simulation and in the exact odds (n/32768). It is checked call for call against vectors measured on UW.EXE (`test/vectors`). An ideal-uniform model is kept as an option for comparison.
- Time runs in 1/16 s ticks. A monster acts every 4 ticks (8 under Speed, never under Freeze Time): one time in four it starts an attack that lands 5 steps later with a charge from `atk_charge` by its wind-up; casters and slingers roll their ranged chances.
- Your swing follows the weapon animation (`adjust_weapon`, one frame per 32 clock units) and charges to full before release (`player_attack`), so a dagger swing takes about 1.5 s. Launcher shots and spells add 1 s of aiming.
- Each blow: hit location (`pickloc`), to-hit `skill_check`, critical ×1 or ×2, dice `(d/6)d6 + 1d(d%6)`, × charge/128, + hit angle, − armour (×5/3 for a powerful monster), easy mode halves damage to you, then `check_res`.
- Experience comes only from a kill (`player_killed_a`): exp × 4 + 2d(exp), × (24..47)/16 for a powerful monster in a 16-bit int that can wrap negative in DOS UW1, then `player_get_exp`'s rules (halved above twice the dungeon level plus two, nothing past 96000 raw). The Combat tab totals it over the simulated fights; the all-enemies view gives the expected XP for fighting everything once.
- A monster you hit re-evaluates `should_i_flee` at its next step; fleeing ends the fight (outcome "flees"). You never flee; your death ends it too; otherwise the time limit is a timeout.
- Not modelled: movement, line of sight and projectile flight (a hit-chance setting stands in), healing and potions, buff durations and failed buff casts, summons, poison, multiple enemies.
