import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPlayerDat } from '../src/core/playerdat';
import { characterFromSave, defaultCharacter } from '../src/core/character';
import { makeRng } from '../src/core/rng';
import { defaultSettings, monsterProfile, playerProfile } from '../src/combat/setup';
import { fight, killXp, newStats, shotTimes, simulate, swingTimes } from '../src/combat/fight';
import { monsterExpectedBlow, playerBlowDist } from '../src/combat/exact';
import { creatures, SK } from '../src/data/gameData';
import { picklocDist, damageRollDist } from '../src/combat/blow';

const karl = () => characterFromSave(readPlayerDat(new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'player-karl.dat')))));
const cIndex = (name: string) => creatures.findIndex((c) => c.name === name);

describe('timing', () => {
  it('a full-charge dagger swing from tick 0', () => {
    // frames 0..3 at ticks 2,4,6,8; charge +30 per 16 units: 4 rises at ticks 10..13
    expect(swingTimes(0, 30)).toEqual({ strike: 18, next: 25 });
  });
});

describe('exact pieces', () => {
  it('probability vectors sum to one', () => {
    for (let top = 5; top < 40; top++) for (let a = 0; a < 40; a++) {
      const p = picklocDist(0, top, a, a + 20);
      expect(p.reduce((x, y) => x + y)).toBeCloseTo(1, 12);
    }
    for (let d = 0; d < 40; d++) expect(damageRollDist(d).reduce((x, y) => x + y)).toBeCloseTo(1, 12);
  });
});

describe('fights', () => {
  it('a 1-HP monster that is always hit dies at the first strike', () => {
    const c = karl();
    c.skills[SK.Attack] = 30; c.skills[SK.Sword] = 30;
    const P = playerProfile(c, null);
    const M = monsterProfile(cIndex('Giant Rat (0x43)'), 1, false, 0);
    const S = defaultSettings();
    const st = newStats(P, M, S);
    simulate(st, P, M, S, { kind: 'set', value: 1 }, 500, makeRng(1));
    expect(st.outcomes).toEqual([500, 0, 0, 0]);
    expect(st.durSum[0] / 500).toBeCloseTo(swingTimes(0, P.melee.speed).strike / 16, 6);
  });

  it('invariants: outcomes sum to N, HP lost equals the damage shares, same seed same result', () => {
    const P = playerProfile(karl(), null);
    const M = monsterProfile(cIndex('Goblin (0x46)'), 15, false, 0);
    const S = defaultSettings();
    const run = () => simulate(newStats(P, M, S), P, M, S, { kind: 'stored' }, 2000, makeRng(7));
    const a = run(), b = run();
    expect(a).toEqual(b);
    expect(a.outcomes.reduce((x, y) => x + y)).toBe(2000);
    const dealt = a.dealt.reduce((x, y) => x + y);
    expect(dealt).toBeCloseTo(a.dealtPerFight, 6);
    expect(a.srcDamage.reduce((x, y) => x + y)).toBeCloseTo(a.zoneDamage.reduce((x, y) => x + y), 6);
  });

  it('simulated player damage per swing matches the exact one-blow mean', () => {
    const P = playerProfile(karl(), null);
    for (const name of ['Goblin (0x46)', 'Skeleton', 'Giant Spider', 'Cave Bat']) {
      const M = monsterProfile(cIndex(name), 255, false, 0);
      const S = { ...defaultSettings(), timeLimit: 30 };
      const st = newStats(P, M, S);
      simulate(st, P, M, S, { kind: 'set', value: 255 }, 3000, makeRng(11));
      const exact = playerBlowDist(P, M, S);
      const total = st.dealt.reduce((x, y) => x + y) + st.overkill;
      const mean = total / st.pSwings;
      const sd = Math.sqrt(exact.dist.reduce((s, p, v) => s + p * (v - exact.mean) ** 2, 0) / st.pSwings);
      expect(Math.abs(mean - exact.mean)).toBeLessThan(5 * sd + 1e-9);
      expect(Math.abs(st.pMisses / st.pSwings - exact.pMiss)).toBeLessThan(0.02);
    }
  });

  it('simulated monster damage per attack matches the exact expectation', () => {
    const c = defaultCharacter();
    const P = { ...playerProfile(c, null), hp: 100000, hpMax: 100000 };
    for (const name of ['Goblin (0x47)', 'Giant Spider', 'Troll']) {
      const M = monsterProfile(cIndex(name), 255, false, 0);
      const S = { ...defaultSettings(), timeLimit: 60 };
      const st = newStats(P, M, S);
      simulate(st, P, M, S, { kind: 'set', value: 255 }, 1000, makeRng(3));
      const att = st.srcAttempts.slice(0, 3).reduce((x, y) => x + y);
      const dmg = st.srcDamage.slice(0, 3).reduce((x, y) => x + y);
      const ex = monsterExpectedBlow(M, P);
      expect(Math.abs(dmg / att - ex.mean) / Math.max(1, ex.mean)).toBeLessThan(0.05);
      const hits = st.srcHits.slice(0, 3).reduce((x, y) => x + y);
      expect(Math.abs(hits / att - ex.pHit)).toBeLessThan(0.02);
    }
  });

  it('more armour or a better weapon never lowers the win rate (monotonic ladder)', () => {
    const base = karl();
    const M = monsterProfile(cIndex('Goblin (0x47)'), 21, false, 0);
    const S = defaultSettings();
    const win = (c: ReturnType<typeof karl>) => {
      const P = playerProfile(c, null);
      return simulate(newStats(P, M, S), P, M, S, { kind: 'stored' }, 4000, makeRng(5)).outcomes[0] / 4000;
    };
    const w0 = win(base);
    const armoured = karl(); armoured.equipment[1] = { itemId: 0x22, quality: 63, ench: null };
    const sword = karl(); sword.equipment[7] = { itemId: 5, quality: 63, ench: null };
    expect(win(armoured)).toBeGreaterThanOrEqual(w0 - 0.02);
    expect(win(sword)).toBeGreaterThanOrEqual(w0 - 0.02);
    // weaker enemies are easier
    const rat = monsterProfile(cIndex('Giant Rat (0x43)'), 8, false, 0);
    const P = playerProfile(base, null);
    const wr = simulate(newStats(P, rat, S), P, rat, S, { kind: 'stored' }, 4000, makeRng(5)).outcomes[0] / 4000;
    expect(wr).toBeGreaterThan(w0);
  });

  it('item 0x7C resists everything: a timeout', () => {
    const P = playerProfile(karl(), null);
    const M = monsterProfile(0x3c, 250, false, 0);
    const S = { ...defaultSettings(), timeLimit: 5 };
    const st = newStats(P, M, S);
    fight(st, { ...P, hp: 1000 }, M, S, { kind: 'stored' }, makeRng(2));
    expect(st.outcomes[0]).toBe(0);
  });
});

