// Turns the character and a chosen enemy into the plain, serialisable profiles the fight
// loop (and the workers) use. Formulas: COMBAT.C DoPlayerWeapon / GetPlayerWeapon /
// critter_attack, OBJPHYS.C missile_newhit, RUNES.C player_cast, AI.C crit_offense.

import { creatures, heightOf, items, missiles, resistOf, SK, spells, weapons, type Attack, type CreatureRec } from '../data/gameData';
import { derive, spellStatus, stabilityOf, weaponSlot, type ArmourParts, type Character } from '../core/character';
import { SWING_KIND } from './blow';
import type { RandModel } from '../core/rng';

export const PLAYER_HEIGHT = 23; // ComObjData[ITEM_ADVENTURER].height
/** Ticks (1/16 s) between duration checks: INTERACT.C runs duration_check every 21 s of game time. */
export const DUR_CHECK_TICKS = 21 * 16;

export interface MeleeProfile {
  name: string; isFist: boolean;
  askill: number;          // to-hit value before hitangle
  base: number[];          // damage byte per kind: slash, bash, stab (fist: the barehand formula)
  strBonus: number; ench: number; toHitEnch: number;
  speed: number; minCharge: number; maxCharge: number; wsize: number;
  quality: number; qualclass: number;
}
export interface SpellAttack {
  index: number; words: string; circle: number; cost: number; delayTicks: number;
  missile: { damage: number; type: number; name: string } | null;
  area: 1 | 2 | null;      // damage_square kind: 1 flame wind (10d6 fire+magic), 2 sheet lightning (6d5 magic)
}
export interface PlayerProfile {
  hp: number; hpMax: number; mana: number; manaMax: number; level: number; easy: boolean;
  armour: number[]; armourParts: ArmourParts[]; cmbModTH: number[]; resist: number; defence: number;
  hasted: boolean; timeStop: boolean;
  /** the active buffs, with their duration dice (set_curmagic); they wear off during the fight */
  buffs: { index: number; dice: number; sides: number; plus: number }[];
  melee: MeleeProfile; fist: MeleeProfile;
  launcher: { name: string; ammoName: string; damage: number; type: number } | null;
  missileSkill: number; casting: number; manaSkill: number;
  attackSpell: SpellAttack | null;
  /** The character and spell choice, so the fight can redo FixPlayerEquips when an item breaks. */
  character: Character; attackSpellIndex: number | null;
  expRaw: number;          // experience in the game's units (tenths of the displayed XP)
}

export type MonsterSpell =
  | { kind: 'missile'; damage: number; type: number; name: string }
  | { kind: 'area'; area: 1 | 2; name: string }
  | { kind: 'none'; name: string };

export interface MonsterProfile {
  creature: number; itemId: number; name: string; hp: number; avghit: number; powerful: boolean; attitude: number;
  height: number; resist: number; armour: number[]; defence: number; nerve: number; equip: number; str: number;
  dex: number; passive: boolean; attacks: Attack[]; exp: number;
  missile: { damage: number; type: number; name: string } | null;
  caster: number; offensive: boolean; spells: MonsterSpell[];
  dungeonLevel: number;    // 1..9, for player_get_exp's halving rule
  ignoresFights: boolean;  // bA_1: never reacts to being hit (no flee check, a non-hostile one stays peaceful)
}

export interface FightSettings {
  mode: 'melee' | 'ranged';
  distance: number;        // tiles, ranged mode
  hitangle: number;        // 0 face to face .. 4 from behind (player's blows only)
  swing: number;           // 1..9 or 0 for the best swing
  timeLimit: number;       // seconds of game time
  rangedHitChance: number; // 0..1, missiles and missile spells
  aimTicks: number;        // aiming time per launcher shot or spell, in 1/16 s
  rand: RandModel;         // 'game': Borland rand() as the game draws it; 'ideal': exactly uniform
}
export const defaultSettings = (): FightSettings => ({
  mode: 'melee', distance: 3, hitangle: 0, swing: 0, timeLimit: 120, rangedHitChance: 1, aimTicks: 16, rand: 'game',
});

function meleeFrom(c: Character, itemId: number | null, quality: number, ench: { major: number; effect: number } | null): MeleeProfile {
  const wd = itemId !== null && itemId < 0x10 ? weapons[itemId] : weapons[15];
  const isFist = itemId === null || itemId >= 0x10;
  let skill = wd.skill;
  if (skill >= SK.Missile || skill < SK.Barehand) skill = SK.Barehand;
  let askill = (c.skills[SK.Attack] >> 1) + c.skills[skill] + Math.trunc(c.dex / 7) + (c.easy ? 7 : 0);
  let base: number[], strBonus: number;
  if (skill === SK.Barehand) {
    const v = Math.trunc((c.skills[SK.Barehand] * 2) / 5) + 4;
    base = [v, v, v]; strBonus = Math.trunc(c.str / 6);
  } else {
    base = [wd.slash, wd.bash, wd.stab]; strBonus = Math.trunc(c.str / 9);
  }
  let dmgEnch = 0, toHit = 0;
  if (!isFist && ench && ench.major === 0xc) {
    if (ench.effect & 8) dmgEnch = (ench.effect & 7) + 1; else toHit = (ench.effect & 7) + 1;
  }
  askill += toHit;
  const id = isFist ? 15 : itemId!;
  return {
    name: isFist ? 'Fist' : wd.name, isFist, askill, base, strBonus, ench: dmgEnch, toHitEnch: toHit,
    speed: wd.speed, minCharge: wd.minCharge, maxCharge: wd.maxCharge, wsize: items[id].radius,
    quality: isFist ? 63 : quality, qualclass: isFist ? 3 : items[id].qualclass,
  };
}

