// The arena's round robin (plan Part C): who fights, one record per pair, and the conversion to ratings.
import { creatures, levels, npcName } from '../data/gameData';
import { combatCapable } from '../combat/setup';
import { entrantKey, entrantProfile, hasRangedAttack, type DuelMode, type DuelSettings, type DuelStats, type Entrant } from '../combat/duel';
import type { RandModel } from '../core/rng';
import { fitRatings, type PairCounts, type RatingResult, type Scoring } from './rating';

/** Bump when the duel engine or the entrant rules change: a reference run from an older engine is stale. */
export const ARENA_ENGINE = 1;

/** One pair's results, compact: i, j, outcomes (A = i), seconds summed, and per side hits, attempts,
    criticals, HP dealt, armour absorbed. */
export interface PairRec {
  i: number; j: number;
  o: number[];            // [i kills j, j kills i, i fled, j fled, timeout]
  dur: number;            // seconds, summed over the pair's fights
  hist: number[];         // fight length, 1 s bins
  side: [SideRec, SideRec];
}
export interface SideRec { att: number; hit: number; crit: number; dealt: number; absorbed: number; resisted: number; hpStart: number; hpLeft: number }

export interface ArenaRun {
  engine: number;
  mode: DuelMode;
  settings: DuelSettings;
  n: number;              // fights per pair
  seed: number;
  rand: RandModel;
  entrants: Entrant[];
  pairs: PairRec[];
  source: 'reference' | 'live';
  seconds?: number;       // wall time of the run
}

export function arenaEntrants(mode: DuelMode, powerful: boolean): Entrant[] {
  const out: Entrant[] = [];
  for (const pw of powerful ? [false, true] : [false]) {
    creatures.forEach((c, i) => {
      if (!combatCapable(c, c.avghit)) return;
      const e = { creature: i, powerful: pw };
      if (mode === 'ranged' && !hasRangedAttack(entrantProfile(e, creatures))) return;
      out.push(e);
    });
  }
  return out;
}
/** The types left out of the ranged ladder: combat-capable but no ranged attack that hurts a critter. */
export function rangedLeftOut(): number[] {
  return creatures.map((c, i) => i).filter((i) => combatCapable(creatures[i], creatures[i].avghit)
    && !hasRangedAttack(entrantProfile({ creature: i, powerful: false }, creatures)));
}

export function pairFromStats(i: number, j: number, st: DuelStats): PairRec {
  const side = (s: DuelStats['a']): SideRec => ({
    att: s.srcAttempts.reduce((a, b) => a + b, 0), hit: s.srcHits.reduce((a, b) => a + b, 0), crit: s.srcCrits.reduce((a, b) => a + b, 0),
    dealt: s.dealt, absorbed: s.absorbed, resisted: s.resisted, hpStart: s.hpStart, hpLeft: s.hpLeft,
  });
  let last = st.durHist.length - 1;
  while (last > 0 && !st.durHist[last]) last--;
  return { i, j, o: st.outcomes.slice(), dur: st.durSum.reduce((a, b) => a + b, 0), hist: st.durHist.slice(0, last + 1), side: [side(st.a), side(st.b)] };
}

// ---- compact form for src/data/arena.json: each pair one flat array
// [i, j, o0..o4, dur*16, side0 (8 numbers), side1 (8 numbers), ...hist]
const SIDE_KEYS = ['att', 'hit', 'crit', 'dealt', 'absorbed', 'resisted', 'hpStart', 'hpLeft'] as const;
export type PackedRun = Omit<ArenaRun, 'pairs'> & { pairs: number[][] };
export function packRun(run: ArenaRun): PackedRun {
  return { ...run, pairs: run.pairs.map((p) => [p.i, p.j, ...p.o, Math.round(p.dur * 16),
    ...p.side.flatMap((s) => SIDE_KEYS.map((k) => s[k])), ...p.hist]) };
}
export function unpackRun(run: PackedRun): ArenaRun {
  return { ...run, pairs: run.pairs.map((a) => {
    const side = (o: number) => Object.fromEntries(SIDE_KEYS.map((k, x) => [k, a[o + x]])) as unknown as SideRec;
    return { i: a[0], j: a[1], o: a.slice(2, 7), dur: a[7] / 16, side: [side(8), side(16)], hist: a.slice(24) };
  }) };
}

export const pairN = (p: PairRec) => p.o.reduce((a, b) => a + b, 0);
export const countsOf = (p: PairRec): PairCounts => ({ i: p.i, j: p.j, iWins: p.o[0], jWins: p.o[1], iFled: p.o[2], jFled: p.o[3], timeouts: p.o[4] });

export interface EntrantSummary {
  wins: number; losses: number; fled: number; theyFled: number; timeouts: number; fights: number;
  dealt: number; taken: number; dur: number; neverHurts: boolean;
}
/** Per-entrant totals over all its pairs, from its own point of view. */
export function summaries(run: ArenaRun): EntrantSummary[] {
  const S = run.entrants.map((): EntrantSummary => ({ wins: 0, losses: 0, fled: 0, theyFled: 0, timeouts: 0, fights: 0, dealt: 0, taken: 0, dur: 0, neverHurts: true }));
  for (const p of run.pairs) {
    const n = pairN(p);
    const a = S[p.i], b = S[p.j];
    a.wins += p.o[0]; a.losses += p.o[1]; a.fled += p.o[2]; a.theyFled += p.o[3]; a.timeouts += p.o[4];
    b.wins += p.o[1]; b.losses += p.o[0]; b.fled += p.o[3]; b.theyFled += p.o[2]; b.timeouts += p.o[4];
    a.fights += n; b.fights += n; a.dur += p.dur; b.dur += p.dur;
    a.dealt += p.side[0].dealt; a.taken += p.side[1].dealt; b.dealt += p.side[1].dealt; b.taken += p.side[0].dealt;
    if (p.side[0].dealt > 0) a.neverHurts = false;
    if (p.side[1].dealt > 0) b.neverHurts = false;
  }
  return S;
}

export function rate(run: ArenaRun, scoring: Scoring): { r: RatingResult; sum: EntrantSummary[] } {
  const sum = summaries(run);
  const r = fitRatings(run.entrants.length, run.pairs.map(countsOf), scoring, 1, sum.map((s) => s.neverHurts));
  return { r, sum };
}

/** The named NPCs that use a creature type (from the placed monsters). */
const namesByType = new Map<number, string[]>();
for (const L of levels) for (const r of L.rows) if (r.who) {
  const a = namesByType.get(r.c) ?? [];
  const nm = npcName(r.who);
  if (!a.includes(nm)) a.push(nm);
  namesByType.set(r.c, a);
}
export const namedOf = (creature: number) => namesByType.get(creature) ?? [];
export const entrantLabel = (e: Entrant) => `${creatures[e.creature].name}${e.powerful ? ' ★' : ''}`;
export { entrantKey };