describe('ranged', () => {
  it('a sling shoots, a slinger goblin shoots back at 3 tiles but not at 4', () => {
    const c = karl();
    c.equipment[7] = { itemId: 0x18, quality: 40, ench: null };
    c.skills[SK.Missile] = 10;
    const P = playerProfile(c, null);
    expect(P.launcher?.ammoName).toBe('Sling Stone');
    const M = monsterProfile(cIndex('Goblin (0x4D)'), 27, false, 0);
    for (const [dist, fires] of [[3, true], [4, false]] as const) {
      const S = { ...defaultSettings(), mode: 'ranged' as const, distance: dist, timeLimit: 60 };
      const st = simulate(newStats(P, M, S), P, M, S, { kind: 'stored' }, 300, makeRng(9));
      expect(st.pShots).toBeGreaterThan(0);
      expect(st.srcAttempts[3] > 0).toBe(fires);
      expect(st.srcAttempts[0]).toBe(0); // no melee at range
    }
  });
  it('Magic Arrow: casts, fizzles and backfires are counted and mana runs out', () => {
    const c = defaultCharacter();
    c.runes = [9, 14]; c.manaMax = 12; c.skills[SK.Casting] = 3;
    const P = playerProfile(c, 2);
    expect(P.attackSpell?.missile?.name).toBe('Magic Missile');
    const M = monsterProfile(cIndex('Giant Rat (0x43)'), 255, false, 0);
    const S = { ...defaultSettings(), mode: 'ranged' as const, timeLimit: 40 };
    const st = simulate(newStats(P, M, S), P, M, S, { kind: 'set', value: 255 }, 200, makeRng(4));
    expect(st.casts + st.backfires).toBe(st.manaSpent / 3);
    expect(st.manaSpent / 200).toBeLessThanOrEqual(12 + 3 * 2); // full mana plus at most a regen or two
    expect(st.fizzles).toBeGreaterThan(0);
  });
});

