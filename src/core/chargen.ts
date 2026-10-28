// Character creation, exactly (CHARGEN.C roll_stats / set_sklmnu / set_skills, SKILLS.C
// add_to_skill / prime / player_compute), with the game's rand() probabilities:
//
//   attributes: the class's three bases, then its bonus points handed out in lumps of
//     pts = (rand() & 3) + 1 (at most what is left) to a = rand() % 3, a lump that would
//     pass 30 cut to reach 30 (a lump of 0 is drawn again);
//   skills: all cleared, then the class's five entries in order: a single skill is added
//     outright, a menu adds the skill picked. Each add (add_to_skill), with s the governing
//     attribute (prime: STR for Attack..Missile, INT for Mana, Lore, Casting, DEX after):
//       new skill:  3 + s / 9  + rand() * 3 / 0x8000 + three skill_check(s, 20)
//       held skill: 1 + s / 13 + rand() * 2 / 0x8000 + two skill_check(s, 20)
//     capped at 30 after each add;
//   derived: max HP 30 + STR / 5 (level 1), max mana (Mana + 1) * INT >> 3.
//
// Answering "No" to "Keep this character?" starts again with new rolls, so a design that
// comes up with probability p takes 1 / p tries on average.

import { gradeProbs } from './skillcheck';
import { faceProbs, modProbs } from './randdist';
import type { ChargenClass } from '../data/chargenData';

export const NSKILLS = 20;
export const ATTR_NAMES = ['STR', 'DEX', 'INT'] as const;
/** SKILLS.C prime: the attribute index governing a skill. */
export const prime = (skill: number) => (skill < 7 ? 0 : skill < 10 ? 2 : 1);
export const maxHpOf = (str: number) => 30 + Math.trunc(str / 5);
export const maxManaOf = (manaSkill: number, int: number) => ((manaSkill + 1) * int) >> 3;

export interface AttrOutcome { a: [number, number, number]; p: number }

/** roll_stats: every attribute triple the class can come out with, and its probability. */
export function attrDist(cls: ChargenClass): AttrOutcome[] {
  const pa = modProbs(3); // rand() % 3: 10923, 10923, 10922 out of 32768
  const pts = [0.25, 0.25, 0.25, 0.25]; // (rand() & 3) + 1: exactly uniform
  let cur = new Map<string, number>([[`${cls.points},${cls.attrs.join(',')}`, 1]]);
  const done = new Map<string, number>();
  while (cur.size) {
    const next = new Map<string, number>();
    for (const [key, p] of cur) {
      const [left, ...a] = key.split(',').map(Number);
      if (left <= 0) { const k = a.join(','); done.set(k, (done.get(k) ?? 0) + p); continue; }
      // transitions; a lump cut to 0 (attribute already 30) leaves the state as it was, so
      // the other transitions are renormalised
      const out: [string, number][] = [];
      let stay = 0;
      for (let d = 0; d < 4; d++) for (let i = 0; i < 3; i++) {
        let n = Math.min(d + 1, left);
        if (a[i] + n > 30) n = 30 - a[i];
        const q = pts[d] * pa[i];
        if (n === 0) { stay += q; continue; }
        const b = [...a]; b[i] += n;
        out.push([`${left - n},${b.join(',')}`, q]);
      }
      for (const [k, q] of out) next.set(k, (next.get(k) ?? 0) + (p * q) / (1 - stay));
    }
    cur = next;
  }
  return [...done].map(([k, p]) => ({ a: k.split(',').map(Number) as [number, number, number], p }));
}

const skillCache = new Map<string, Float64Array>();
/** Distribution of a skill (0..30) after `times` adds from 0, with governing attribute s. */
export function skillDist(s: number, times: number): Float64Array {
  const key = `${s},${times}`;
  let d = skillCache.get(key);
  if (d) return d;
  d = new Float64Array(31);
  d[0] = 1;
  const g = gradeProbs(s, 20);
  // what one add adds: base + s / divisor + bonus + rolls grades (a skill at 0 counts as new)
  const addOf = (held: boolean) => {
    const rolls = held ? 2 : 3;
    let m = new Map<number, number>([[(held ? 1 : 3) + Math.trunc(s / (held ? 13 : 9)), 1]]);
    const step = (opts: [number, number][]) => {
      const n = new Map<number, number>();
      for (const [v, p] of m) for (const [dv, q] of opts) if (q) n.set(v + dv, (n.get(v + dv) ?? 0) + p * q);
      m = n;
    };
    step(faceProbs(rolls).map((q, f) => [f, q] as [number, number]));
    for (let r = 0; r < rolls; r++) step([[-1, g[0]], [0, g[1]], [1, g[2]], [2, g[3]]]);
    return m;
  };
  const addNew = addOf(false), addHeld = addOf(true);
  for (let t = 0; t < times; t++) {
    const nd = new Float64Array(31);
    for (let v = 0; v <= 30; v++) {
      if (!d[v]) continue;
      for (const [dv, q] of v === 0 ? addNew : addHeld) nd[Math.max(0, Math.min(30, v + dv))] += d[v] * q;
    }
    d = nd;
  }
  skillCache.set(key, d);
  return d;
}
/** P(skill >= r) after `times` adds with attribute s. */
export function skillTail(s: number, times: number, r: number): number {
  if (r <= 0) return 1;
  if (r > 30) return 0;
  const d = skillDist(s, times);
  let t = 0;
  for (let v = r; v <= 30; v++) t += d[v];
  return t;
}

