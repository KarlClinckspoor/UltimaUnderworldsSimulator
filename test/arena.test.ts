// The arena (plan Part C, tests C9): duels between monsters, the critter defender, the rating fit, and
// the shipped reference run.
import { describe, expect, it } from 'vitest';
import { makeRng } from '../src/core/rng';
import { pPass } from '../src/core/skillcheck';
import { MonsterActor } from '../src/combat/actor';
import {
  critterDefender, defaultDuelSettings, emptyDuelStats, entrantProfile, hasRangedAttack, simulateDuels, type DuelStats,
} from '../src/combat/duel';
import { monsterProfile, type MonsterProfile } from '../src/combat/setup';
import { creatures } from '../src/data/gameData';
import { ARENA_ENGINE, arenaEntrants, packRun, pairFromStats, unpackRun, type PackedRun } from '../src/arena/arena';
import { expected, fitRatings, upsets, type PairCounts } from '../src/arena/rating';
import arenaJson from '../src/data/arena.json';

const cIndex = (name: string) => creatures.findIndex((c) => c.name === name);
const prof = (name: string, powerful = false) => monsterProfile(cIndex(name), creatures[cIndex(name)].avghit, powerful, 0, 9);
const wil = (k: number, n: number) => 1.96 * Math.sqrt((k / n) * (1 - k / n) / n) + 0.5 / n;

describe('critter defender (COMBAT.C, hitobj != 1)', () => {
  const side = () => emptyDuelStats(defaultDuelSettings()).a;
  it('armour at the zone, x5/3 when powerful; no easy-mode halving; check_res', () => {
    const rng = makeRng(3);
    for (const pw of [false, true]) {
      const M = prof('Great Troll', pw);          // armour 5/4/4/4
      const me = new MonsterActor(M, 200, true, false, 1, side(), rng);
      const rec = side();
      const d = critterDefender(me, rec, rng);
      d.blow(20, 0, 0x04, 0);
      const arm = pw ? Math.trunc((5 * 5) / 3) : 5;
      expect(me.hp).toBe(200 - (20 - arm));
      expect(rec.absorbed).toBe(arm);
      expect(rec.dealt).toBe(20 - arm);
      d.blow(2, 1, 0x04, 0);                         // armour above the damage: nothing
      expect(me.hp).toBe(200 - (20 - arm));
      expect(me.lastHit).toBe(true);                 // a hit for 0 still records the attacker
    }
  });
  it('no to-hit protection, no armour wear, no poison: those draw nothing', () => {
    const rng = makeRng(5);
    const me = new MonsterActor(prof('Skeleton'), 30, true, false, 1, side(), rng);
    const d = critterDefender(me, side(), rng);
    const before = rng.draws;
    expect(d.protect(0)).toBe(0);
    d.onCritical(2); d.afterMeleeHit(9);
    expect(rng.draws).toBe(before);
    expect(d.defence).toBe(creatures[cIndex('Skeleton')].defence);
  });
  it('a miss wakes the defender (damage_item with 0), so it runs the flee test', () => {
    const rng = makeRng(1);
    const me = new MonsterActor(prof('Skeleton'), 30, true, false, 1, side(), rng);
    critterDefender(me, side(), rng).onMiss();
    expect(me.lastHit).toBe(true);
  });
});

