// Tests for the corrections of the source comparison (docs/SOURCE-COMPARISON.md).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPlayerDat } from '../src/core/playerdat';
import { characterFromSave, defaultCharacter, derive } from '../src/core/character';
import { makeRng, type Rng } from '../src/core/rng';
import { defaultSettings, monsterProfile, playerProfile } from '../src/combat/setup';
import { monsterStartHp, newStats, simulate } from '../src/combat/fight';
import { PART, SRC } from '../src/combat/stats';
import { creatures, SK } from '../src/data/gameData';

const karl = () => characterFromSave(readPlayerDat(new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'player-karl.dat')))));
const cIndex = (name: string) => creatures.findIndex((c) => c.name === name);
const allRunes = () => [...Array(24).keys()];

describe('armour spells add nothing (PLAYDATA.C parse_spells reads bits 8..11)', () => {
  it('Resist Blows, Thick Skin, Iron Flesh as buffs: armour unchanged, the level is only recorded', () => {
    for (const idx of [1, 17, 42]) {
      const c = karl();
      c.level = 16; c.manaMax = 60; c.runes = allRunes();
      const before = derive(c).armour;
      c.buffs = [idx];
      const d = derive(c);
      expect(d.activeBuffs).toEqual([idx]);
      expect(d.armour).toEqual(before);
      expect(d.armourParts.every((p) => p.spell === 0)).toBe(true);
      expect(d.armourSpellLevel).toBeGreaterThan(0);
      expect(d.notes.some((n) => n.includes('adds no armour'))).toBe(true);
    }
  });
  it('an armour enchantment on a worn ring adds nothing either; toughness still does', () => {
    const c = karl();
    const before = derive(c).armour;
    c.equipment[9] = { itemId: 0x38, quality: 40, ench: { major: 2, effect: 5 } };
    expect(derive(c).armour).toEqual(before);
    c.equipment[9] = { itemId: 0x38, quality: 40, ench: { major: 12, effect: 8 + 2 } }; // toughness 3
    const t = derive(c).armour;
    expect(t[0]).toBe(before[0] + 6); // twice to the torso, as player_affected_by reads
    expect(t[1]).toBe(before[1]);
  });
});

describe('random-number order', () => {
  /** A wrapper that logs each game draw by kind. */
  const recording = (seed: number) => {
    const base = makeRng(seed);
    const log: string[] = [];
    const r: Rng = {
      get draws() { return base.draws; }, set draws(v: number) { base.draws = v; },
      get state() { return base.state; },
      next: () => base.next(),
      rand: () => { log.push('rand'); return base.rand(); },
      int: (n: number) => { log.push(`int${n}`); return base.int(n); },
      rollem: (d: number, s: number) => { log.push(`rollem${d},${s}`); return base.rollem(d, s); },
    };
    return { r, log };
  };
  it('the monster swing (rand() % 9) is drawn before the powerful bonus (AI.C:1156, then COMBAT.C:803)', () => {
    const P = { ...playerProfile(karl(), null), hp: 5000, hpMax: 5000 };
    const M = monsterProfile(cIndex('Goblin (0x46)'), 255, true, 0);
    const S = { ...defaultSettings(), timeLimit: 60 };
    const { r, log } = recording(4);
    simulate(newStats(P, M, S), P, M, S, { kind: 'set', value: 255 }, 5, r);
    const at = log.flatMap((x, i) => (x === 'int6' ? [i] : []));
    expect(at.length).toBeGreaterThan(5);
    for (const i of at) { expect(log[i - 1]).toBe('int9'); expect(log[i + 1]).toBe('int12'); }
  });
  it('a bad miss bare-handed still draws the 2d3 of DamageInventory (COMBAT.C:319)', () => {
    const c = defaultCharacter();
    c.skills[SK.Attack] = 0; c.skills[SK.Barehand] = 0; c.dex = 1; // misses a lot
    const P = { ...playerProfile(c, null), hp: 5000, hpMax: 5000 };
    expect(P.melee.isFist).toBe(true);
    const M = monsterProfile(cIndex('Goblin (0x46)'), 255, false, 0); // not passive
    const S = { ...defaultSettings(), timeLimit: 60 };
    const { r, log } = recording(2);
    const st = simulate(newStats(P, M, S), P, M, S, { kind: 'set', value: 255 }, 5, r);
    expect(st.pBadMisses).toBeGreaterThan(0);
    expect(log.filter((x) => x === 'rollem2,3').length).toBe(st.pBadMisses);
  });
});