/** Every way through the class's menus: the picks, and how many times each skill is added. */
export interface Route { picks: number[]; counts: number[] }
export function routes(cls: ChargenClass): Route[] {
  let out: Route[] = [{ picks: [], counts: new Array(NSKILLS).fill(0) }];
  for (const e of cls.entries) {
    if (e.length === 0) continue;
    if (e.length === 1) { out.forEach((r) => r.counts[e[0]]++); continue; }
    const n: Route[] = [];
    for (const r of out) for (const sk of e) { const c = [...r.counts]; c[sk]++; n.push({ picks: [...r.picks, sk], counts: c }); }
    out = n;
  }
  return out;
}
/** The menus: each entry with more than one skill. */
export const menus = (cls: ChargenClass) => cls.entries.filter((e) => e.length > 1);
/** How many times each skill can be added at most, and at least (the fixed entries). */
export function timesRange(cls: ChargenClass) {
  const max = new Array(NSKILLS).fill(0), min = new Array(NSKILLS).fill(0);
  for (const e of cls.entries) {
    if (e.length === 1) min[e[0]]++;
    for (const s of new Set(e)) max[s]++;
  }
  return { min, max };
}

/** Marginal histogram of a skill added `times` times, over the class's attributes. */
export function skillHist(attrs: AttrOutcome[], skill: number, times: number): Float64Array {
  const h = new Float64Array(31);
  for (const o of attrs) {
    const d = skillDist(o.a[prime(skill)], times);
    for (let v = 0; v <= 30; v++) h[v] += o.p * d[v];
  }
  return h;
}
export function attrHist(attrs: AttrOutcome[], i: number): Float64Array {
  const h = new Float64Array(31);
  for (const o of attrs) h[o.a[i]] += o.p;
  return h;
}
export function hpHist(attrs: AttrOutcome[]): Map<number, number> {
  const h = new Map<number, number>();
  for (const o of attrs) { const v = maxHpOf(o.a[0]); h.set(v, (h.get(v) ?? 0) + o.p); }
  return h;
}
export function manaHist(attrs: AttrOutcome[], times: number): Map<number, number> {
  const h = new Map<number, number>();
  for (const o of attrs) {
    const d = skillDist(o.a[2], times);
    for (let v = 0; v <= 30; v++) if (d[v]) { const m = maxManaOf(v, o.a[2]); h.set(m, (h.get(m) ?? 0) + o.p * d[v]); }
  }
  return h;
}

/** A design: minimums, null where the player does not care. */
export interface Design { attrs: (number | null)[]; hp: number | null; mana: number | null; skills: (number | null)[] }
export const emptyDesign = (): Design => ({ attrs: [null, null, null], hp: null, mana: null, skills: new Array(NSKILLS).fill(null) });
export const designFields = (d: Design) => {
  const f: { kind: 'attr' | 'hp' | 'mana' | 'skill'; i: number }[] = [];
  d.attrs.forEach((v, i) => { if (v !== null) f.push({ kind: 'attr', i }); });
  if (d.hp !== null) f.push({ kind: 'hp', i: 0 });
  if (d.mana !== null) f.push({ kind: 'mana', i: 0 });
  d.skills.forEach((v, i) => { if (v !== null) f.push({ kind: 'skill', i }); });
  return f;
};

