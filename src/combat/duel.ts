// The arena (plan Part C): one monster against another, nobody moving, in 1/16 s ticks. Both are
// MonsterActors (actor.ts), each striking the other through a critter Defender, which is COMBAT.C's
// path for `hitobj != 1`: the defender's Creature.defence for the to-hit roll and no cmbModTH; its own
// armour at the zone, x5/3 when it is powerful; no easy-mode halving, no poison, no wear; check_res
// with its resist byte. Critter-vs-critter fights need an ally on one side (AI.C critter_mv); the
// arena takes A as the player's ally, so both run the hit reaction and can flee.

import type { Rng } from '../core/rng';
import { checkRes, creatureArmourAt } from './blow';
import { MonsterActor, type Defender, type MonsterSink } from './actor';
import { monsterProfile, type MonsterProfile } from './setup';
import { SOURCES } from './stats';

export type DuelMode = 'melee' | 'ranged';
export interface DuelSettings {
  mode: DuelMode;
  distance: number;        // tiles, ranged
  timeLimit: number;       // seconds of game time
  hpMode: 'roll' | 'avg';  // a fresh critter's HP (avghit x (16 + rand % 24) / 32), or exactly avghit
}
export const defaultDuelSettings = (mode: DuelMode = 'melee'): DuelSettings => ({ mode, distance: 3, timeLimit: 120, hpMode: 'roll' });

/** DUEL_OUTCOMES index: A killed B, B killed A, A fled, B fled, time ran out. */
export const DUEL_OUTCOMES = ['A wins', 'B wins', 'A fled', 'B fled', 'timeout'] as const;
export const DUEL_BIN = 1; // seconds per duration bin

export interface SideStats extends MonsterSink {
  dealt: number;      // HP removed from the other
  absorbed: number;   // by the other's armour
  resisted: number;   // by the other's resistances
  hpLeft: number;     // own HP at the end of fights it won, summed
  hpStart: number;    // own starting HP, summed
}
export interface DuelStats {
  n: number;
  outcomes: number[];      // by DUEL_OUTCOMES
  durSum: number[];        // seconds, by outcome
  durHist: number[];       // all fights, DUEL_BIN-second bins
  a: SideStats; b: SideStats;
  draws: number; blockOverruns: number;
}

const z = (k: number) => new Array(k).fill(0);
const emptySide = (): SideStats => ({
  srcAttempts: z(SOURCES.length), srcHits: z(SOURCES.length), srcCrits: z(SOURCES.length),
  zoneHits: z(4), zoneMisses: z(4), zoneProtMisses: z(4), defensiveCasts: 0, monHeals: 0, monHealed: 0,
  dealt: 0, absorbed: 0, resisted: 0, hpLeft: 0, hpStart: 0,
});
export const emptyDuelStats = (S: DuelSettings): DuelStats => ({
  n: 0, outcomes: z(5), durSum: z(5), durHist: z(Math.ceil(S.timeLimit / DUEL_BIN) + 1), a: emptySide(), b: emptySide(), draws: 0, blockOverruns: 0,
});

export function duelStartHp(M: MonsterProfile, mode: DuelSettings['hpMode'], rng: Rng): number {
  if (mode === 'avg') return Math.max(1, M.avghit);
  return Math.max(1, Math.trunc((M.avghit * (16 + rng.int(24))) / 32));
}

/** A critter on the receiving end of a blow. `rec` is the attacker's side record. */
export function critterDefender(me: MonsterActor, rec: SideStats, rng: Rng): Defender {
  const M = me.M;
  const apply = (dd: number, type: number) => {
    dd &= 0xff;
    const after = checkRes(M.resist, dd, type, rng);
    rec.resisted += dd - after;
    me.wake();
    const { lost, died } = me.hurt(after);
    rec.dealt += lost;
    return died;
  };
  return {
    height: M.height,
    defence: M.defence,
    protect: () => 0,
    onCritical: () => {},
    onMiss: () => me.wake(),
    blow: (dd, zone, type) => {
      const arm = creatureArmourAt(M.armour, zone, M.powerful);
      rec.absorbed += Math.min(arm, dd);
      return apply(arm > dd ? 0 : dd - arm, type);
    },
    direct: (dd, type) => apply(dd, type),
    afterMeleeHit: () => {},
    casting: 0,   // no monster here casts Shockwave; sp_shockwave would read the player's Casting
  };
}

/** One fight. aFirst: when both step on the same tick, A goes first. */
export function duel(st: DuelStats, A: MonsterProfile, B: MonsterProfile, S: DuelSettings, rng: Rng, aFirst: boolean) {
  const T = Math.round(S.timeLimit * 16);
  const ranged = S.mode === 'ranged';
  const D = ranged ? Math.max(1, Math.round(S.distance)) : 1;
  const hA = duelStartHp(A, S.hpMode, rng), hB = duelStartHp(B, S.hpMode, rng);
  const a = new MonsterActor(A, hA, true, ranged, D, st.a, rng);
  const b = new MonsterActor(B, hB, true, ranged, D, st.b, rng);
  const defA = critterDefender(a, st.b, rng), defB = critterDefender(b, st.a, rng);
  let tA = rng.int(4), tB = rng.int(4);
  let outcome = -1, t = 0;
  while (outcome < 0) {
    t = Math.min(tA, tB);
    if (t > T) { t = T; outcome = 4; break; }
    if (tA < tB || (tA === tB && aFirst)) {
      const r = a.step(defB);
      tA += a.rate;
      if (r === 1) outcome = 0; else if (r === 2) outcome = 2;
    } else {
      const r = b.step(defA);
      tB += b.rate;
      if (r === 1) outcome = 1; else if (r === 2) outcome = 3;
    }
  }
  const secs = t / 16;
  st.n++;
  st.outcomes[outcome]++;
  st.durSum[outcome] += secs;
  st.durHist[Math.min(st.durHist.length - 1, Math.floor(secs / DUEL_BIN))]++;
  st.a.hpStart += hA; st.b.hpStart += hB;
  if (outcome === 0) st.a.hpLeft += a.hp;
  if (outcome === 1) st.b.hpLeft += b.hp;
}

/** n fights, half with A first on a shared tick and half with B first. */
export function simulateDuels(st: DuelStats, A: MonsterProfile, B: MonsterProfile, S: DuelSettings, n: number, rng: Rng, parity = 0): DuelStats {
  const d0 = rng.draws;
  for (let i = 0; i < n; i++) duel(st, A, B, S, rng, ((i + parity) & 1) === 0);
  st.draws += rng.draws - d0;
  return st;
}

// ---- entrants

export interface Entrant { creature: number; powerful: boolean }
export const entrantKey = (e: Entrant) => `${e.creature}${e.powerful ? 'p' : ''}`;
/** The fighter for an entrant: its creature type at average HP (the HP actually used is rolled per fight). */
export const entrantProfile = (e: Entrant, creatures: { avghit: number }[]) =>
  monsterProfile(e.creature, creatures[e.creature].avghit, e.powerful, 0, 9);

/** A ranged attack that can hurt another critter: a missile in arms[0] (non-casters), or an offensive caster
    whose first or second spell is a missile or an area spell. */
export function hasRangedAttack(M: MonsterProfile): boolean {
  if (M.caster > 0) return M.offensive && M.spells.slice(0, 2).some((s) => s.kind === 'missile' || s.kind === 'area');
  return M.missile !== null;
}
