// Aggregated results of N fights. Plain numbers and arrays so they cross postMessage and
// merge by addition.

export const OUTCOMES = ['win', 'death', 'flee', 'timeout'] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const SOURCES = ['melee 1', 'melee 2', 'melee 3', 'missile', 'spell', 'area spell'] as const;
export const DEALT_PARTS = ['weapon', 'strength', 'enchantment', 'critical', 'angle', 'missile', 'spell'] as const;

export const DUR_BIN = 0.5; // seconds per duration histogram bin

export interface Stats {
  n: number;
  outcomes: number[];                 // by OUTCOMES
  durHist: number[][];                // [outcome][bin]
  durSum: number[];                   // seconds, by outcome
  hpLeftHist: number[];               // player HP on wins
  monHpLeftHist: number[];            // monster HP on deaths, flees, timeouts
  dealt: number[];                    // HP removed from the monster, by DEALT_PARTS
  dealtPerFight: number; dealtPerFightSq: number;
  absorbedMon: number; resistedMon: number; overkill: number;
  pSwings: number; pHits: number; pCrits: number; pMisses: number; pBadMisses: number;
  pShots: number; pShotHits: number;
  casts: number; fizzles: number; backfires: number; selfDamage: number; manaLeft: number; manaSpent: number;
  weaponWearEvents: number; weaponQualityLost: number; weaponBroken: number;
  armourWearEvents: number; armourQualityLost: number; armourBroken: number;
  zoneHits: number[]; zoneDamage: number[]; zoneAbsorbed: number[][]; // [zone][items, spell, toughness]
  zoneProtMisses: number[];           // misses that the to-hit protection caused
  zoneMisses: number[];
  easyHalved: number; resistedPlayer: number;
  srcAttempts: number[]; srcHits: number[]; srcCrits: number[]; srcDamage: number[];
  defensiveCasts: number;
  xp: number;                         // XP the game awards, summed over kills (raw units, tenths)
  xpNominal: number;                  // the same without the 16-bit wrap of the powerful bonus
  xpWrapped: number;                  // kills whose powerful bonus wrapped in 16 bits
  xpNegative: number;                 // kills that took experience away (wrapped below zero)
  xpHalved: number;                   // kills halved because the character outranks the dungeon level
  ttkSum: number;                     // seconds, wins
  dps: number;                        // summed damage per second over all fights
}

export function emptyStats(hpBins = 1, monBins = 1, durBins = 241): Stats {
  const z = (k: number) => new Array(k).fill(0);
  return {
    n: 0, outcomes: z(4), durHist: OUTCOMES.map(() => z(durBins)), durSum: z(4), hpLeftHist: z(hpBins),
    monHpLeftHist: z(monBins), dealt: z(DEALT_PARTS.length), dealtPerFight: 0, dealtPerFightSq: 0,
    absorbedMon: 0, resistedMon: 0, overkill: 0, pSwings: 0, pHits: 0, pCrits: 0, pMisses: 0, pBadMisses: 0,
    pShots: 0, pShotHits: 0, casts: 0, fizzles: 0, backfires: 0, selfDamage: 0, manaLeft: 0, manaSpent: 0,
    weaponWearEvents: 0, weaponQualityLost: 0, weaponBroken: 0, armourWearEvents: 0, armourQualityLost: 0, armourBroken: 0,
    zoneHits: z(4), zoneDamage: z(4), zoneAbsorbed: [z(3), z(3), z(3), z(3)], zoneProtMisses: z(4), zoneMisses: z(4),
    easyHalved: 0, resistedPlayer: 0, srcAttempts: z(6), srcHits: z(6), srcCrits: z(6), srcDamage: z(6),
    defensiveCasts: 0, xp: 0, xpNominal: 0, xpWrapped: 0, xpNegative: 0, xpHalved: 0, ttkSum: 0, dps: 0,
  };
}

/** Adds b into a (arrays of any shape, element by element; arrays grow as needed). */
export function mergeStats(a: Stats, b: Stats): Stats {
  const add = (x: any, y: any): any => {
    if (Array.isArray(y)) {
      for (let i = 0; i < y.length; i++) {
        if (Array.isArray(y[i])) { if (!x[i]) x[i] = []; add(x[i], y[i]); } else x[i] = (x[i] ?? 0) + y[i];
      }
      return x;
    }
    return x + y;
  };
  for (const k of Object.keys(b) as (keyof Stats)[]) {
    const v = b[k] as any;
    if (Array.isArray(v)) add(a[k], v); else (a as any)[k] += v;
  }
  return a;
}

/** Wilson score interval for k successes in n trials (95% by default). */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
