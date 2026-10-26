// Exact distributions of the timed skill checks in duration_check (game/PLAYTIME.C):
// HP and mana regeneration, and drowning (sink_sink_sink). Each is a small Markov chain
// stepped one roll at a time with the game's grade probabilities (n/32768).

import { gradeProbs } from './skillcheck';
import { faceProbs } from './randdist';

/** One step's quantiles of the tracked value, for a fan chart. */
export interface Band { t: number; mean: number; q: Record<string, number> }
export const BAND_LEVELS = [0.025, 0.175, 0.25, 0.5, 0.75, 0.825, 0.975];

export interface TimedResult {
  /** pDone[k] = P(the end state is reached by roll k), k = 0..rolls */
  pDone: number[];
  /** the value's quantiles after each roll up to the horizon */
  bands: Band[];
  /** P(the end state is ever reached) as far as it was followed (1 when it is certain) */
  reached: number;
  /** whether the end state can be reached at all */
  possible: boolean;
}

const quant = (p: Float64Array, lv: number) => {
  let acc = 0;
  for (let v = 0; v < p.length; v++) { acc += p[v]; if (acc >= lv - 1e-12) return v; }
  return p.length - 1;
};
function band(t: number, p: Float64Array): Band {
  let mean = 0;
  for (let v = 0; v < p.length; v++) mean += v * p[v];
  const q: Record<string, number> = {};
  for (const lv of BAND_LEVELS) q[lv] = quant(p, lv);
  return { t, mean, q };
}

/** Regeneration: each roll adds k with probability inc[k], capped at max; stops being
    tracked once P(full) passes `stopAt` or after maxRolls. Bands up to `horizon` rolls. */
export function regen(start: number, max: number, inc: number[], horizon: number, maxRolls = 20000, stopAt = 0.9995): TimedResult {
  start = Math.max(0, Math.min(max, start));
  let p = new Float64Array(max + 1);
  p[start] = 1;
  const pDone = [p[max]];
  const bands = [band(0, p)];
  const possible = start >= max || inc.slice(1).some((x) => x > 0);
  for (let k = 1; k <= Math.max(horizon, possible ? maxRolls : horizon); k++) {
    const n = new Float64Array(max + 1);
    for (let v = 0; v <= max; v++) {
      if (!p[v]) continue;
      if (v === max) { n[max] += p[v]; continue; }
      for (let d = 0; d < inc.length; d++) if (inc[d]) n[Math.min(max, v + d)] += p[v] * inc[d];
    }
    p = n;
    pDone.push(p[max]);
    if (k <= horizon) bands.push(band(k, p));
    if (k >= horizon && (p[max] >= stopAt || !possible)) break;
  }
  return { pDone, bands, reached: pDone[pDone.length - 1], possible };
}

/** The per-roll gain distributions. */
export const hpGain = (str: number) => { const g = gradeProbs(str, 15); return [g[0] + g[1], g[2] + g[3]]; };
export const manaGain = (manaSkill: number) => { const g = gradeProbs(manaSkill, 10); return [g[0] + g[1], g[2], g[3]]; };

/** rollem(n, sides): n dice of 1 + (rand() * sides) / 0x8000. Distribution over totals 0..n*sides. */
export function rollemDist(n: number, sides: number): number[] {
  const f = faceProbs(sides);
  let d = [1];
  for (let i = 0; i < n; i++) {
    const nd = new Array(d.length + sides).fill(0);
    d.forEach((pv, s) => f.forEach((pf, k) => { nd[s + k + 1] += pv * pf; }));
    d = nd;
  }
  return d;
}

export const SWIM_START = 0x60, SWIM_HURT = 0x78, SWIM_CAP = 0x8c;

