// The shared character: attributes, skills, equipment slots 0..10, buffs and the derived
// values the game computes in game/PLAYDATA.C FixPlayerEquips / player_affected_by /
// parse_spells, and game/SKILLS.C player_compute.

import { armour as ARMOUR, items, SK, spells, weapons, type SpellRec } from '../data/gameData';
import type { PlayerDat } from './playerdat';

export interface Enchant { major: number; effect: number }
export interface Equip { itemId: number; quality: number; ench: Enchant | null }

export interface Character {
  name: string;
  str: number; dex: number; int: number;
  skills: number[];          // 20, in SKILLS order
  level: number;
  expRaw: number;
  hp: number;                // current HP at fight start
  hpMax: number | null;      // null: derived 30 + level * STR / 5
  mana: number;
  manaMax: number | null;    // null: derived (Mana + 1) * INT >> 3
  easy: boolean;
  lefty: number;             // as stored (1 in both sample saves: weapon slot 7, shield slot 8)
  runes: number[];
  equipment: Record<number, Equip>;   // slot -> item
  buffs: number[];           // spell indices pre-cast before the fight
  payBuffMana: boolean;
  fullHp: boolean;           // start at max HP (default) rather than the stored HP
}

export const SLOT_NAMES = ['Head', 'Torso', 'Gloves', 'Legs', 'Boots', 'Shoulder (5)', 'Shoulder (6)',
  'Hand (7)', 'Hand (8)', 'Ring (9)', 'Ring (10)'];
export const ZONE_NAMES = ['Torso', 'Arms / gloves', 'Legs / boots', 'Head'];
// FixPlayerEquips: armour slot s (0..4) protects hit location defence_slot_index[s]
export const DEFENCE_SLOT_INDEX = [3, 0, 1, 2, 2, 0];
const PROTECT_FLAGS = [0x40, 0x08, 0x10, 0x01, 0x02]; // damage_protection_flags, protect minors 5..9

export const weaponSlot = (c: Character) => 8 - c.lefty;
export const shieldSlot = (c: Character) => 7 + c.lefty;

export function defaultCharacter(): Character {
  const skills = new Array(20).fill(0);
  skills[SK.Attack] = 10; skills[SK.Defense] = 6; skills[SK.Sword] = 8;
  return {
    name: 'Avatar', str: 23, dex: 19, int: 18, skills, level: 1, expRaw: 0, hp: 34, hpMax: null,
    mana: 2, manaMax: null, easy: false, lefty: 1, runes: [], equipment: {}, buffs: [], payBuffMana: true,
    fullHp: true,
  };
}

export function characterFromSave(p: PlayerDat): Character {
  const equipment: Record<number, Equip> = {};
  for (const [s, e] of Object.entries(p.equipment)) {
    const ench = e.enchantment && !e.enchantment.charged ? { major: e.enchantment.major, effect: e.enchantment.effect } : null;
    equipment[+s] = { itemId: e.itemId, quality: e.quality, ench };
  }
  return {
    name: p.name, str: p.str, dex: p.dex, int: p.int, skills: [...p.skills], level: p.level, expRaw: p.expRaw,
    hp: p.health, hpMax: p.maxHealth, mana: p.mana, manaMax: p.maxMana, easy: !!p.easy, lefty: p.lefty,
    runes: [...p.runes], equipment, buffs: [], payBuffMana: true, fullHp: true,
  };
}

// ------------------------------------------------------------- derived player values
export const derivedMaxHp = (c: Character) => (30 + Math.floor((c.level * c.str) / 5)) & 0xff;
export const derivedMaxMana = (c: Character) => ((c.skills[SK.Mana] + 1) * c.int) >> 3;
export const maxHp = (c: Character) => c.hpMax ?? derivedMaxHp(c);
export const maxMana = (c: Character) => c.manaMax ?? derivedMaxMana(c);
export const maxWeight = (c: Character) => c.str * 20;
export const LEVEL_TABLE = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192];