describe('Fireball and Lightning burst where they stop (OBJPHYS.C mob_to_static, EFFECT.C mts_doanim)', () => {
  it('the player Fireball: 10d6 more on the monster square after every hit', () => {
    const c = defaultCharacter();
    c.level = 9; c.manaMax = 15; c.runes = allRunes(); c.skills[SK.Casting] = 30;
    const P = playerProfile(c, 24);
    expect(P.attackSpell?.missile?.explode).toBe(1);
    const M = monsterProfile(cIndex('Giant Rat (0x43)'), 255, false, 0);
    const S = { ...defaultSettings(), mode: 'ranged' as const, timeLimit: 3 };
    const st = simulate(newStats(P, M, S), P, M, S, { kind: 'set', value: 255 }, 3000, makeRng(6));
    expect(st.pShotHits).toBeGreaterThan(2000);
    const mean = st.dealt[PART.explosion] / st.pShotHits; // a rat resists nothing: 10d6, mean 35
    expect(Math.abs(mean - 35)).toBeLessThan(0.5);
  });
  it('a mage Fireball bursts on the player square: one explosion per spell missile', () => {
    const P = { ...playerProfile(karl(), null), hp: 100000, hpMax: 100000 };
    const M = monsterProfile(cIndex('Mage (0x6C)'), 255, false, 0);
    expect(M.spells[0].kind === 'missile' && M.spells[0].explode).toBe(1);
    const S = { ...defaultSettings(), mode: 'ranged' as const, distance: 3, timeLimit: 120 };
    const st = simulate(newStats(P, M, S), P, M, S, { kind: 'set', value: 255 }, 300, makeRng(8));
    expect(st.srcAttempts[SRC.spell]).toBeGreaterThan(100);
    expect(st.srcAttempts[SRC.explosion]).toBe(st.srcAttempts[SRC.spell]);
    expect(Math.abs(st.srcDamage[SRC.explosion] / st.srcAttempts[SRC.explosion] - 35)).toBeLessThan(2);
  });
  it('Magic Arrow does not burst (fate 8)', () => {
    const c = defaultCharacter();
    c.runes = allRunes(); c.manaMax = 12;
    expect(playerProfile(c, 2).attackSpell?.missile?.explode).toBe(null);
  });
});

describe('poison (COMBAT.C critter_attack, PLAYTIME.C duration_check)', () => {
  it('a Wolf Spider bite poisons; poison does damage every third duration check', () => {
    const P = { ...playerProfile(karl(), null), hp: 100000, hpMax: 100000 };
    const M = monsterProfile(cIndex('Wolf Spider'), 255, false, 0);
    expect(M.poison).toBe(5);
    const S = { ...defaultSettings(), timeLimit: 300 };
    const st = simulate(newStats(P, M, S), P, M, S, { kind: 'set', value: 255 }, 100, makeRng(5));
    expect(st.poisoned).toBeGreaterThan(0);
    expect(st.srcDamage[SRC.poison]).toBeGreaterThan(0);
    // each tick does the level then one less; the bite re-poisons at 5 whenever it is lower
    expect(st.srcDamage[SRC.poison] / st.srcAttempts[SRC.poison]).toBeLessThanOrEqual(5);
  });
  it('Poison Resistance stops both the poisoning and the damage', () => {
    const c = karl();
    c.equipment[9] = { itemId: 0x38, quality: 40, ench: { major: 3, effect: 7 } };
    const P = { ...playerProfile(c, null), hp: 100000, hpMax: 100000 };
    expect(P.resist & 0x10).toBe(0x10);
    const M = monsterProfile(cIndex('Wolf Spider'), 255, false, 0);
    const S = { ...defaultSettings(), timeLimit: 300 };
    const st = simulate(newStats(P, M, S), P, M, S, { kind: 'set', value: 255 }, 100, makeRng(5));
    expect(st.poisoned).toBe(0);
    expect(st.srcDamage[SRC.poison]).toBe(0);
  });
});

describe('smaller corrections', () => {
  it('a non-weapon in the weapon hand: the fist strikes, with that object class 12 enchantment (COMBAT.C:591)', () => {
    const c = karl();
    c.equipment[7] = { itemId: 0x38, quality: 40, ench: { major: 12, effect: 8 + 2 } };
    const P = playerProfile(c, null);
    expect(P.melee.isFist).toBe(true);
    expect(P.melee.ench).toBe(3);
  });
  it('a rolled HP is a byte (creature_obj_init)', () => {
    const M = monsterProfile(0x3c, 250, false, 0); // item 0x7C, avghit 250
    const rng = makeRng(1);
    for (let i = 0; i < 200; i++) expect(monsterStartHp(M, { kind: 'roll' }, rng)).toBeLessThanOrEqual(255);
  });
});
