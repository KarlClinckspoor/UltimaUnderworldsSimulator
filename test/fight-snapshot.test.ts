// Part B results must not change when the monster's AI step is shared with the arena (plan C3, C7 step 1).
// Each scenario runs seeded fights and hashes the whole Stats record; the hashes were taken from the
// engine before the refactor.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPlayerDat } from '../src/core/playerdat';
import { characterFromSave } from '../src/core/character';
import { makeRng, type RandModel } from '../src/core/rng';
import { defaultSettings, monsterProfile, playerProfile } from '../src/combat/setup';
import { newStats, simulate, type HpMode } from '../src/combat/fight';
import { creatures } from '../src/data/gameData';

const karl = () => characterFromSave(readPlayerDat(new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'player-karl.dat')))));
const cIndex = (name: string) => creatures.findIndex((c) => c.name === name);

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

interface Scenario { name: string; creature: string; mode: 'melee' | 'ranged'; rand: RandModel; powerful?: boolean; hp: HpMode; tough?: boolean; distance?: number }
const SCENARIOS: Scenario[] = [
  { name: 'rat melee', creature: 'Giant tan rat', mode: 'melee', rand: 'game', hp: { kind: 'set', value: 12 } },
  { name: 'goblin melee ideal', creature: 'Goblin (0x49)', mode: 'melee', rand: 'ideal', hp: { kind: 'roll' } },
  { name: 'troll melee powerful', creature: 'Great troll', mode: 'melee', rand: 'game', powerful: true, hp: { kind: 'roll' }, tough: true },
  { name: 'skeleton melee', creature: 'Skeleton', mode: 'melee', rand: 'game', hp: { kind: 'set', value: 30 }, tough: true },
  { name: 'liche ranged', creature: 'Liche (0x69)', mode: 'ranged', rand: 'game', hp: { kind: 'roll' }, tough: true, distance: 3 },
  { name: 'human 5B ranged', creature: 'Human (0x5B)', mode: 'ranged', rand: 'game', hp: { kind: 'roll' }, tough: true, distance: 4 },
  { name: 'fighter ranged', creature: 'Fighter', mode: 'ranged', rand: 'ideal', hp: { kind: 'roll' }, tough: true, distance: 3 },
  { name: 'gazer ranged', creature: 'Gazer', mode: 'ranged', rand: 'game', hp: { kind: 'roll' }, tough: true, distance: 5 },
  { name: 'acid slug melee', creature: 'Acid slug', mode: 'melee', rand: 'game', hp: { kind: 'roll' }, tough: true },
];

function run(s: Scenario): string {
  const c = karl();
  let P = playerProfile(c, null);
  if (s.tough) P = { ...P, hp: 400, hpMax: 400 };
  const M = monsterProfile(cIndex(s.creature), creatures[cIndex(s.creature)].avghit, !!s.powerful, 0, 20);
  const S = { ...defaultSettings(), mode: s.mode, rand: s.rand, distance: s.distance ?? 3, timeLimit: 60 };
  const st = simulate(newStats(P, M, S), P, M, S, s.hp, 150, makeRng(7, 0, s.rand));
  return fnv(JSON.stringify(st));
}

const EXPECTED: Record<string, string> = {
  'rat melee': 'a9c9ce75',
  'goblin melee ideal': '25ae56fc',
  'troll melee powerful': '9f5a91ae',
  'skeleton melee': '36353485',
  'liche ranged': 'cac3778a',
  'human 5B ranged': '0e038ecb',
  'fighter ranged': '6c54db25',
  'gazer ranged': 'd8c6109c',
  'acid slug melee': 'cb0d34f2',
};

describe('Part B snapshot (unchanged by the arena refactor)', () => {
  for (const s of SCENARIOS) {
    it(s.name, () => {
      const h = run(s);
      if (process.env.PRINT_SNAPSHOT) console.log(`  '${s.name}': '${h}',`);
      if (EXPECTED[s.name]) expect(h).toBe(EXPECTED[s.name]);
    });
  }
});
