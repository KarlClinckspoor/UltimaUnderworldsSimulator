// The game's one dice roll (game/SKILLCHK.C skill_check):
//   score = value - target + rand() % 31
//   score > 28 -> 2, > 15 -> 1, > 2 -> 0, else -1
// Exact counts under the chosen random model (core/randdist.ts): out of 32768 with the game's
// Borland rand(), where residue 0 of rand() % 31 comes up 1058 times and every other one 1057;
// out of 31 under the ideal model (kept for the tests; the site always uses the game's).

import type { Rng, RandModel } from './rng';
import { modCounts, randModel } from './randdist';

export type Grade = -1 | 0 | 1 | 2;
export const GRADES: Grade[] = [-1, 0, 1, 2];
export const GRADE_NAMES: Record<Grade, string> = { [-1]: 'critical failure', 0: 'failure', 1: 'success', 2: 'critical success' };

/** One roll, as the game does it. */
export function skillCheck(value: number, target: number, rng: Rng): Grade {
  const score = value - target + rng.int(31);
  if (score > 28) return 2;
  if (score > 15) return 1;
  if (score > 2) return 0;
  return -1;
}

/** Grade of a known residue r = rand() % 31 (0..30). */
export function gradeOfRoll(value: number, target: number, r: number): Grade {
  const score = value - target + r;
  if (score > 28) return 2;
  if (score > 15) return 1;
  if (score > 2) return 0;
  return -1;
}

export interface GradeCounts {
  /** counts indexed by grade + 1: [-1, 0, 1, 2], out of `total` */
  counts: [number, number, number, number];
  total: number;   // 32768 (game) or 31 (ideal)
  /** the residues r = rand() % 31 in each grade (for display) */
  residues: [number, number, number, number];
  d: number;
  model: RandModel;
}

/** Exact counts of each grade for value - target = d. */
export function gradeCounts(value: number, target: number, m: RandModel = randModel()): GradeCounts {
  const d = value - target;
  const w = modCounts(31, m);
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  const residues: [number, number, number, number] = [0, 0, 0, 0];
  for (let r = 0; r < 31; r++) { const g = gradeOfRoll(d, 0, r) + 1; counts[g] += w[r]; residues[g]++; }
  return { d, counts, total: m === 'ideal' ? 31 : 32768, residues, model: m };
}

/** Probability vector over grades [-1, 0, 1, 2]. */
export const gradeProbs = (value: number, target: number, m: RandModel = randModel()): number[] => {
  const g = gradeCounts(value, target, m);
  return g.counts.map((c) => c / g.total);
};
export const probOf = (gc: GradeCounts, g: Grade) => gc.counts[g + 1] / gc.total;
/** P(grade >= 1), the usual "hit" or "pass". */
export const pPass = (value: number, target: number, m: RandModel = randModel()) => {
  const p = gradeProbs(value, target, m);
  return p[2] + p[3];
};
