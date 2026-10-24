// PLAYER.DAT reader: a port of uw1-data/tools/read_playerdat.py (the reference reader).
// Layout: docs/FORMATS.md "PLAYER.DAT"; uw1/src/include/player.h; sys/MISCUTIL.C xorread.
// Only the record, equipment slots 0..10 (with their enchantment) and the rune bag are read.

import { RUNES, SKILLS } from '../data/gameData';

export const REC = 0xd2;
const WS = 1 + REC + 2; // workspace (inventory) file offset 0xD5

export interface SavedObject {
  savedIndex: number; itemId: number; isQuant: number; enchanted: number; flag11: number;
  quality: number; next: number; owner: number; link: number;
}
export interface Enchantment { charged: boolean; major: number; effect: number }
export interface EquippedItem extends SavedObject { slot: number; enchantment: Enchantment | null }

export interface PlayerDat {
  name: string; str: number; dex: number; int: number; skills: number[];
  health: number; maxHealth: number; mana: number; maxMana: number; level: number; expRaw: number;
  weight: number; maxWeight: number; easy: number; lefty: number; pclass: number; dungeonLevel: number;
  runes: number[]; shelf: (number | null)[];
  equipment: Record<number, EquippedItem>;
  packSlotsIgnored: number; problems: string[];
}

/** XOR cipher of xorread/xorwrite: the same routine decodes and encodes the 0xD2-byte record. */
export function xorRecord(key: number, rec: Uint8Array): Uint8Array {
  const out = new Uint8Array(rec.length);
  for (let i = 0; i < rec.length; i++) out[i] = rec[i] ^ ((key + 3 * ((i % 0x50) + 1)) & 0xff);
  return out;
}

export function decodeRecord(data: Uint8Array) {
  if (data.length < 1 + REC + 2) throw new Error(`PLAYER.DAT too short (${data.length} bytes)`);
  const key = data[0];
  const rec = xorRecord(key, data.subarray(1, 1 + REC));
  const count = data[1 + REC] | (data[2 + REC] << 8);
  const problems: string[] = [];
  if ((rec[0] ^ 0xaa) !== key) problems.push('key does not match name[0] ^ 0xAA');
  const expected = 1 + REC + 2 + 0x5b + 8 * count;
  if (data.length !== expected) problems.push(`length ${data.length} != 1 + 0xD2 + 2 + 0x5B + 8 x ${count} (= ${expected})`);
  return { key, rec, count, problems };
}

function obj8(data: Uint8Array, n: number): SavedObject {
  const off = WS + 0x5b + 8 * n;
  const w = (o: number) => data[off + o] | (data[off + o + 1] << 8);
  const idw = w(0), qn = w(4), ol = w(6);
  return { savedIndex: n, itemId: idw & 0x1ff, isQuant: (idw >> 15) & 1, enchanted: (idw >> 12) & 1,
    flag11: (idw >> 11) & 1, quality: qn & 0x3f, next: qn >> 6, owner: ol & 0x3f, link: ol >> 6 };
}

/** decode_obj_spell (USEITEMS.C), as the reference reader does it. */
function enchantmentOf(data: Uint8Array, count: number, o: SavedObject): Enchantment | null {
  let sp: SavedObject | null = null;
  if (o.isQuant && o.enchanted) sp = o;
  else if (!o.isQuant && o.link) {
    let j = o.link, seen = 0;
    while (j && j < count && seen < 64) {
      const c = obj8(data, j);
      if (c.itemId >> 4 === 0x12) { sp = c; break; }
      j = c.next; seen++;
    }
  }
  if (!sp) return null;
  const link = (sp.link << 6) | sp.owner;
  const ln = link >> 6;
  if (sp.flag11) {
    const major = (ln & 0x1ff) >> 6;
    return { charged: true, major: major === 0 ? -1 : major + 12, effect: ln & 0x3f };
  }
  return { charged: false, major: (ln & 0x1ff) >> 4, effect: ln & 0xf };
}

export function readPlayerDat(data: Uint8Array): PlayerDat {
  const { rec, count, problems } = decodeRecord(data);
  const u16 = (o: number) => rec[o] | (rec[o + 1] << 8);
  const lefty = rec[0x64] & 1;
  let name = '';
  for (let i = 0; i < 0x1e && rec[i]; i++) name += String.fromCharCode(rec[i]);
  const skills = SKILLS.map((_, i) => rec[0x21 + i]);
  const level = rec[0x3d];
  if (level < 1 || level > 16) problems.push(`level ${level} outside 1..16`);
  if (skills.some((s) => s > 30)) problems.push('a skill is above 30');
  const bag = rec.subarray(0x44, 0x47);
  const runes: number[] = [];
  for (let r = 0; r < 24; r++) if ((bag[r >> 3] >> (7 - (r & 7))) & 1) runes.push(r);
  const shelf = [...rec.subarray(0x47, 0x4a)].map((r) => (r < 24 ? r : null));
  const equipment: Record<number, EquippedItem> = {};
  let packSlotsIgnored = 0;
  if (data.length >= WS + 0x23 + 56) {
    for (let s = 0; s < 28; s++) {
      const v = data[WS + 0x23 + 2 * s] | (data[WS + 0x23 + 2 * s + 1] << 8);
      const n = v >> 6;
      if (!n) continue;
      if (s >= 11) { packSlotsIgnored++; continue; }
      if (n >= count) { problems.push(`slot ${s} points at object ${n} past the saved count ${count}`); continue; }
      const o = obj8(data, n);
      equipment[s] = { ...o, slot: s, enchantment: enchantmentOf(data, count, o) };
    }
  }
  return {
    name, str: rec[0x1e], dex: rec[0x1f], int: rec[0x20], skills,
    health: rec[0x35], maxHealth: rec[0x36], mana: rec[0x37], maxMana: rec[0x38], level,
    expRaw: (rec[0x4e] | (rec[0x4f] << 8) | (rec[0x50] << 16) | (rec[0x51] << 24)) >>> 0,
    weight: u16(0x4a), maxWeight: u16(0x4c), easy: rec[0xb4], lefty, pclass: (rec[0x64] >> 5) & 7,
    dungeonLevel: (u16(0x5c) << 16) >> 16, runes, shelf, equipment, packSlotsIgnored, problems,
  };
}

export const runeName = (r: number) => RUNES[r];
