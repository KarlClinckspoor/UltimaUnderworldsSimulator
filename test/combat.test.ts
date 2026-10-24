import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPlayerDat } from '../src/core/playerdat';
import { characterFromSave, defaultCharacter, derive } from '../src/core/character';
import { makeRng } from '../src/core/rng';
import { defaultSettings, monsterProfile, playerProfile, spellAttackOf } from '../src/combat/setup';
import { areaSquareIndex, fight, killXp, newStats, shotTimes, simulate, swingFrames, swingTimes } from '../src/combat/fight';
import { monsterExpectedBlow, playerBlowDist } from '../src/combat/exact';
import { creatures, SK } from '../src/data/gameData';
import { picklocDist, damageRollDist, checkRes, isSharp } from '../src/combat/blow';

const karl = () => characterFromSave(readPlayerDat(new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'player-karl.dat')))));
const cIndex = (name: string) => creatures.findIndex((c) => c.name === name);
const RAT = 'Giant tan rat', GOBLIN = 'Goblin (0x49)', GOBLIN2 = 'Goblin (0x4A)', TROLL = 'Great troll';

describe('timing (WEAP.DAT and CR.AN)', () => {
  it('swing frames: slash 3/6/9 for every weapon, sword bash strikes a frame later, stab and fist wind up faster', () => {
    expect(swingFrames(0, 0, 1)).toEqual({ hold: 3, strike: 6, total: 9 });   // sword slash
    expect(swingFrames(0, 1, 1)).toEqual({ hold: 3, strike: 7, total: 9 });   // sword bash
    expect(swingFrames(1, 1, 1)).toEqual({ hold: 3, strike: 6, total: 9 });   // axe bash
    expect(swingFrames(2, 2, 0)).toEqual({ hold: 1, strike: 4, total: 7 });   // mace stab, right-handed
    expect(swingFrames(3, 0, 1)).toEqual({ hold: 1, strike: 4, total: 7 });   // fist
    expect(swingFrames(-1, 0, 1)).toEqual({ hold: 2, strike: 6, total: 9 });  // the idle table
  });
  it('a full-charge dagger slash from tick 0 is UW1 timing; its stab is four ticks quicker', () => {
    // dagger speed 28: 4 rises of 28 reach 100; hold frame 3 at tick 8, release at 13, frames resume at 14
    expect(swingTimes(0, 28, swingFrames(0, 0, 1))).toEqual({ strike: 18, next: 25 });
    expect(swingTimes(0, 28, swingFrames(0, 2, 1))).toEqual({ strike: 14, next: 21 });
  });
  it('a launcher shot: the idle hold frame at tick 6, aim, fire, ready at the next boundary', () => {
    expect(shotTimes(0, 16)).toEqual({ fire: 22, next: 25 });
  });
  it('monster attacks recur every seq_len + 4 AI steps on average (start 1 in 4, then seq_len steps)', () => {
    const c = karl();
    const P = { ...playerProfile(c, null), hp: 100000, hpMax: 100000 };
    for (const [name, L] of [['Lurker', 4], [GOBLIN, 7], ['Skeleton', 6]] as const) {
      const M = monsterProfile(cIndex(name), 255, false, 0);
      expect(M.seqLen[3]).toBe(L);
      const S = { ...defaultSettings(), timeLimit: 400 };
      const st = simulate(newStats(P, M, S), P, M, S, { kind: 'set', value: 255 }, 20, makeRng(1));
      const steps = (st.durSum.reduce((a, b) => a + b) * 16) / 4;
      const rate = st.srcAttempts.slice(0, 3).reduce((a, b) => a + b) / steps;
      expect(rate).toBeGreaterThan((1 / (L + 4)) * 0.9);
      expect(rate).toBeLessThan((1 / (L + 4)) * 1.1);
    }
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
  it('check_res doubles fire on the cold-resistant and cold on the fire-resistant', () => {
    const r = makeRng(1);
    expect(checkRes(0x20, 10, 0x08, r)).toBe(20);   // fire on cold resistance
    expect(checkRes(0x08, 10, 0x20, r)).toBe(20);   // cold on fire resistance
    expect(checkRes(0x28, 10, 0x08, r)).toBe(0);    // resists fire outright
    expect(checkRes(0x08, 200, 0x20, r)).toBe(0xff);
    expect(checkRes(0x08, 10, 0x08, r)).toBe(0);
    expect(checkRes(0x00, 10, 0x23, r)).toBe(10);
  });
  it('is_sharp: not the cudgel, light mace, mace or sling', () => {
    expect([3, 5, 7, 8, 9, 0x18, 0x19, 0x10].map(isSharp)).toEqual([true, true, false, false, false, false, true, true]);
  });
  it('area geometry: flame wind and sheet lightning reach 2..7 squares ahead, shockwave 1..2, frost 2..5', () => {
    expect([1, 2, 7, 8].map((d) => areaSquareIndex('flame', d) >= 0)).toEqual([false, true, true, false]);
    expect([1, 2, 3].map((d) => areaSquareIndex('shockwave', d) >= 0)).toEqual([true, true, false]);
    expect([1, 2, 5, 6].map((d) => areaSquareIndex('frost', d) >= 0)).toEqual([false, true, true, false]);
    expect(areaSquareIndex('sheet', 4)).toBe(2 * 6 + 2);
  });
});

describe('player profile (DoPlayerWeapon)', () => {
  it('to-hit: Attack/2 + weapon skill + Valor + DEX/7; the dagger uses the sword skill', () => {
    const c = karl();
    const P = playerProfile(c, null);
    expect(P.melee.name).toBe('Dagger');
    expect(P.melee.askill).toBe(6 + 0 + 0 + 2);
    c.buffs = [9]; c.runes = [16, 0, 2]; c.level = 3; c.manaMax = 10; c.skills[SK.Casting] = 10;
    const d = derive(c);
    expect(d.valor).toBe(12);
    expect(playerProfile(c, null).melee.askill).toBe(6 + 0 + 12 + 2);
  });
  it('class 12 enchantments: damage 2e+1, to-hit 2e-7, specials from 8', () => {
    const c = karl();
    c.equipment[7] = { itemId: 5, quality: 63, ench: { major: 12, effect: 2 } };
    expect(playerProfile(c, null).melee.ench).toBe(5);
    c.equipment[7] = { itemId: 5, quality: 63, ench: { major: 12, effect: 6 } };
    expect(playerProfile(c, null).melee.toHitEnch).toBe(5);
    c.equipment[7] = { itemId: 5, quality: 63, ench: { major: 12, effect: 10 } };
    expect(playerProfile(c, null).melee.specweap).toBe(3);
  });
  it('spell attacks: missiles, areas and targeted spells; buffs are not attacks', () => {
    expect(spellAttackOf(2, 1)?.missile?.name).toBe('Magic arrow');
    expect(spellAttackOf(10, 1)?.missile?.name).toBe('Homing dart');
    expect(spellAttackOf(56, 1)?.area).toBe('flame');
    expect(spellAttackOf(51, 1)?.area).toBe('shockwave');
    expect(spellAttackOf(62, 1)?.target).toBe('smite');
    expect(spellAttackOf(9, 1)).toBeNull();
    expect(spellAttackOf(2, 1)?.delayTicks).toBe(Math.ceil(((2 - 1) * 4 + 0x80) / 16));
  });
});

describe('fights', () => {
  it('a 1-HP monster that is always hit dies at the first strike', () => {
    const c = karl();
    c.skills[SK.Attack] = 30; c.skills[SK.Sword] = 30;
    const P = playerProfile(c, null);
    const M = monsterProfile(cIndex(RAT), 1, false, 0);
    const S = defaultSettings();
    const st = newStats(P, M, S);
    simulate(st, P, M, S, { kind: 'set', value: 1 }, 500, makeRng(1));
    expect(st.outcomes).toEqual([500, 0, 0, 0]);
    expect(st.durSum[0] / 500).toBeCloseTo(swingTimes(0, P.melee.speed, swingFrames(0, 2, 1)).strike / 16, 6);
  });

  it('invariants: outcomes sum to N, HP lost equals the damage shares, same seed same result', () => {
    const P = playerProfile(karl(), null);
    const M = monsterProfile(cIndex(GOBLIN), 15, false, 0);
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
    const c = karl();
    c.equipment[7].quality = 63; // the save's dagger is badly worn and would break mid-test
    const P = playerProfile(c, null);
    for (const name of [GOBLIN, 'Skeleton', 'Giant spider', 'Cave bat']) {
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

  it('poison weapon: a sharp weapon on a bleeding foe does more, nothing on a skeleton', () => {
    const c = karl();
    c.buffs = [26]; c.runes = [13, 9, 23]; c.level = 7; c.manaMax = 20; c.skills[SK.Casting] = 10; c.dungeonLevel = 9;
    expect(derive(c).poisonWeap).toBe(true);
    const P = playerProfile(c, null);
    expect(P.melee.poison).toBe(true);
    const plain = playerProfile(karl(), null);
    const S = defaultSettings();
    const g = monsterProfile(cIndex(GOBLIN), 255, false, 0);
    expect(playerBlowDist(P, g, S).mean).toBeGreaterThan(playerBlowDist({ ...plain, casting: 10 }, g, S).mean * 1.5);
    const sk = monsterProfile(cIndex('Skeleton'), 255, false, 0);
    expect(playerBlowDist(P, sk, S).mean).toBeCloseTo(playerBlowDist({ ...plain, casting: 10 }, sk, S).mean, 9);
    const st = simulate(newStats(P, g, S), P, g, S, { kind: 'set', value: 255 }, 2000, makeRng(2));
    expect(st.dealt[7]).toBeGreaterThan(0);
  });

  it('simulated monster damage per attack matches the exact expectation', () => {
    const c = defaultCharacter();
    const P = { ...playerProfile(c, null), hp: 100000, hpMax: 100000 };
    for (const name of [GOBLIN2, 'Giant spider', TROLL]) {
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
    const M = monsterProfile(cIndex(GOBLIN2), 21, false, 0);
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
    const rat = monsterProfile(cIndex(RAT), 8, false, 0);
    const P = playerProfile(base, null);
    const wr = simulate(newStats(P, rat, S), P, rat, S, { kind: 'stored' }, 4000, makeRng(5)).outcomes[0] / 4000;
    expect(wr).toBeGreaterThan(w0);
  });

  it('the healing weapon gives HP back on criticals; the holding weapon freezes the monster', () => {
    const c = karl();
    c.skills[SK.Attack] = 30; c.skills[SK.Sword] = 30; c.skills[SK.Casting] = 30;
    c.equipment[7] = { itemId: 5, quality: 63, ench: { major: 12, effect: 8 } };
    const P = playerProfile(c, null);
    expect(P.melee.specweap).toBe(1);
    const M = monsterProfile(cIndex(TROLL), 255, false, 0);
    const S = { ...defaultSettings(), timeLimit: 60 };
    const st = simulate(newStats(P, M, S), P, M, S, { kind: 'set', value: 255 }, 200, makeRng(6));
    expect(st.specialTriggers).toBeGreaterThan(0);
    expect(st.specialHealed).toBeGreaterThan(0);
    c.equipment[7] = { itemId: 5, quality: 63, ench: { major: 12, effect: 11 } };
    const P4 = playerProfile(c, null);
    const s4 = simulate(newStats(P4, M, S), P4, M, S, { kind: 'set', value: 255 }, 200, makeRng(6));
    expect(s4.specialHeldTicks).toBeGreaterThan(0);
    const sk = monsterProfile(cIndex('Skeleton'), 255, false, 0); // undead: cannot be held
    const s5 = simulate(newStats(P4, sk, S), P4, sk, S, { kind: 'set', value: 255 }, 100, makeRng(6));
    expect(s5.specialHeldTicks).toBe(0);
  });
});

describe('ranged and spells', () => {
  it('a sling shoots, a slinger shoots back at 3 tiles but not at 4', () => {
    const c = karl();
    c.equipment[7] = { itemId: 0x18, quality: 40, ench: null };
    c.skills[SK.Missile] = 10;
    const P = playerProfile(c, null);
    expect(P.launcher?.ammoName).toBe('Sling stone');
    const slinger = creatures.findIndex((cr) => cr.firesMissile !== null && cr.avghit > 0);
    const M = monsterProfile(slinger, 27, false, 0);
    for (const [dist, fires] of [[3, true], [4, false]] as const) {
      const S = { ...defaultSettings(), mode: 'ranged' as const, distance: dist, timeLimit: 60 };
      const st = simulate(newStats(P, M, S), P, M, S, { kind: 'stored' }, 300, makeRng(9));
      expect(st.pShots).toBeGreaterThan(0);
      expect(st.srcAttempts[3] > 0).toBe(fires);
      expect(st.srcAttempts[0]).toBe(0);
    }
  });
  it('Magic Arrow: Casting against 3 x circle; casts, fizzles and backfires are counted and mana runs out', () => {
    const c = defaultCharacter();
    c.runes = [9, 14]; c.manaMax = 12; c.skills[SK.Casting] = 5;
    const P = playerProfile(c, 2);
    expect(P.attackSpell?.missile?.name).toBe('Magic arrow');
    const M = monsterProfile(cIndex(RAT), 255, false, 0);
    const S = { ...defaultSettings(), mode: 'ranged' as const, timeLimit: 40 };
    const st = simulate(newStats(P, M, S), P, M, S, { kind: 'set', value: 255 }, 200, makeRng(4));
    expect(st.casts + st.backfires).toBe(st.manaSpent / 3);
    expect(st.manaSpent / 200).toBeLessThanOrEqual(12 + 3 * 2);
    expect(st.fizzles).toBeGreaterThan(0);
  });
  it('Fireball is refused in Britannia and cast on level 9', () => {
    const c = defaultCharacter();
    c.runes = [15, 5]; c.manaMax = 30; c.level = 9; c.skills[SK.Casting] = 20;
    expect(playerProfile(c, 33, 3).attackSpell).toBeNull();
    expect(playerProfile(c, 33, 3).attackSpellBlocked).toContain('Britannia');
    expect(playerProfile(c, 33, 9).attackSpell?.missile?.damage).toBe(28);
  });
  it('Smite Foe pays mana only on a bleeding target; Repel Undead only hurts the undead', () => {
    const c = defaultCharacter();
    c.runes = [...Array(24).keys()]; c.manaMax = 60; c.level = 16; c.skills[SK.Casting] = 30; c.dungeonLevel = 9;
    const S = { ...defaultSettings(), mode: 'ranged' as const, timeLimit: 20, distance: 4 };
    const P = playerProfile(c, 62, 9);
    expect(P.attackSpell?.target).toBe('smite');
    const g = monsterProfile(cIndex(GOBLIN), 35, false, 0, 9);
    const sg = simulate(newStats(P, g, S), P, g, S, { kind: 'stored' }, 100, makeRng(5));
    expect(sg.outcomes[0]).toBe(100); // 200 damage on 35 HP
    const sk = monsterProfile(cIndex('Skeleton'), 20, false, 0, 9);
    const ss = simulate(newStats(P, sk, S), P, sk, S, { kind: 'stored' }, 50, makeRng(5));
    expect(ss.targetRefused).toBeGreaterThan(0);
    expect(ss.manaSpent).toBe(ss.backfires * 24);
    const R = playerProfile(c, 21, 9);
    expect(R.attackSpell?.area).toBe('repel');
    const sr = simulate(newStats(R, sk, S), R, sk, S, { kind: 'stored' }, 100, makeRng(5));
    expect(sr.outcomes[0]).toBeGreaterThan(50);
    const sgr = simulate(newStats(R, g, S), R, g, S, { kind: 'stored' }, 50, makeRng(5));
    expect(sgr.dealt.reduce((a, b) => a + b)).toBe(0);
  });
  it('Flame Wind cannot reach a monster in reach, Shockwave can', () => {
    const c = defaultCharacter();
    c.runes = [...Array(24).keys()]; c.manaMax = 60; c.level = 16; c.skills[SK.Casting] = 30;
    const g = monsterProfile(cIndex(GOBLIN), 35, false, 0, 9);
    const near = { ...defaultSettings(), mode: 'ranged' as const, timeLimit: 20, distance: 1 };
    const F = playerProfile(c, 56, 9);
    expect(simulate(newStats(F, g, near), F, g, near, { kind: 'stored' }, 50, makeRng(5)).dealt.reduce((a, b) => a + b)).toBe(0);
    const far = { ...near, distance: 4 };
    expect(simulate(newStats(F, g, far), F, g, far, { kind: 'stored' }, 50, makeRng(5)).dealt.reduce((a, b) => a + b)).toBeGreaterThan(0);
    const W = playerProfile(c, 51, 9);
    expect(simulate(newStats(W, g, near), W, g, near, { kind: 'stored' }, 50, makeRng(5)).dealt.reduce((a, b) => a + b)).toBeGreaterThan(0);
  });
});

describe('review fixes kept from UW1', () => {
  it('a worn-out shield breaks and the character is recomputed', () => {
    const c = karl();
    c.equipment[8] = { itemId: 0x3c, quality: 1, ench: null };
    const P = { ...playerProfile(c, null), hp: 5000, hpMax: 5000 };
    const M = monsterProfile(cIndex(TROLL), 255, false, 0);
    const S = { ...defaultSettings(), timeLimit: 120 };
    const st = simulate(newStats(P, M, S), P, M, S, { kind: 'set', value: 255 }, 50, makeRng(8));
    expect(st.armourBroken).toBeGreaterThan(0);
    expect(c.equipment[8].quality).toBe(1);
  });
  it('item 0x7C (resists everything) is a timeout', () => {
    const P = playerProfile(karl(), null);
    const M = monsterProfile(0x3c, 250, false, 0);
    const S = { ...defaultSettings(), timeLimit: 5 };
    const st = newStats(P, M, S);
    fight(st, { ...P, hp: 1000 }, M, S, { kind: 'stored' }, makeRng(2));
    expect(st.outcomes[0]).toBe(0);
  });
});

describe('experience (player_killed_a, player_get_exp)', () => {
  // a random source with fixed values: rollem dice give `die` each, rand() % n gives `r`
  const fixed = (die: number, r: number) => ({ next: () => 0, int: (n: number) => r % n, rollem: (d: number) => d * die });
  const P = { level: 1, expRaw: 0 };
  it('(exp * 4 + 2d(exp)) halved, rounding up or down at random', () => {
    const M = monsterProfile(cIndex(RAT), 8, false, 0, 1); // exp 8
    expect(killXp(M, P, fixed(8, 0)).awarded).toBe((8 * 4 + 16) / 2);
    expect(killXp(M, P, fixed(8, 1)).awarded).toBe(Math.trunc((8 * 4 + 16 + 1) / 2));
  });
  it('powerful: times (24 + rand % 24) / 16 in 32 bits, stored in a 16-bit int', () => {
    const goblin = monsterProfile(cIndex(GOBLIN), 21, true, 0, 1); // exp 5: 20 + 2d5
    expect(killXp(goblin, P, fixed(5, 0)).awarded).toBe(Math.trunc(Math.trunc((30 * 24) / 16) / 2));
    const troll = monsterProfile(cIndex(TROLL), 100, true, 0, 4); // exp 438: 1752 + 876 = 2628
    const x = killXp(troll, { level: 1, expRaw: 500 }, fixed(438, 6)); // x 30 / 16 = 4927, no overflow
    expect(x.wrapped).toBe(false);
    expect(x.awarded).toBe(Math.trunc(4927 / 2));
  });
  it('halved again (+1) above twice the world plus two; refused past 0x7FFF0', () => {
    const M = monsterProfile(cIndex(RAT), 8, false, 0, 1);  // world 0: halved above level 2
    expect(killXp(M, { level: 3, expRaw: 0 }, fixed(8, 0)).awarded).toBe(12 + 1);
    expect(killXp(M, { level: 2, expRaw: 0 }, fixed(8, 0)).awarded).toBe(24);
    const M9 = monsterProfile(cIndex(RAT), 8, false, 0, 9); // world 1: halved above level 4
    expect(killXp(M9, { level: 4, expRaw: 0 }, fixed(8, 0)).awarded).toBe(24);
    expect(killXp(M9, { level: 5, expRaw: 0 }, fixed(8, 0)).awarded).toBe(13);
    expect(killXp(M, { level: 16, expRaw: 0x17701 }, fixed(8, 0)).awarded).toBe(13); // levels stop, XP goes on
    expect(killXp(M, { level: 16, expRaw: 0x7fff0 }, fixed(8, 0)).awarded).toBe(0);
  });
  it('only kills pay: XP sums over wins only', () => {
    const P2 = playerProfile(karl(), null);
    const M = monsterProfile(cIndex(RAT), 8, false, 0, 1); // exp 8, a full-HP rat that fights on
    const S = defaultSettings();
    const st = simulate(newStats(P2, M, S), P2, M, S, { kind: 'stored' }, 2000, makeRng(3));
    expect(st.outcomes[0]).toBeGreaterThan(500);
    expect(st.xp / st.outcomes[0]).toBeGreaterThanOrEqual((8 * 4 + 2) / 2);
    expect(st.xp / st.outcomes[0]).toBeLessThanOrEqual((8 * 4 + 16) / 2 + 0.5);
  });
});