describe('duels', () => {
  const S = defaultDuelSettings('melee');
  const run = (A: MonsterProfile, B: MonsterProfile, n: number, seed = 1, s = S): DuelStats =>
    simulateDuels(emptyDuelStats(s), A, B, s, n, makeRng(seed));

  it('the same seed gives the same results', () => {
    const a = run(prof('Skeleton'), prof('Goblin (0x46)'), 300, 9), b = run(prof('Skeleton'), prof('Goblin (0x46)'), 300, 9);
    expect(a).toEqual(b);
  });
  it('a monster against itself is even (mirror symmetry)', () => {
    const st = run(prof('Skeleton'), prof('Skeleton'), 20000, 2);
    const n = st.n, pa = (st.outcomes[0] + st.outcomes[3]) / n, pb = (st.outcomes[1] + st.outcomes[2]) / n;
    expect(Math.abs(pa - pb)).toBeLessThan(2 * wil(n / 2, n));
  });
  it('swapping the sides mirrors the outcomes', () => {
    const ab = run(prof('Giant Rat (0x43)'), prof('Skeleton'), 20000, 4), ba = run(prof('Skeleton'), prof('Giant Rat (0x43)'), 20000, 5);
    for (const [x, y] of [[0, 1], [1, 0], [2, 3], [3, 2]]) expect(Math.abs(ab.outcomes[x] - ba.outcomes[y]) / ab.n).toBeLessThan(2 * wil(ab.outcomes[x], ab.n) + 0.002);
  });
  it("a rat's bite lands as often as skill_check says against the defender's defence", () => {
    // the rat has one attack: to-hit 4 + equip 4 / 2 = 6, against the skeleton's defence 7, no cmbModTH (UW1 stats)
    const st = run(prof('Giant Rat (0x43)'), prof('Skeleton'), 20000, 6);
    const p = pPass(6, creatures[cIndex('Skeleton')].defence, 'game');
    const att = st.a.srcAttempts[0], hit = st.a.srcHits[0];
    expect(att).toBeGreaterThan(5000);
    expect(Math.abs(hit / att - p)).toBeLessThan(3 * Math.sqrt((p * (1 - p)) / att));
  });
  it('two fighters that cannot hurt each other time out every fight', () => {
    const immune = (name: string): MonsterProfile => ({ ...prof(name), resist: 0x04 });   // physical blows cancelled
    const s = { ...S, hpMode: 'avg' as const, timeLimit: 20 };   // at full HP nobody flees
    const st = run(immune('Skeleton'), immune('Great Troll'), 200, 7, s);
    expect(st.outcomes[4]).toBe(200);
    expect(st.a.dealt + st.b.dealt).toBe(0);
  });
  it('a 1 HP fighter that never hits loses within the first blow cycle', () => {
    const weak: MonsterProfile = { ...prof('Giant Rat (0x43)'), avghit: 1, attacks: [{ chance: -100, damage: 1, prob: 100 }, { chance: 0, damage: 0, prob: 0 }, { chance: 0, damage: 0, prob: 0 }] };
    const sure: MonsterProfile = { ...prof('Metal Golem'), attacks: [{ chance: 100, damage: 35, prob: 100 }, { chance: 0, damage: 0, prob: 0 }, { chance: 0, damage: 0, prob: 0 }] };
    const st = run(weak, sure, 500, 8, { ...S, hpMode: 'avg' });
    expect(st.outcomes[1]).toBe(500);
    // each step starts an attack 1 time in 4; then the blow on the 4th step: a minute is far more than enough
    expect(st.durSum[1] / 500).toBeLessThan(10);
  });
  it('the ranged pool: the 12 types with a damaging ranged attack', () => {
    const r = arenaEntrants('ranged', false).map((e) => creatures[e.creature].name);
    expect(r).toHaveLength(12);
    expect(r).toContain('Goblin (0x4D)');
    expect(r).toContain('Imp');
    expect(r).toContain('Mage (0x73)');
    expect(arenaEntrants('melee', false)).toHaveLength(60);
    expect(arenaEntrants('melee', true)).toHaveLength(120);
    expect(hasRangedAttack(prof('Great Troll'))).toBe(false);
  });
});