describe('review fixes', () => {
  it('a launcher shot: frames 0-3, aim, fire, ready at the next boundary', () => {
    expect(shotTimes(0, 16)).toEqual({ fire: 24, next: 27 });
  });
  it('a worn-out shield breaks and the character is recomputed', () => {
    const c = karl();
    c.equipment[8] = { itemId: 0x3c, quality: 1, ench: null }; // wooden shield, quality 1
    const P = { ...playerProfile(c, null), hp: 5000, hpMax: 5000 };
    const M = monsterProfile(cIndex('Troll'), 255, false, 0);
    const S = { ...defaultSettings(), timeLimit: 120 };
    const st = simulate(newStats(P, M, S), P, M, S, { kind: 'set', value: 255 }, 50, makeRng(8));
    expect(st.armourBroken).toBeGreaterThan(0);
    expect(c.equipment[8].quality).toBe(1); // the character itself is untouched
  });
  it('the Wisp ignores being hit: it never flees', () => {
    const P = playerProfile(karl(), null);
    const M = monsterProfile(cIndex('Wisp'), 200, false, 0);
    expect(M.ignoresFights).toBe(true);
    const S = { ...defaultSettings(), timeLimit: 20 };
    const st = simulate(newStats(P, M, S), { ...P, hp: 5000, hpMax: 5000 }, M, S, { kind: 'set', value: 4 }, 200, makeRng(2));
    expect(st.outcomes[2]).toBe(0);
  });
});

describe('experience (player_killed_a, player_get_exp)', () => {
  // a random source that returns fixed values: rollem dice give `die` each, rand() % n gives `r`
  const fixed = (die: number, r: number) => ({ next: () => 0, int: () => r, rollem: (d: number) => d * die });
  const P = { level: 1, expRaw: 0 };
  it('exp * 4 + 2d(exp)', () => {
    const M = monsterProfile(cIndex('Giant Rat (0x43)'), 8, false, 0, 1); // exp 8
    expect(killXp(M, P, fixed(8, 0)).awarded).toBe(8 * 4 + 16);
  });
  it('powerful: times (24 + rand % 24) / 16, in a 16-bit int that wraps', () => {
    const goblin = monsterProfile(cIndex('Goblin (0x46)'), 21, true, 0, 1); // exp 5: 20 + 2d5
    expect(killXp(goblin, P, fixed(5, 0)).awarded).toBe(Math.trunc((30 * 24) / 16));
    const troll = monsterProfile(cIndex('Great Troll'), 100, true, 0, 4); // exp 438
    const x = killXp(troll, { level: 1, expRaw: 500 }, fixed(438, 6)); // 1752 + 876 = 2628, x 30 = 78840
    expect(x.wrapped).toBe(true);
    expect(x.nominal).toBe(Math.trunc(78840 / 16));
    // 78840 & 0xFFFF = 13304 -> 831
    expect(x.awarded).toBe(831);
    const y = killXp(troll, { level: 1, expRaw: 500 }, fixed(438, 0)); // 2628 x 24 = 63072 -> -2464 -> -154
    expect(y.awarded).toBe(-154);
    const z = killXp(troll, { level: 1, expRaw: 100 }, fixed(438, 0));
    expect(z.awarded).toBe(-100); // a loss stops at 0 experience
  });
  it('halved (+1) above twice the dungeon level plus two; nothing above 0x17700', () => {
    const M = monsterProfile(cIndex('Giant Rat (0x43)'), 8, false, 0, 1);
    expect(killXp(M, { level: 5, expRaw: 0 }, fixed(8, 0)).awarded).toBe(24 + 1);
    expect(killXp(M, { level: 4, expRaw: 0 }, fixed(8, 0)).awarded).toBe(48);
    expect(killXp(M, { level: 16, expRaw: 0x17701 }, fixed(8, 0)).awarded).toBe(0);
  });
  it('only kills pay: XP sums over wins only', () => {
    const P2 = playerProfile(karl(), null);
    const M = monsterProfile(cIndex('Giant Rat (0x43)'), 8, false, 0, 1); // exp 8, a full-HP rat that fights on
    const S = defaultSettings();
    const st = simulate(newStats(P2, M, S), P2, M, S, { kind: 'stored' }, 2000, makeRng(3));
    expect(st.outcomes[0]).toBeGreaterThan(500);
    expect(st.xp / st.outcomes[0]).toBeGreaterThanOrEqual(8 * 4 + 2);
    expect(st.xp / st.outcomes[0]).toBeLessThanOrEqual(8 * 4 + 16);
  });
});
