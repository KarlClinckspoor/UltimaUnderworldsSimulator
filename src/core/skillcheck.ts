// The game's one dice roll (game/SKILLCHK.C skill_check):
//   score = value - target + rand() % 31
//   score > 28 -> 2, > 15 -> 1, > 2 -> 0, else -1
// Exact counts out of 31 under the ideal uniform roll model (plan section 1).

import type { Rng } from './rng';

export type Grade = -1 | 0 | 1 | 2;
export const GRADES: Grade[] = [-1, 0, 1, 2];
export const GRADE_NAMES: Record<Grade, string> = { [-1]: 'failure', 0: 'near miss', 1: 'success', 2: 'critical' };

/** One roll, as the game does it (rand() % 31 replaced by an ideal uniform draw). */
export function skillCheck(value: number, target: number, rng: Rng): Grade {
  const score = value - target + rng.int(31);
  if (score > 28) return 2;
  if (score > 15) return 1;
  if (score > 2) return 0;
  return -1;
}

/** Grade of a known roll r (0..30). */
export function gradeOfRoll(value: number, target: number, r: number): Grade {
  const score = value - target + r;
  if (score > 28) return 2;
  if (score > 15) return 1;
  if (score > 2) return 0;
  return -1;
}

/** Number of rolls r in 0..30 with score >= t, where d = value - target. */
function C(d: number, t: number): number {
  return Math.max(0, Math.min(31, d + 31 - t));
}

export interface GradeCounts {
  /** counts out of 31, indexed by grade + 1: [-1, 0, 1, 2] */
  counts: [number, number, number, number];
  d: number;
}

/** Exact counts of each grade out of 31 for value - target = d. */
export function gradeCounts(value: number, target: number): GradeCounts {
  const d = value - target;
  const c29 = C(d, 29), c16 = C(d, 16), c3 = C(d, 3);
  return { d, counts: [31 - c3, c3 - c16, c16 - c29, c29] };
}

export const countOf = (gc: GradeCounts, g: Grade) => gc.counts[g + 1];
export const probOf = (gc: GradeCounts, g: Grade) => gc.counts[g + 1] / 31;
/** P(grade >= 1), the usual "hit" or "pass". */
export const pPass = (value: number, target: number) => {
  const gc = gradeCounts(value, target);
  return (gc.counts[2] + gc.counts[3]) / 31;
};

/** Probability vector over grades [-1,0,1,2]. */
export const gradeProbs = (value: number, target: number): number[] =>
  gradeCounts(value, target).counts.map((c) => c / 31);