describe('rating fit (Bradley-Terry on the Elo scale)', () => {
  const synth = (truth: number[], n: number, seed: number): PairCounts[] => {
    const rng = makeRng(seed, 0, 'ideal');
    const out: PairCounts[] = [];
    for (let i = 0; i < truth.length; i++) for (let j = i + 1; j < truth.length; j++) {
      const p = expected(truth[i], truth[j]);
      let w = 0;
      for (let k = 0; k < n; k++) if (rng.next() < p) w++;
      out.push({ i, j, iWins: w, jWins: n - w, iFled: 0, jFled: 0, timeouts: 0 });
    }
    return out;
  };
  const truth = [1200, 1350, 1500, 1500, 1650, 1800];
  it('recovers known ratings', () => {
    const r = fitRatings(truth.length, synth(truth, 4000, 1), undefined, 0);
    const mean = truth.reduce((a, b) => a + b) / truth.length;
    truth.forEach((t, i) => expect(Math.abs(r.rating[i] - (t - mean + 1500))).toBeLessThan(Math.max(15, r.ci[i])));
  });
  it('does not depend on the order of the pairs', () => {
    const p = synth(truth, 500, 2);
    const a = fitRatings(truth.length, p), b = fitRatings(truth.length, [...p].reverse());
    a.rating.forEach((x, i) => expect(b.rating[i]).toBeCloseTo(x, 6));
  });
  it('a perfect record stays finite; an excluded entrant is unrated and its games do not count', () => {
    const p: PairCounts[] = [
      { i: 0, j: 1, iWins: 100, jWins: 0, iFled: 0, jFled: 0, timeouts: 0 },
      { i: 0, j: 2, iWins: 100, jWins: 0, iFled: 0, jFled: 0, timeouts: 0 },
      { i: 1, j: 2, iWins: 60, jWins: 40, iFled: 0, jFled: 0, timeouts: 0 },
    ];
    const r = fitRatings(3, p);
    expect(Number.isFinite(r.rating[0])).toBe(true);
    expect(r.rating[0]).toBeGreaterThan(r.rating[1]);
    const e = fitRatings(3, p, undefined, 1, [false, false, true]);
    expect(e.rated).toEqual([true, true, false]);
    expect(e.games[1]).toBe(100);
  });
  it('scoring: flight is a loss for the one who fled, or a draw; timeouts a draw or left out', () => {
    const p: PairCounts[] = [{ i: 0, j: 1, iWins: 10, jWins: 10, iFled: 20, jFled: 0, timeouts: 10 }];
    const loss = fitRatings(2, p, { flee: 'loss', timeout: 'draw' }, 0);
    expect(loss.W[0][1]).toBe(15); expect(loss.G[0][1]).toBe(50);
    const draw = fitRatings(2, p, { flee: 'draw', timeout: 'ignore' }, 0);
    expect(draw.W[0][1]).toBe(20); expect(draw.G[0][1]).toBe(40);
  });
  it('upsets are the pairs furthest from the prediction', () => {
    const p = synth([1300, 1500, 1700], 1000, 3);
    p[1] = { ...p[1], iWins: 900, jWins: 100 };      // the weakest beats the strongest
    const u = upsets(fitRatings(3, p), 1)[0];
    expect([u.i, u.j]).toEqual([0, 2]);
  });
});

describe('reference run (src/data/arena.json)', () => {
  const ref = arenaJson as unknown as Record<'melee' | 'ranged', PackedRun>;
  it('was made by the current engine, with the current entrants', () => {
    for (const mode of ['melee', 'ranged'] as const) {
      expect(ref[mode].engine).toBe(ARENA_ENGINE);
      expect(ref[mode].entrants).toEqual(arenaEntrants(mode, false));
    }
  });
  it('packs and unpacks losslessly', () => {
    const u = unpackRun(ref.ranged);
    expect(packRun(u).pairs).toEqual(ref.ranged.pairs);
  });
  it('a live run with the same settings reproduces it pair for pair', () => {
    for (const mode of ['melee', 'ranged'] as const) {
      const run = unpackRun(ref[mode]);
      const profs = run.entrants.map((e) => entrantProfile(e, creatures));
      for (const k of [0, Math.floor(run.pairs.length / 2), run.pairs.length - 1]) {
        const p = run.pairs[k];
        const st = simulateDuels(emptyDuelStats(run.settings), profs[p.i], profs[p.j], run.settings, run.n, makeRng(run.seed, k, run.rand, run.pairs.length));
        expect(pairFromStats(p.i, p.j, st)).toEqual(p);
      }
    }
  });
});
