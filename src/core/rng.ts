// Random numbers. Two models:
//
//  - 'game' (the default): the game's own generator, Borland/Turbo C++ rand():
//        seed = seed * 0x015A4E35 + 1 (mod 2^32), result = bits 16..30 of the new seed (0..32767).
//    Every call site then uses the draw in the form the game's C does: rand() % n, rand() & mask,
//    and rollem's (rand() * sides) / 0x8000. So the small inhomogeneities of the real game are
//    there (rand() % 31 gives residue 0 in 1058 of 32768 draws and the others in 1057; rand() % 100
//    gives 0..67 in 328 and 68..99 in 327, ...), and so are the generator's serial properties.
//    Checked call for call against vectors measured on UW.EXE and UW2.EXE (test/rng-vectors.test.ts).
//
//  - 'ideal': exactly uniform draws (sfc32 floats), the "n/31" model of the plan, kept to compare.
//
// Model-only randomness that the game does not have (the "missile hit chance" setting) comes from a
// separate sfc32 stream, so that it never shifts the game's sequence.

export type RandModel = 'game' | 'ideal';
export const RAND_MAX1 = 32768;     // rand() is 0..32767
export const LCG_A = 0x015a4e35;
export const LCG_PERIOD = 2 ** 32;

export interface Rng {
  /** Uniform float in [0, 1), for model-only choices (not a game draw). */
  next(): number;
  /** rand() % n (also rand() & (n - 1) for a power of two). */
  int(n: number): number;
  /** rollem(dice, sides) from sys/UTIL.C: total = dice + sum of (rand() * sides) / 0x8000. */
  rollem(dice: number, sides: number): number;
  /** rand() itself, 0..32767. */
  rand(): number;
  /** Game draws taken so far. */
  draws: number;
  /** The generator's 32-bit state ('game' only; NaN for 'ideal'). */
  readonly state: number;
}

function sfc32next(s: Uint32Array): number {
  let t = (s[0] + s[1]) >>> 0;
  s[0] = s[1] ^ (s[1] >>> 9);
  s[1] = (s[2] + (s[2] << 3)) >>> 0;
  s[2] = ((s[2] << 21) | (s[2] >>> 11)) >>> 0;
  s[3] = (s[3] + 1) >>> 0;
  t = (t + s[3]) >>> 0;
  s[2] = (s[2] + t) >>> 0;
  return t / 4294967296;
}
function sfc32state(a: number, b: number, c: number, d: number): Uint32Array {
  const s = new Uint32Array([a, b, c, d]);
  for (let i = 0; i < 15; i++) sfc32next(s);
  return s;
}

/** The affine map x -> a x + c (mod 2^32) of n steps of the LCG, for jumping ahead. */
export function lcgJump(n: number): { a: number; c: number } {
  let a = 1, c = 0;                 // accumulated map
  let pa = LCG_A, pc = 1;           // map of 2^k steps
  let k = Math.floor(n) >>> 0;     // n < 2^32: one period is enough
  while (k > 0) {
    if (k & 1) { c = (Math.imul(pa, c) + pc) >>> 0; a = Math.imul(pa, a) >>> 0; }
    pc = (Math.imul(pa, pc) + pc) >>> 0;
    pa = Math.imul(pa, pa) >>> 0;
    k >>>= 1;
  }
  return { a, c };
}

/** Borland rand() from a 32-bit state. */
export function borland(state: number, side: Uint32Array): Rng {
  let s = state >>> 0;
  const rng: Rng = {
    draws: 0,
    get state() { return s; },
    rand() { s = (Math.imul(s, LCG_A) + 1) >>> 0; rng.draws++; return (s >>> 16) & 0x7fff; },
    int(n: number) { return rng.rand() % n; },
    rollem(dice: number, sides: number) {
      let total = dice;
      if (sides > 0 && dice > 0) for (let i = 0; i < dice; i++) total += Math.trunc((rng.rand() * sides) / 0x8000);
      return total;
    },
    next: () => sfc32next(side),
  };
  return rng;
}

/** Exactly uniform draws (the ideal model). */
export function ideal(main: Uint32Array, side: Uint32Array): Rng {
  const rng: Rng = {
    draws: 0,
    get state() { return NaN; },
    rand() { rng.draws++; return Math.floor(sfc32next(main) * RAND_MAX1); },
    int(n: number) { rng.draws++; return Math.floor(sfc32next(main) * n); },
    rollem(dice: number, sides: number) {
      let total = dice;
      if (sides > 0 && dice > 0) for (let i = 0; i < dice; i++) { rng.draws++; total += Math.floor(sfc32next(main) * sides); }
      return total;
    },
    next: () => sfc32next(side),
  };
  return rng;
}

/**
 * A generator for one worker job. In the game model the seed is the generator's 32-bit state and
 * stream i of `streams` starts i * floor(2^32 / streams) draws further along the one LCG cycle, so
 * parallel jobs read disjoint blocks of the same sequence (as long as each uses fewer draws than its
 * block; fight.ts reports the draws so the UI can say when a block was overrun).
 */
export function makeRng(seed: number, stream = 0, model: RandModel = 'game', streams = 1): Rng {
  const side = sfc32state(0x9e3779b9, seed >>> 0, (stream * 0x85ebca6b) >>> 0, 0x51ed270b);
  if (model === 'ideal') return ideal(sfc32state(0x243f6a88, seed >>> 0, (stream * 0x85ebca6b) >>> 0, 0xc2b2ae35 ^ stream), side);
  const block = blockSize(streams);
  const j = lcgJump((stream % Math.max(1, streams)) * block);
  return borland((Math.imul(j.a, seed >>> 0) + j.c) >>> 0, side);
}
export const blockSize = (streams: number) => Math.floor(LCG_PERIOD / Math.max(1, streams));