/** armor_val (PLAYDATA.C): (quality * protection >> 6) + 1; weapons and missiles give none. */
export function armorVal(e: Equip): number {
  if (e.itemId < 0x20 || e.itemId >= 0x40) return 0;
  return ((e.quality * ARMOUR[e.itemId - 0x20].protection) >> 6) + 1;
}
/** A shield for FixPlayerEquips: hack major, minor 3, in-class 11..15 (items 0x3B..0x3F). */
export const isShield = (id: number) => id >= 0x3b && id <= 0x3f;
/** ObjWorn (INVDATA.C): armour slots 0..4, rings 9 and 10, and a shield in the shield hand. */
export function objWorn(c: Character, id: number, slot: number): boolean {
  if (slot >= 0 && slot <= 4) return true;
  if (slot === 9 || slot === 10) return true;
  if (slot !== shieldSlot(c)) return false;
  return id >> 6 === 0 && ((id & 0x30) >> 4) >= 2 && (id & 15) >= 0xb && (id & 15) <= 0xf;
}

export interface ArmourParts { items: number; spell: number; toughness: number }
export interface Derived {
  maxHp: number; maxMana: number; startHp: number; startMana: number; buffMana: number;
  armour: number[];                 // per hit location 0..3
  armourParts: ArmourParts[];
  cmbModTH: number[];               // subtracted from the monster's to-hit, per location
  resist: number;                   // the player's ComObjData resist byte
  defence: number;                  // the monsters' to-hit target
  defenceSkill: number;             // skill index used for half the defence
  hasted: boolean; timeStop: boolean;
  activeBuffs: number[];            // buffs that are castable and applied
  notes: string[];
}

export function derive(c: Character): Derived {
  const notes: string[] = [];
  const armourParts: ArmourParts[] = [0, 1, 2, 3].map(() => ({ items: 0, spell: 0, toughness: 0 }));
  for (let s = 0; s <= 4; s++) {
    const e = c.equipment[s];
    if (e) armourParts[DEFENCE_SLOT_INDEX[s]].items += armorVal(e);
  }
  const sh = c.equipment[shieldSlot(c)];
  if (sh && isShield(sh.itemId)) {
    const v = armorVal(sh);
    armourParts[0].items += v; armourParts[1].items += v;
  }
  // defence: Defense + half the skill of the weapon in hand (Sword/Axe/Mace, else Barehand)
  let defenceSkill = SK.Barehand;
  const w = c.equipment[weaponSlot(c)];
  if (w && w.itemId < 0x10) defenceSkill = Math.min(5, Math.max(3, weapons[w.itemId].skill));
  const defence = c.skills[SK.Defense] + (c.skills[defenceSkill] >> 1);

  const cmb = [0, 0, 0, 0];
  let resist = 0, armourSpell = 0, hasted = false, timeStop = false;
  const affect = (major: number, minor: number, slot: number) => {
    switch (major) {
      case 2: armourSpell = Math.max(armourSpell, minor); break;               // armour
      case 3:                                                                  // protect
        if (minor === 1) for (let z = 0; z < 4; z++) cmb[z] += 3;
        else if (minor >= 5 && minor <= 9) resist |= PROTECT_FLAGS[minor - 5];
        break;
      case 11:                                                                 // xt
        if (minor === 0) timeStop = true;
        if (minor === 2) hasted = true;
        break;
      case 12: {                                                               // item protection / toughness
        if (slot < 0) break;
        const zs = slot > 4 ? [0, 1] : [DEFENCE_SLOT_INDEX[slot]];
        for (const z of zs) {
          let t = 0;
          if (minor & 8) t = (minor & 7) + 1; else cmb[z] += (minor & 7) + 1;
          armourParts[zs[0]].toughness += t;   // as the code reads: always the first location
        }
        break;
      }
    }
  };
  // active spells (buffs): only the castable ones, at most three (set_curmagic)
  const status = spellStatus(c);
  const activeBuffs: number[] = [];
  let buffMana = 0;
  for (const idx of c.buffs) {
    const st = status[idx];
    if (!st || !st.castable || activeBuffs.length >= 3) continue;
    const eff = activeEffectOf(spells[idx]);
    if (!eff) continue;
    activeBuffs.push(idx);
    buffMana += 3 * (spells[idx].circle ?? 1);
    affect(eff.major, eff.minor, -1);
  }
  // worn enchanted items
  for (let s = 0; s <= 10; s++) {
    const e = c.equipment[s];
    if (e && e.ench && objWorn(c, e.itemId, s)) affect(e.ench.major, e.ench.effect, s);
  }
  for (const p of armourParts) p.spell = armourSpell;
  const armour = armourParts.map((p) => p.items + p.spell + p.toughness);
  const mh = maxHp(c), mm = maxMana(c);
  const startMana = Math.max(0, (c.fullHp ? mm : Math.min(mm, c.mana)) - (c.payBuffMana ? buffMana : 0));
  if (c.payBuffMana && buffMana > mm) notes.push('The buffs cost more mana than the character has.');
  return {
    maxHp: mh, maxMana: mm, startHp: c.fullHp ? mh : Math.max(1, Math.min(mh, c.hp)), startMana, buffMana,
    armour, armourParts, cmbModTH: cmb, resist, defence, defenceSkill, hasted, timeStop, activeBuffs, notes,
  };
}

