// Seeded pseudo-random numbers. The game uses Turbo C's 15-bit rand(); the simulator
// uses the ideal uniform model of the plan (section 1): rand() % n is exactly uniform on
// 0..n-1. sfc32 is small, fast and passes PractRand to large sizes, which is plenty here.

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). Stands in for rand() % n. */
  int(n: number): number;
  /** rollem(dice, sides) from sys/UTIL.C: dice values of 1..sides each, summed. */
  rollem(dice: number, sides: number): number;
}

export function sfc32(a: number, b: number, c: number, d: number): Rng {
  const next = (): number => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (n: number) => Math.floor(next() * n),
    rollem: (dice: number, sides: number) => {
      let total = dice;
      if (sides > 0 && dice > 0) for (let i = 0; i < dice; i++) total += Math.floor(next() * sides);
      return total;
    },
  };
  // warm up so that nearby seeds diverge
  for (let i = 0; i < 15; i++) next();
  return rng;
}

/** A generator from a 32-bit seed and a stream number (one stream per worker/enemy). */
export function makeRng(seed: number, stream = 0): Rng {
  return sfc32(0x9e3779b9, seed >>> 0, (stream * 0x85ebca6b) >>> 0, 0xc2b2ae35 ^ stream);
}