/** Drowning, one duration check at a time while in deep water (swim_count starts at 0x60
    when the player enters it and never falls while he stays):
      g1 = skill_check(Swimming, load); if g1 < 1 and count < 0x8C: count += rollem(3 - g1, 4)
      if count > 0x78: hurt = 2 - skill_check(Swimming, load); if hurt: HP -= rollem(2, hurt + 2)
    Tracks HP; the end state is HP 0. */
export function drowning(swim: number, load: number, hp: number, horizon: number, maxRolls = 3000, stopAt = 0.9995): TimedResult & { pOver: number[] } {
  const g = gradeProbs(swim, load);
  const add = [rollemDist(4, 4), rollemDist(3, 4)]; // g1 = -1, 0
  const dmg = [1, 2, 3].map((hurt) => rollemDist(2, hurt + 2)); // hurt 1..3
  const pHurt = [g[3], g[2], g[1], g[0]]; // hurt = 2 - g2: 0, 1, 2, 3
  const C = SWIM_HURT - SWIM_START + 2; // counts 0x60..0x78 then "over"
  const OVER = C - 1;
  const idx = (hpv: number, c: number) => hpv * C + c;
  let p = new Float64Array((hp + 1) * C);
  p[idx(hp, 0)] = 1;
  const pDone = [hp <= 0 ? 1 : 0];
  const pOver = [0];
  const hpDist = (q: Float64Array) => { const r = new Float64Array(hp + 1); for (let v = 0; v <= hp; v++) for (let c = 0; c < C; c++) r[v] += q[idx(v, c)]; return r; };
  const bands = [band(0, hpDist(p))];
  const possible = g[0] + g[1] > 0 && pHurt[0] < 1;
  for (let k = 1; k <= Math.max(horizon, possible ? maxRolls : horizon); k++) {
    const n = new Float64Array(p.length);
    for (let v = 0; v <= hp; v++) for (let c = 0; c < C; c++) {
      const pv = p[idx(v, c)];
      if (!pv) continue;
      if (v === 0) { n[idx(0, c)] += pv; continue; }
      // first check: the count may rise (it can only be below 0x8C here)
      const after: [number, number][] = [];
      if (c === OVER) after.push([OVER, 1]);
      else {
        after.push([c, g[2] + g[3]]);
        [0, 1].forEach((gi) => add[gi].forEach((pa, a) => { if (pa) after.push([Math.min(OVER, c + a), g[gi] * pa]); }));
      }
      for (const [c2, pc] of after) {
        if (!pc) continue;
        if (c2 !== OVER) { n[idx(v, c2)] += pv * pc; continue; }
        // second check: drowning damage
        n[idx(v, OVER)] += pv * pc * pHurt[0];
        for (let hurt = 1; hurt <= 3; hurt++) {
          const ph = pHurt[hurt];
          if (!ph) continue;
          dmg[hurt - 1].forEach((pd, d) => { if (pd) n[idx(Math.max(0, v - d), OVER)] += pv * pc * ph * pd; });
        }
      }
    }
    p = n;
    let dead = 0, over = 0;
    for (let c = 0; c < C; c++) dead += p[idx(0, c)];
    for (let v = 0; v <= hp; v++) over += p[idx(v, OVER)];
    pDone.push(dead);
    pOver.push(over);
    if (k <= horizon) bands.push(band(k, hpDist(p)));
    if (k >= horizon && (dead >= stopAt || !possible)) break;
  }
  return { pDone, pOver, bands, reached: pDone[pDone.length - 1], possible };
}

/** Summary of a time-to-done distribution in rolls. */
export function doneStats(pDone: number[]) {
  const last = pDone[pDone.length - 1];
  let mean = 0;
  for (let k = 1; k < pDone.length; k++) mean += k * (pDone[k] - pDone[k - 1]);
  const q = (lv: number) => { const i = pDone.findIndex((x) => x >= lv - 1e-12); return i < 0 ? null : i; };
  return { mean: last > 0.999 ? mean / last : null, median: q(0.5), q05: q(0.05), q95: q(0.95), last };
}