// ------------------------------------------------------------- spells the player can cast
/** The active-spell effect a spell sets (xt_spells maps its case to the active xt number). */
export function activeEffectOf(s: SpellRec): { major: number; minor: number } | null {
  if (s.cls === 2 || s.cls === 3) return { major: s.cls, minor: s.minor };
  if (s.cls === 11 && s.minor === 0) return { major: 11, minor: 2 };   // speed -> Hasted
  if (s.cls === 11 && s.minor === 11) return { major: 11, minor: 0 };  // freeze time -> TimeStop
  return null;
}

export const BUFF_SPELLS = [1, 17, 42, 6, 22, 27, 12, 46];
export const ATTACK_SPELLS = [2, 15, 24, 31, 45];

export interface SpellStatus { castable: boolean; reasons: string[]; circle: number; cost: number }
/** player_cast's rules with full mana: runes in the bag, level for the circle, mana for the cost. */
export function spellStatus(c: Character): Record<number, SpellStatus> {
  const out: Record<number, SpellStatus> = {};
  const mm = maxMana(c);
  for (const s of spells) {
    if (!s.circle) continue;
    const reasons: string[] = [];
    const missing = s.runes.filter((r) => !c.runes.includes(r));
    if (missing.length) reasons.push(`missing rune${missing.length > 1 ? 's' : ''} ${missing.map((r) => RUNE_NAMES[r]).join(', ')}`);
    if (Math.floor((c.level + 1) / 2) < s.circle) reasons.push(`needs level ${2 * s.circle - 1}`);
    if (3 * s.circle > mm) reasons.push(`needs ${3 * s.circle} mana`);
    out[s.index] = { castable: reasons.length === 0, reasons, circle: s.circle, cost: 3 * s.circle };
  }
  return out;
}
const RUNE_NAMES = ['An', 'Bet', 'Corp', 'Des', 'Ex', 'Flam', 'Grav', 'Hur', 'In', 'Jux', 'Kal', 'Lor', 'Mani',
  'Nox', 'Ort', 'Por', 'Quas', 'Rel', 'Sanct', 'Tym', 'Uus', 'Vas', 'Wis', 'Ylem'];

export const SPELL_LABELS: Record<number, string> = {
  0: 'Light', 1: 'Resist Blows (+2 armour)', 2: 'Magic Arrow', 6: 'Protection (-3 to be hit)', 8: 'Lesser Heal',
  12: 'Speed (monsters at half rate)', 15: 'Lightning', 17: 'Thick Skin (+3 armour)', 19: 'Heal',
  22: 'Flameproof (resist fire)', 24: 'Fireball', 27: 'Missile Protection (resist missiles)',
  31: 'Sheet Lightning', 42: 'Iron Flesh (+5 armour)', 45: 'Flame Wind', 46: 'Freeze Time',
};
export const spellLabel = (i: number) => `${spells[i]?.words ?? ''}${SPELL_LABELS[i] ? ' - ' + SPELL_LABELS[i] : ''}`;

export const itemLabel = (id: number) => items[id]?.name ?? `item 0x${id.toString(16)}`;

/** Character level from raw experience (SKILLCHK.C level_table; exp in tenths). */
export function levelFromExp(expRaw: number): number {
  let lv = 1;
  const pts = Math.floor(expRaw / 500);
  while (lv < 16 && LEVEL_TABLE[lv - 1] <= pts) lv++;
  return lv;
}
