import { describe, expect, it } from 'vitest';
import { doneStats, drowning, hpGain, manaGain, regen, rollemDist } from '../src/core/timed';
import { gradeProbs, skillCheck } from '../src/core/skillcheck';
import { makeRng } from '../src/core/rng';

describe('timed checks', () => {
  it('rollem distributions sum to 1 and span dice..dice*sides', () => {
    const d = rollemDist(3, 4);
    expect(d.reduce((a, b) => a + b)).toBeCloseTo(1, 12);
    expect(d.findIndex((x) => x > 0)).toBe(3);
    expect(d.length - 1).toBe(12);
  });
  it('certain regeneration takes exactly the deficit in rolls', () => {
    const r = regen(3, 10, [0, 1], 20);
    expect(r.pDone.findIndex((x) => x >= 1 - 1e-12)).toBe(7);
    expect(r.bands[7].q[0.5]).toBe(10);
  });
  it('HP regeneration is negative binomial: mean deficit / p', () => {
    const inc = hpGain(14);
    const r = regen(0, 20, inc, 10, 20000, 1 - 1e-12);
    expect(doneStats(r.pDone).mean!).toBeCloseTo(20 / inc[1], 2);
  });
  it('mana gains are the positive grades of Mana vs 10', () => {
    const g = gradeProbs(12, 10);
    expect(manaGain(12)).toEqual([g[0] + g[1], g[2], g[3]]);
  });
  it('a sure critical swimmer never drowns', () => {
    const r = drowning(30, 0, 20, 30);
    expect(r.possible).toBe(false);
    expect(r.reached).toBe(0);
  });
  it('drowning matches a Monte Carlo with the game rand()', () => {
    const swim = 6, load = 8, hp0 = 20, K = 40;
    const exact = drowning(swim, load, hp0, K);
    const rng = makeRng(12345);
    const N = 40000;
    const deadBy = new Array(K + 1).fill(0);
    for (let i = 0; i < N; i++) {
      let count = 0x60, hp = hp0;
      for (let k = 1; k <= K; k++) {
        const g = skillCheck(swim, load, rng);
        if (g < 1 && count < 0x8c) count += rng.rollem(3 - g, 4);
        if (count > 0x78) { const hurt = 2 - skillCheck(swim, load, rng); if (hurt) hp -= rng.rollem(2, hurt + 2); }
        if (hp <= 0) { for (let j = k; j <= K; j++) deadBy[j]++; break; }
      }
    }
    for (const k of [10, 20, 30, 40]) expect(Math.abs(deadBy[k] / N - exact.pDone[k])).toBeLessThan(0.012);
  });
});
