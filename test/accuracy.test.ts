// Corrections from the source comparison (docs/SOURCE-COMPARISON.md): each test pins one rule of the
// game's C that the simulator used to get wrong.

import { describe, expect, it } from 'vitest';
import { defaultCharacter, derive } from '../src/core/character';
import { makeRng } from '../src/core/rng';
import { defaultSettings, explosionOf, monsterProfile, monsterSpell, playerProfile } from '../src/combat/setup';
import { newStats, simulate } from '../src/combat/fight';
import { creatures, SK } from '../src/data/gameData';

const cIndex = (name: string) => creatures.findIndex((c) => c.name === name);

describe('source comparison corrections', () => {
  it('armour spells add no armour (parse_spells reads bits 8-11 after shifting the bonus word four times)', () => {
    const c = defaultCharacter();
    c.runes = [...Array(24).keys()]; c.manaMax = 60; c.level = 16; c.skills[SK.Casting] = 30; c.dungeonLevel = 9;
    const bare = derive(c).armour;
    c.buffs = [59];                          // Iron Flesh, armour 5
    const d = derive(c);
    expect(d.activeBuffs).toEqual([59]);
    expect(d.armour).toEqual(bare);
    expect(d.notes.join(' ')).toContain('adds nothing');
    c.buffs = [1];                           // Luck still works: -3 to be hit everywhere
    expect(derive(c).cmbModTH).toEqual([3, 3, 3, 3]);
  });

  it('buffs are judged on the fight level: Thick Skin (circle 4) is refused in Britannia only', () => {
    const c = defaultCharacter();
    c.runes = [...Array(24).keys()]; c.manaMax = 60; c.level = 16; c.dungeonLevel = 1;
    c.buffs = [26];                          // Poison Weapon, circle 4
    expect(playerProfile(c, null, 1).buffs).toEqual([]);
    expect(playerProfile(c, null, 9).buffs.map((b) => b.index)).toEqual([26]);
  });

  it('packed creature spell bytes: 0x48 and 0x49 are the acid and snowball missiles', () => {
    const acid = monsterSpell(0x48), snow = monsterSpell(0x49);
    expect(acid.kind).toBe('missile');
    expect(snow.kind).toBe('missile');
    if (acid.kind === 'missile' && snow.kind === 'missile') {
      expect([acid.damage, acid.type]).toEqual([8, 0x10]);
      expect([snow.damage, snow.type]).toEqual([10, 0x63]);
    }
    const yeti = monsterProfile(cIndex('Yeti'), 50, false, 0, 25);
    expect(yeti.spells[0].kind).toBe('missile');
  });

  it('a heal spell heals the caster (healing: rollem(sub, 8), capped at avghit)', () => {
    const T = monsterProfile(cIndex('Great troll'), 20, false, 0, 25);
    expect(T.spells[2].kind).toBe('heal');
    // a character who cannot hurt it, at range: the troll casts its defensive Heal (chance caster/256 a step)
    const c = defaultCharacter();
    const P = { ...playerProfile(c, null, 25), hp: 10000, hpMax: 10000 };
    const S = { ...defaultSettings(), mode: 'ranged' as const, distance: 4, timeLimit: 60 };
    const st = simulate(newStats(P, T, S), P, T, S, { kind: 'set', value: 20 }, 50, makeRng(3));
    expect(st.monHeals).toBeGreaterThan(0);
    expect(st.monHealed).toBeGreaterThan(0);
    expect(st.monHealed).toBeLessThanOrEqual(st.monHeals * 32);
  });

  it('fireballs and lightning bolts explode where they stop', () => {
    expect(explosionOf(4)).toBe(1);   // 0x14 fireball
    expect(explosionOf(13)).toBe(1);  // 0x1D fireball
    expect(explosionOf(5)).toBe(2);   // 0x15 lightning bolt
    expect(explosionOf(7)).toBe(0);   // magic arrow
    const c = defaultCharacter();
    c.runes = [...Array(24).keys()]; c.manaMax = 60; c.level = 16; c.skills[SK.Casting] = 30;
    const F = playerProfile(c, 33, 9);
    expect(F.attackSpell?.missile?.explode).toBe(1);
    // the fireball's own 28 plus 10d6: a goblin with 60 HP and no fire resistance often dies to one cast
    const g = monsterProfile(cIndex('Goblin (0x49)'), 60, false, 0, 9);
    const S = { ...defaultSettings(), mode: 'ranged' as const, distance: 4, timeLimit: 3 };
    const st = simulate(newStats(F, g, S), F, g, S, { kind: 'stored' }, 400, makeRng(9));
    expect(st.dealt[6] / 400).toBeGreaterThan(40);
  });

  it('bare hands get the Poison Weapon bonus (is_sharp of the null pointer reads id 0x19, a bow)', () => {
    const c = defaultCharacter();
    c.runes = [...Array(24).keys()]; c.manaMax = 60; c.level = 16; c.skills[SK.Casting] = 30; c.dungeonLevel = 9;
    c.buffs = [26];
    expect(playerProfile(c, null, 9).melee.poison).toBe(true);
    c.equipment[8 - c.lefty] = { itemId: 0x95, quality: 40, ench: null };   // a torch in the weapon hand: not sharp
    expect(playerProfile(c, null, 9).melee.poison).toBe(false);
  });

  it('special weapon effect 15 adds 5 damage (spec_damage[8] reads the 5 after the table)', () => {
    const c = defaultCharacter();
    c.equipment[8 - c.lefty] = { itemId: 1, quality: 40, ench: { major: 12, effect: 15 } };
    const m = playerProfile(c, null, 9).melee;
    expect(m.specweap).toBe(8);
    expect(m.ench).toBe(5);
    c.equipment[8 - c.lefty] = { itemId: 1, quality: 40, ench: { major: 12, effect: 11 } };
    expect(playerProfile(c, null, 9).melee.ench).toBe(0);
  });

  it('the holding weapon holds for AI steps at rate 7, not ticks', () => {
    const c = defaultCharacter();
    c.skills[SK.Casting] = 30; c.skills[SK.Attack] = 30; c.skills[SK.Sword] = 30;
    c.equipment[8 - c.lefty] = { itemId: 4, quality: 63, ench: { major: 12, effect: 11 } };   // holding (specweap 4)
    const P = { ...playerProfile(c, null, 9), hp: 10000, hpMax: 10000 };
    const g = monsterProfile(cIndex('Goblin (0x49)'), 255, false, 0, 9);
    const S = { ...defaultSettings(), timeLimit: 30 };
    const st = simulate(newStats(P, g, S), P, g, S, { kind: 'set', value: 255 }, 200, makeRng(4));
    expect(st.specialHeldTicks).toBeGreaterThan(0);
    // a hold of (0..15) * 10 + 16 steps, each 7 ticks: on average about (7.5 * 10 + 17) * 7 / 16 = 40 s
    const perHold = st.specialHeldTicks / 16 / Math.max(1, st.specialTriggers);
    expect(perHold).toBeGreaterThan(20);
  });
  it('a poisonous bite poisons the player, who loses poison-- HP every third duration check', () => {
    const c = defaultCharacter();
    const P = { ...playerProfile(c, null, 9), hp: 10000, hpMax: 10000 };
    const M = monsterProfile(cIndex('Dread spider'), 255, false, 0, 9);
    expect(M.poison).toBe(8);
    const S = { ...defaultSettings(), timeLimit: 200 };
    const st = simulate(newStats(P, M, S), P, M, S, { kind: 'set', value: 255 }, 50, makeRng(2));
    expect(st.poisoned).toBeGreaterThan(0);
    expect(st.srcDamage[6]).toBeGreaterThan(0);
    // a tick is at most 8 (a new bite tops the poison up again) and at most four ticks, 60 s apart, fit in 200 s
    expect(st.srcDamage[6] / 50).toBeLessThanOrEqual(4 * 8);
  });
});