export function playerProfile(c: Character, attackSpellIndex: number | null): PlayerProfile {
  const d = derive(c);
  const w = c.equipment[weaponSlot(c)];
  const melee = w && w.itemId < 0x10 ? meleeFrom(c, w.itemId, w.quality, w.ench) : meleeFrom(c, null, 0, null);
  const fist = meleeFrom(c, null, 0, null);
  let launcher: PlayerProfile['launcher'] = null;
  if (w && w.itemId >= 0x18 && w.itemId <= 0x1f) {
    const m = missiles[w.itemId - 0x10];
    if (m.ammo >= 0 && m.ammo < 0x10) {
      const ammo = missiles[m.ammo];
      launcher = { name: m.name, ammoName: ammo.name, damage: ammo.damage, type: ammo.damageType ?? 0x40 };
    }
  }
  let attackSpell: SpellAttack | null = null;
  if (attackSpellIndex !== null) {
    const st = spellStatus(c)[attackSpellIndex];
    const s = spells[attackSpellIndex];
    if (st && st.castable && s.circle) {
      const delayUnits = (s.circle * 2 - c.level) * 4 + 0x40;
      let missile: SpellAttack['missile'] = null, area: SpellAttack['area'] = null;
      if (s.cls === 5 && s.missile !== null) {
        const m = missiles[s.missile];
        missile = { damage: m.damage, type: m.damageType ?? 0, name: m.name };
      } else if (s.cls === 6 && s.minor === 2) area = 2;
      else if (s.cls === 6 && s.minor === 4) area = 1;
      if (missile || area) attackSpell = { index: s.index, words: s.words, circle: s.circle, cost: 3 * s.circle,
        delayTicks: Math.max(0, Math.ceil(delayUnits / 16)), missile, area };
    }
  }
  return {
    hp: d.startHp, hpMax: d.maxHp, mana: d.startMana, manaMax: d.maxMana, level: c.level, easy: c.easy,
    armour: d.armour, armourParts: d.armourParts, cmbModTH: d.cmbModTH, resist: d.resist, defence: d.defence,
    hasted: d.hasted, timeStop: d.timeStop, melee, fist, launcher,
    buffs: d.activeBuffs.map((index) => { const st = stabilityOf(index); return { index, dice: st.dice, sides: st.sides, plus: st.plus }; }),
    missileSkill: c.skills[SK.Missile], casting: c.skills[SK.Casting], manaSkill: c.skills[SK.Mana], attackSpell,
    character: c, attackSpellIndex, expRaw: c.expRaw,
  };
}

function monsterSpell(idx: number): MonsterSpell {
  if (idx === 0xff) return { kind: 'none', name: '-' };
  const s = spells[idx];
  if (!s) return { kind: 'none', name: `spell ${idx}` };
  const name = s.words || `spell ${idx}`;
  if (s.cls === 5 && s.missile !== null) {
    const m = missiles[s.missile];
    return { kind: 'missile', damage: m.damage, type: m.damageType ?? 0, name: m.name };
  }
  if (s.cls === 6 && s.minor === 2) return { kind: 'area', area: 2, name: 'Sheet Lightning' };
  if (s.cls === 6 && s.minor === 4) return { kind: 'area', area: 1, name: 'Flame Wind' };
  return { kind: 'none', name: `${name} (${s.className ?? 'class ' + s.cls}, no effect on the player)` };
}

export function monsterProfile(creatureIndex: number, hp: number, powerful: boolean, attitude: number, dungeonLevel = 1): MonsterProfile {
  const cr: CreatureRec = creatures[creatureIndex];
  const fm = cr.firesMissile;
  return {
    creature: creatureIndex, itemId: cr.id, name: cr.name, hp, avghit: cr.avghit, powerful, attitude,
    height: heightOf(cr.id), resist: resistOf(cr.id), armour: cr.armour, defence: cr.defence, nerve: cr.nerve,
    equip: cr.equip, str: cr.str, dex: cr.dex, passive: !!cr.passive, attacks: cr.attacks, exp: cr.exp,
    missile: fm !== null ? { damage: missiles[fm].damage, type: missiles[fm].damageType ?? 0x40, name: missiles[fm].name } : null,
    caster: cr.caster, offensive: !!cr.offensive, spells: cr.spells.map(monsterSpell), ignoresFights: !!cr.ignoresFights, dungeonLevel,
  };
}

/** The player's chosen swing cell: the fixed one, or the middle cell of the row of the swing
    kind with the highest damage byte. Cells 1-3 stab, 4-6 slash, 7-9 bash. */
export function chooseSwing(m: MeleeProfile, setting: number): number {
  if (setting >= 1 && setting <= 9) return setting;
  const order = [{ k: 0, cell: 5 }, { k: 1, cell: 8 }, { k: 2, cell: 2 }];
  let best = order[0];
  for (const o of order) if (m.base[o.k] > m.base[best.k]) best = o;
  return best.cell;
}
export const swingKindOf = (cell: number) => SWING_KIND[cell - 1];

/** Monsters that can fight: a real creature with hit points and an attack. */
export function combatCapable(c: CreatureRec, hp: number): boolean {
  return c.avghit > 0 && hp > 0 && c.attacks.some((a) => a.prob > 0 || a.damage > 0);
}
