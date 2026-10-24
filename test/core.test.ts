import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPlayerDat, xorRecord, REC } from '../src/core/playerdat';
import { characterFromSave, derive, spellStatus } from '../src/core/character';
import { gradeCounts } from '../src/core/skillcheck';
import { SKILLS } from '../src/data/gameData';

const fx = (f: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', f)));
const expected = (f: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', f), 'utf8'));

describe('skill_check model', () => {
  it('boundaries (ideal model, n/31): scores 2/3, 15/16, 28/29', () => {
    expect(gradeCounts(-28, 0, 'ideal').counts).toEqual([31, 0, 0, 0]);
    expect(gradeCounts(-27, 0, 'ideal').counts).toEqual([30, 1, 0, 0]);
    expect(gradeCounts(-14, 0, 'ideal').counts).toEqual([17, 13, 1, 0]);
    expect(gradeCounts(-1, 0, 'ideal').counts).toEqual([4, 13, 13, 1]);
    expect(gradeCounts(28, 0, 'ideal').counts).toEqual([0, 0, 1, 30]);
    expect(gradeCounts(29, 0, 'ideal').counts).toEqual([0, 0, 0, 31]);
    for (let d = -60; d <= 60; d++) expect(gradeCounts(d, 0, 'ideal').counts.reduce((a, b) => a + b)).toBe(31);
  });
  it("the game's rand(): the same grades out of 32768, residue 0 weighted 1058", () => {
    for (let d = -60; d <= 60; d++) {
      const g = gradeCounts(d, 0, 'game');
      expect(g.counts.reduce((a, b) => a + b)).toBe(32768);
      expect(g.residues).toEqual(gradeCounts(d, 0, 'ideal').counts);
    }
    expect(gradeCounts(-1, 0, 'game').counts).toEqual([4 * 1057 + 1, 13 * 1057, 13 * 1057, 1057]);
  });
});

describe('PLAYER.DAT reader (against uw1-data/tools/read_playerdat.py)', () => {
  for (const name of ['empty', 'karl']) {
    it(`player-${name}.dat`, () => {
      const p = readPlayerDat(fx(`player-${name}.dat`));
      const e = expected(`player-${name}.expected.json`);
      expect(p.problems).toEqual([]);
      expect(p.name).toBe(e.name);
      expect([p.str, p.dex, p.int]).toEqual([e.str, e.dex, e.int]);
      expect(Object.fromEntries(SKILLS.map((s, i) => [s, p.skills[i]]))).toEqual(e.skills);
      expect([p.health, p.maxHealth, p.mana, p.maxMana, p.level, p.expRaw]).toEqual(
        [e.health, e.max_health, e.mana, e.max_mana, e.level, e.exp_raw]);
      expect([p.weight, p.maxWeight, p.easy, p.lefty]).toEqual([e.weight, e.max_weight, e.easy, e.lefty]);
      expect(p.runes.map((r) => ['An', 'Bet', 'Corp', 'Des', 'Ex', 'Flam', 'Grav', 'Hur', 'In', 'Jux', 'Kal', 'Lor', 'Mani',
        'Nox', 'Ort', 'Por', 'Quas', 'Rel', 'Sanct', 'Tym', 'Uus', 'Vas', 'Wis', 'Ylem'][r])).toEqual(e.runes);
      const items = Object.values(p.equipment).map((o) => [o.itemId, o.quality]).sort();
      const eItems = Object.values<any>(e.equipment).map((o) => [o.item_id, o.quality]).sort();
      expect(items).toEqual(eItems);
      expect(p.packSlotsIgnored).toBe(e.pack_slots_ignored);
      const d = derive(characterFromSave(p));
      expect(d.maxHp).toBe(e.derived.max_hp);
      expect(d.maxMana).toBe(e.derived.max_mana);
      const z = e.derived.armour_by_zone;
      expect(d.armour).toEqual([z.torso, z.gloves, z.legs_boots, z.head]);
      expect(d.defence).toBe(e.derived.defence);
    });
  }
  it('Karl: nothing castable at level 1 with 2 mana; Bet In Sanct needs 3 mana', () => {
    const c = characterFromSave(readPlayerDat(fx('player-karl.dat')));
    const st = spellStatus(c);
    expect(Object.values(st).filter((s) => s.castable)).toEqual([]);
    expect(st[1].reasons).toEqual(['needs 3 mana']);
  });
  it('the cipher round-trips', () => {
    const data = fx('player-karl.dat');
    const rec = xorRecord(data[0], data.subarray(1, 1 + REC));
    expect([...xorRecord(data[0], rec)]).toEqual([...data.subarray(1, 1 + REC)]);
  });
  it('a corrupted file is reported', () => {
    const data = fx('player-karl.dat').slice(0, 300);
    expect(readPlayerDat(data).problems.length).toBeGreaterThan(0);
  });
});
