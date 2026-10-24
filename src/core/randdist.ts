// Exact probabilities of the forms in which the game uses rand(), under either model (rng.ts).
// Under 'game' rand() is uniform on 0..32767, so
//   rand() % n            residue k has floor(32768 / n) + [k < 32768 mod n] draws
//   (rand() * s) / 0x8000 face f has the draws r with floor(r s / 32768) = f
// and a mask (rand() & 31) is exactly uniform. Under 'ideal' every form is exactly uniform.
// One module-level switch, set by the UI; tests set it explicitly.

import { RAND_MAX1, type RandModel } from './rng';

let model: RandModel = 'game';
export const setRandModel = (m: RandModel) => { model = m; };
export const randModel = () => model;

const cacheMod = new Map<string, number[]>();
/** Draw counts of rand() % n, k = 0..n-1 (out of 32768 'game', out of n 'ideal'). */
export function modCounts(n: number, m: RandModel = model): number[] {
  const key = `${m}|${n}`;
  let c = cacheMod.get(key);
  if (!c) {
    if (m === 'ideal') c = new Array(n).fill(1);
    else { const q = Math.floor(RAND_MAX1 / n), r = RAND_MAX1 % n; c = Array.from({ length: n }, (_, k) => q + (k < r ? 1 : 0)); }
    cacheMod.set(key, c);
  }
  return c;
}
/** Probabilities of rand() % n. */
export const modProbs = (n: number, m: RandModel = model) => {
  const c = modCounts(n, m), t = m === 'ideal' ? n : RAND_MAX1;
  return c.map((x) => x / t);
};

const cacheFace = new Map<string, number[]>();
/** Probabilities of one rollem die's face 0..sides-1: (rand() * sides) / 0x8000. */
export function faceProbs(sides: number, m: RandModel = model): number[] {
  const key = `${m}|${sides}`;
  let p = cacheFace.get(key);
  if (!p) {
    if (m === 'ideal') p = new Array(sides).fill(1 / sides);
    else {
      // face f covers r from ceil(f * 32768 / s) to ceil((f + 1) * 32768 / s) - 1
      p = Array.from({ length: sides }, (_, f) => (Math.ceil(((f + 1) * RAND_MAX1) / sides) - Math.ceil((f * RAND_MAX1) / sides)) / RAND_MAX1);
    }
    cacheFace.set(key, p);
  }
  return p;
}

/** P(rand() % n < k). */
export const pModBelow = (n: number, k: number, m: RandModel = model) =>
  modProbs(n, m).slice(0, Math.max(0, Math.min(n, k))).reduce((a, b) => a + b, 0);