/** P(every minimum in the design is met) for one route through the menus. */
export function pDesign(attrs: AttrOutcome[], counts: number[], d: Design): number {
  let total = 0;
  const skillReqs = d.skills.map((r, i) => [i, r] as [number, number | null]).filter(([, r]) => r !== null && r > 0) as [number, number][];
  for (const [i, r] of skillReqs) if (counts[i] === 0 && r > 0) return 0;
  for (const o of attrs) {
    if (d.attrs.some((r, i) => r !== null && o.a[i] < r)) continue;
    if (d.hp !== null && maxHpOf(o.a[0]) < d.hp) continue;
    let p = o.p;
    // the Mana skill needed for the mana minimum, folded into the Mana skill's minimum
    let manaNeed = d.skills[7] ?? 0;
    if (d.mana !== null && d.mana > 0) {
      let v = 0;
      while (v <= 30 && maxManaOf(v, o.a[2]) < d.mana) v++;
      if (v > 30) continue;
      manaNeed = Math.max(manaNeed, v);
      if (manaNeed > 0 && counts[7] === 0) continue;
    }
    for (const [i, r] of skillReqs) {
      if (i === 7) continue;
      p *= skillTail(o.a[prime(i)], counts[i], r);
      if (!p) break;
    }
    if (p && manaNeed > 0) p *= skillTail(o.a[2], counts[7], manaNeed);
    total += p;
  }
  return total;
}

export interface Evaluation { p: number; route: Route; ties: number }
/** The best route through the menus for a design (the picks are the player's to make). */
export function bestRoute(cls: ChargenClass, attrs: AttrOutcome[], d: Design, rs = routes(cls)): Evaluation {
  const seen = new Map<string, number>();
  let best: Evaluation = { p: -1, route: rs[0], ties: 0 };
  for (const r of rs) {
    const key = r.counts.join(',');
    let p = seen.get(key);
    if (p === undefined) { p = pDesign(attrs, r.counts, d); seen.set(key, p); }
    if (p > best.p + 1e-15) best = { p, route: r, ties: 1 };
    else if (Math.abs(p - best.p) <= 1e-15) best.ties++;
  }
  return best;
}

/** The design with only one field kept, or with one field dropped. */
export function only(d: Design, f: { kind: string; i: number }): Design {
  const e = emptyDesign();
  if (f.kind === 'attr') e.attrs[f.i] = d.attrs[f.i];
  else if (f.kind === 'hp') e.hp = d.hp;
  else if (f.kind === 'mana') e.mana = d.mana;
  else e.skills[f.i] = d.skills[f.i];
  return e;
}
export function without(d: Design, f: { kind: string; i: number }): Design {
  const e: Design = { attrs: [...d.attrs], hp: d.hp, mana: d.mana, skills: [...d.skills] };
  if (f.kind === 'attr') e.attrs[f.i] = null;
  else if (f.kind === 'hp') e.hp = null;
  else if (f.kind === 'mana') e.mana = null;
  else e.skills[f.i] = null;
  return e;
}

/** Pearson correlations between the three attributes over the class's outcomes. */
export function attrCorrelation(attrs: AttrOutcome[]): number[][] {
  const m = [0, 1, 2].map((i) => attrs.reduce((s, o) => s + o.p * o.a[i], 0));
  const cov = (i: number, j: number) => attrs.reduce((s, o) => s + o.p * (o.a[i] - m[i]) * (o.a[j] - m[j]), 0);
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => { const d = Math.sqrt(cov(i, i) * cov(j, j)); return d ? cov(i, j) / d : i === j ? 1 : 0; }));
}

/** Given attribute i at each value: its probability and the other two attributes' mean and 10th-90th percentiles. */
export function attrConditional(attrs: AttrOutcome[], i: number) {
  const byV = new Map<number, AttrOutcome[]>();
  for (const o of attrs) { const l = byV.get(o.a[i]); if (l) l.push(o); else byV.set(o.a[i], [o]); }
  const q = (list: AttrOutcome[], j: number, lv: number) => {
    const tot = list.reduce((s, o) => s + o.p, 0);
    const sorted = [...list].sort((a, b) => a.a[j] - b.a[j]);
    let acc = 0;
    for (const o of sorted) { acc += o.p / tot; if (acc >= lv - 1e-12) return o.a[j]; }
    return sorted[sorted.length - 1].a[j];
  };
  return [...byV.entries()].sort((a, b) => a[0] - b[0]).map(([v, list]) => {
    const p = list.reduce((s, o) => s + o.p, 0);
    const others = [0, 1, 2].filter((j) => j !== i).map((j) => ({
      j, mean: list.reduce((s, o) => s + o.p * o.a[j], 0) / p, lo: q(list, j, 0.1), hi: q(list, j, 0.9),
    }));
    return { v, p, others };
  });
}
