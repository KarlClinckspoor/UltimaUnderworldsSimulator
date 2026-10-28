import { describe, expect, it } from 'vitest';
import { attrDist, bestRoute, emptyDesign, maxHpOf, pDesign, prime, routes, skillDist, timesRange } from '../src/core/chargen';
import { CHARGEN_CLASSES } from '../src/data/chargenData';
import { skillCheck } from '../src/core/skillcheck';
import { makeRng, type Rng } from '../src/core/rng';

/** CHARGEN.C roll_stats and SKILLS.C add_to_skill, call for call. */
function rollStats(cls: (typeof CHARGEN_CLASSES)[number], rng: Rng) {
  const a = [...cls.attrs];
  let i = cls.points;
  while (i > 0) {
    let pts = (rng.rand() & 3) + 1;
    if (pts > i) pts = i;
    const k = rng.rand() % 3;
    if (a[k] + pts > 30) pts = 30 - a[k];
    a[k] += pts;
    i -= pts;
  }
  return a;
}
function addToSkill(skills: number[], skill: number, attrs: number[], rng: Rng) {
  const held = skills[skill] !== 0;
  const [base, div, rolls] = held ? [1, 13, 2] : [3, 9, 3];
  const stat = attrs[prime(skill)];
  skills[skill] += base + Math.trunc(stat / div) + Math.trunc((rng.rand() * rolls) / 0x8000);
  for (let r = 0; r < rolls; r++) skills[skill] += skillCheck(stat, 20, rng);
  if (skills[skill] > 30) skills[skill] = 30;
}

describe('character creation', () => {
  it('attribute outcomes sum to 1 and spend every point', () => {
    for (const cls of CHARGEN_CLASSES) {
      const d = attrDist(cls);
      expect(d.reduce((s, o) => s + o.p, 0)).toBeCloseTo(1, 12);
      for (const o of d) {
        expect(o.a.every((x) => x <= 30)).toBe(true);
        expect(o.a.reduce((s, x) => s + x, 0)).toBe(cls.attrs.reduce((s, x) => s + x, 0) + cls.points);
      }
    }
  });
  it('the menus give each skill between its fixed and possible counts', () => {
    const shepherd = CHARGEN_CLASSES[7];
    const { min, max } = timesRange(shepherd);
    for (const r of routes(shepherd)) r.counts.forEach((c, i) => { expect(c).toBeGreaterThanOrEqual(min[i]); expect(c).toBeLessThanOrEqual(max[i]); });
    expect(routes(shepherd).length).toBe(shepherd.entries.filter((e) => e.length > 1).reduce((s, e) => s * e.length, 1));
  });
  it('matches a Monte Carlo of the whole creation with the game rand()', () => {
    const cls = CHARGEN_CLASSES[0]; // Fighter: Attack twice through the menu
    const route = routes(cls).find((r) => r.counts[0] === 2 && r.counts[3] === 1)!;
    const rng = makeRng(777);
    const N = 60000;
    const str = new Array(31).fill(0), atk = new Array(31).fill(0), sword = new Array(31).fill(0);
    for (let n = 0; n < N; n++) {
      const a = rollStats(cls, rng);
      const sk = new Array(20).fill(0);
      for (let e = 0; e < 5; e++) {
        const ent = cls.entries[e];
        const s = ent.length === 1 ? ent[0] : route.picks[cls.entries.slice(0, e).filter((x) => x.length > 1).length];
        addToSkill(sk, s, a, rng);
      }
      str[a[0]]++; atk[sk[0]]++; sword[sk[3]]++;
    }
    const d = attrDist(cls);
    const exStr = new Array(31).fill(0); d.forEach((o) => { exStr[o.a[0]] += o.p; });
    const exAtk = new Array(31).fill(0), exSw = new Array(31).fill(0);
    d.forEach((o) => { skillDist(o.a[0], 2).forEach((p, v) => { exAtk[v] += o.p * p; }); skillDist(o.a[0], 1).forEach((p, v) => { exSw[v] += o.p * p; }); });
    for (let v = 0; v <= 30; v++) {
      expect(Math.abs(str[v] / N - exStr[v])).toBeLessThan(0.008);
      expect(Math.abs(atk[v] / N - exAtk[v])).toBeLessThan(0.008);
      expect(Math.abs(sword[v] / N - exSw[v])).toBeLessThan(0.008);
    }
  });
  it('a design is certain when empty, impossible past 30, and the best route takes the skill', () => {
    const cls = CHARGEN_CLASSES[0];
    const d = attrDist(cls);
    expect(bestRoute(cls, d, emptyDesign()).p).toBeCloseTo(1, 12);
    const e = emptyDesign(); e.attrs[0] = 31;
    expect(bestRoute(cls, d, e).p).toBe(0);
    const s = emptyDesign(); s.skills[4] = 8; // Axe
    const b = bestRoute(cls, d, s);
    expect(b.route.counts[4]).toBe(1);
    expect(b.p).toBeGreaterThan(0);
    expect(pDesign(d, routes(cls).find((r) => r.counts[4] === 0)!.counts, s)).toBe(0);
    const hp = emptyDesign(); hp.hp = maxHpOf(cls.attrs[0]);
    expect(bestRoute(cls, d, hp).p).toBeCloseTo(1, 12);
  });
});
