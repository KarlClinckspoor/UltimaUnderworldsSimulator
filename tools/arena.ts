// Precomputes the arena's reference round robins (plan C6) and writes src/data/arena.json.
// Run: npm run arena   (vite-node; about a minute)
// The live run in the page with the same settings (N 2000, seed 1, game random numbers, no powerful
// variants) gives exactly these numbers: one job per pair, stream = pair index, of (pairs) streams.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { creatures } from '../src/data/gameData';
import { makeRng } from '../src/core/rng';
import { defaultDuelSettings, emptyDuelStats, entrantProfile, simulateDuels, type DuelMode } from '../src/combat/duel';
import { ARENA_ENGINE, arenaEntrants, packRun, pairFromStats, type PackedRun } from '../src/arena/arena';

const N = Number(process.env.ARENA_N ?? 2000);
const SEED = 1;
const out: Record<string, PackedRun> = {};
for (const mode of ['melee', 'ranged'] as DuelMode[]) {
  const t0 = Date.now();
  const entrants = arenaEntrants(mode, false);
  const profs = entrants.map((e) => entrantProfile(e, creatures));
  const S = defaultDuelSettings(mode);
  const idx: [number, number][] = [];
  for (let i = 0; i < entrants.length; i++) for (let j = i + 1; j < entrants.length; j++) idx.push([i, j]);
  const pairs = idx.map(([i, j], k) => pairFromStats(i, j, simulateDuels(emptyDuelStats(S), profs[i], profs[j], S, N, makeRng(SEED, k, 'game', idx.length))));
  const seconds = (Date.now() - t0) / 1000;
  out[mode] = packRun({ engine: ARENA_ENGINE, mode, settings: S, n: N, seed: SEED, rand: 'game', entrants, pairs, source: 'reference', seconds });
  console.log(`${mode}: ${entrants.length} entrants, ${pairs.length} pairs x ${N} in ${seconds.toFixed(1)} s`);
}
const file = join(__dirname, '..', 'src', 'data', 'arena.json');
writeFileSync(file, JSON.stringify(out));
console.log('wrote', file);
