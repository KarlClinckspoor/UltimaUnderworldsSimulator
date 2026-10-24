// The simulator against the game executable: the same generator state in, the same result and the
// same generator state out (vectors measured on the EXE, test/vectors/README.md).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { borland, lcgJump, makeRng, LCG_A } from '../src/core/rng';
import { skillCheck, gradeCounts } from '../src/core/skillcheck';
import { checkRes, pickloc } from '../src/combat/blow';
import { faceProbs, modCounts } from '../src/core/randdist';

function csv(name: string): Record<string, number>[] {
  const [head, ...rows] = readFileSync(join(__dirname, 'vectors', name), 'utf8').trim().split(/\r?\n/);
  const cols = head.split(',');
  return rows.map((r) => Object.fromEntries(r.split(',').map((v, i) => [cols[i], Number(v)])));
}
const at = (seed: number) => borland(seed, new Uint32Array([1, 2, 3, 4]));

describe('Borland rand() against the EXE', () => {
  it('skill_check: result and generator state for every vector', () => {
    const v = csv('skill_check.csv');
    expect(v.length).toBeGreaterThan(250);
    for (const c of v) {
      const r = at(c.seed);
      expect(skillCheck(c.value, c.target, r)).toBe(c.result);
      expect(r.state).toBe(c.seed_out);
    }
  });
  it('rollem: total and generator state', () => {
    for (const c of csv('rollem.csv')) {
      const r = at(c.seed);
      expect(r.rollem(c.dice, c.sides)).toBe(c.total);
      expect(r.state).toBe(c.seed_out);
    }
  });
  it('pickloc: location and generator state', () => {
    for (const c of csv('pickloc.csv')) {
      const r = at(c.seed);
      expect(pickloc(c.dz, c.dtop, c.az, c.atop, r)).toBe(c.loc);
      expect(r.state).toBe(c.seed_out);
    }
  });
  it('check_res: result and generator state', () => {
    for (const c of csv('check_res.csv')) {
      const r = at(c.seed);
      expect(checkRes(c.resist, c.damage, c.type, r)).toBe(c.result);
      expect(r.state).toBe(c.seed_out);
    }
  });
});

describe('generator plumbing', () => {
  it('jumping ahead n draws equals drawing n times', () => {
    for (const n of [0, 1, 2, 7, 1000, 123457]) {
      const r = at(0xdeadbeef);
      for (let i = 0; i < n; i++) r.rand();
      const j = lcgJump(n);
      expect((Math.imul(j.a, 0xdeadbeef) + j.c) >>> 0).toBe(r.state);
    }
    // the full period returns to the start
    const half = lcgJump(2 ** 31);
    const a2 = Math.imul(half.a, half.a) >>> 0, c2 = (Math.imul(half.a, half.c) + half.c) >>> 0;
    expect([a2, c2]).toEqual([1, 0]);
    expect(LCG_A).toBe(22695477);
  });
  it('streams of a split run are disjoint blocks of the one cycle', () => {
    const a = makeRng(5, 0, 'game', 4), b = makeRng(5, 1, 'game', 4);
    const j = lcgJump(2 ** 30);
    expect(b.state).toBe((Math.imul(j.a, a.state) + j.c) >>> 0);
  });
  it('model-only draws (next) never move the game generator', () => {
    const a = makeRng(9), b = makeRng(9);
    for (let i = 0; i < 100; i++) a.next();
    expect(a.rand()).toBe(b.rand());
  });
});

describe('exact weights of the game draws', () => {
  it('rand() % 31: residue 0 has 1058 draws, the others 1057', () => {
    expect(modCounts(31, 'game')[0]).toBe(1058);
    expect(modCounts(31, 'game').slice(1).every((c) => c === 1057)).toBe(true);
    expect(modCounts(100, 'game')[67]).toBe(328);
    expect(modCounts(100, 'game')[68]).toBe(327);
  });
  it('enumerating all 32768 values of rand() gives the counts of gradeCounts', () => {
    for (let d = -35; d <= 35; d++) {
      const c = [0, 0, 0, 0];
      for (let r = 0; r < 32768; r++) {
        const s = d + (r % 31);
        c[s > 28 ? 3 : s > 15 ? 2 : s > 2 ? 1 : 0]++;
      }
      expect(gradeCounts(d, 0, 'game').counts).toEqual(c);
    }
    expect(gradeCounts(0, 0, 'game').counts).toEqual([1058 + 2 * 1057, 13 * 1057, 13 * 1057, 2 * 1057]);
    expect(gradeCounts(0, 0, 'ideal').counts).toEqual([3, 13, 13, 2]);
  });
  it('a rollem die: faces of a d6 come up 5461 or 5462 times in 32768', () => {
    const p = faceProbs(6, 'game').map((x) => Math.round(x * 32768));
    expect(p.reduce((a, b) => a + b)).toBe(32768);
    for (let f = 0; f < 6; f++) {
      let n = 0;
      for (let r = 0; r < 32768; r++) if (Math.trunc((r * 6) / 0x8000) === f) n++;
      expect(p[f]).toBe(n);
    }
  });
});
