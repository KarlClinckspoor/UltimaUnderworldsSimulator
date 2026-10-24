import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPlayerDat, xorRecord, buildXorTable, REC } from '../src/core/playerdat';
import { characterFromSave, derive, spellStatus, maxWeight } from '../src/core/character';
import { gradeCounts } from '../src/core/skillcheck';
import { SKILLS, worldOf, levels } from '../src/data/gameData';

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

describe('UW2 PLAYER.DAT reader (against uw2-data/tools/read_playerdat.py)', () => {
  it('the key table matches build_xor_table for a few seeds', () => {
    // computed by hand from MISCUTIL.C:281 for key 0 ('K' ^ 0xAA = 0xE1 is the fixture's)
    const t = buildXorTable(0xe1);
    expect(t.length).toBe(0x50);
    // every entry is the running key at the moment it was last written: entries 0, 7, 14, ... come from the last loop
    let key = (0xe1 + 0x71) & 0xff;
    for (let i = 0x3c; i < 0x50; i++) key = (key + i + 2) & 0xff;
    for (let i = 0; i < 0x50; i++) key = (key + 6) & 0xff;
    for (let i = 0; i < 0x10; i++) key = (key + 7) & 0xff;
    for (let i = 0; i < 4; i++) key = (key + 0x29) & 0xff;
    for (let i = 0; i < 11; i++) { key = (key + 0x49) & 0xff; expect(t[i * 7]).toBe(key); }
  });
  it('player-karl.dat (a fresh UW2 character in the castle)', () => {
    const p = readPlayerDat(fx('player-karl.dat'));
    const e = expected('player-karl.expected.json');
    expect(p.problems).toEqual([]);
    expect(p.name).toBe('Karl');
    expect([p.str, p.dex, p.int]).toEqual([25, 19, 16]);
    expect(Object.fromEntries(SKILLS.map((s, i) => [s, p.skills[i]]))).toEqual(e.skills);
    expect([p.health, p.maxHealth, p.mana, p.maxMana, p.level, p.expRaw]).toEqual([35, 35, 2, 2, 1, e.exp_raw]);
    expect([p.weight, p.maxWeight, p.easy, p.lefty, p.skillPoints]).toEqual([e.weight, 25 * 13 + 300, 0, 1, 1]);
    expect(p.dungeonLevel).toBe(1);
    expect(p.runes).toEqual([]);
    const items = Object.entries(p.equipment).map(([s, o]) => [+s, o.itemId, o.quality]).sort((a, b) => a[0] - b[0]);
    // slot 1 leather vest, 4 leather boots, 5 a bag, 7 (the weapon hand, lefty 1) a badly worn dagger
    expect(items).toEqual([[1, 0x20, 40], [4, 0x29, 40], [5, 0x91, 40], [7, 3, 2]]);
    expect(p.packSlotsIgnored).toBe(e.pack_slots_ignored);
    const c = characterFromSave(p);
    const d = derive(c);
    expect(d.maxHp).toBe(35);
    expect(d.maxMana).toBe(2);
    expect(d.armour).toEqual([2, 0, 1, 0]);
    expect(d.defence).toBe(9);
    expect(maxWeight(c)).toBe(625);
  });
  it('Karl: nothing castable at level 1 with 2 mana; Luck needs 3 mana and the runes', () => {
    const c = characterFromSave(readPlayerDat(fx('player-karl.dat')));
    const st = spellStatus(c);
    expect(Object.values(st).filter((s) => s.castable)).toEqual([]);
    expect(st[1].reasons).toEqual(['missing runes Bet, Ort, In', 'needs 3 mana']);
  });
  it('Britannia forbids circle 4 and up; the same character on level 9 may cast them', () => {
    const c = characterFromSave(readPlayerDat(fx('player-karl.dat')));
    c.level = 16; c.manaMax = 60; c.runes = [...Array(24).keys()];
    c.dungeonLevel = 3;
    expect(spellStatus(c)[33].castable).toBe(false); // Fireball, circle 5
    expect(spellStatus(c)[19].castable).toBe(true);  // Lightning, circle 3
    expect(spellStatus(c, 9)[33].castable).toBe(true);
    c.dungeonLevel = 9;
    expect(spellStatus(c)[33].castable).toBe(true);
  });
  it('the cipher round-trips', () => {
    const data = fx('player-karl.dat');
    const rec = xorRecord(data[0], data.subarray(1, 1 + REC));
    expect([...xorRecord(data[0], rec)]).toEqual([...data.subarray(1, 1 + REC)]);
  });
  it('a corrupted or UW1 file is reported', () => {
    const data = fx('player-karl.dat').slice(0, 900);
    expect(readPlayerDat(data).problems.length).toBeGreaterThan(0);
    expect(() => readPlayerDat(data.slice(0, 300))).toThrow();
  });
});

describe('worlds', () => {
  it('eight levels to a world', () => {
    expect([1, 8, 9, 16, 41, 48, 65, 72, 73].map(worldOf)).toEqual([0, 0, 1, 1, 5, 5, 8, 8, 9]);
    expect(levels.length).toBe(42);
    expect(levels.find((L) => L.level === 17)?.worldName).toBe('Killorn Keep');
  });
});
