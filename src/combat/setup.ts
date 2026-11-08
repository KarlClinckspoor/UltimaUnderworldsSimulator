// Turns the character and a chosen enemy into the plain, serialisable profiles the fight
// loop (and the workers) use. Formulas (UW2 sources): COMBAT.C DoPlayerWeapon / GetPlayerWeapon /
// critter_attack / frp_check, OBJPHYS.C missile_newhit, RUNES.C player_cast, SPELLS.C area_spells /
// area1_spells / release_missile, AI.C crit_offense.

import { creatureName, creatures, heightOf, items, missiles, resistOf, SK, spells, weapons, worldOf, type Attack, type CreatureRec } from '../data/gameData';
import { derive, spellStatus, stabilityOf, weaponSlot, type ArmourParts, type Character } from '../core/character';
import { isSharp, SWING_KIND } from './blow';
import type { RandModel } from '../core/rng';

/** Ticks (1/16 s) between duration checks: INTERACT.C runs duration_check every 20 s of game time. */
export const DUR_CHECK_TICKS = 20 * 16;
export const PLAYER_HEIGHT = 23; // ComObjData[ITEM_ADVENTURER].height

export interface MeleeProfile {
  name: string; isFist: boolean; itemId: number;
  askill: number;          // to-hit value before hitangle (includes Valor)
  base: number[];          // damage byte per kind: slash, bash, stab (fist: the barehand formula)
  strBonus: number; ench: number; toHitEnch: number; valor: number;
  specweap: number;        // 0 none; 1 heal, 2 ward undead, 3 fireball, 4 hold, 5/6 doors (effect - 7)
  poison: boolean;         // Poison Weapon active and the weapon is sharp (frp_check)
  speed: number; minCharge: number; maxCharge: number; wsize: number;
  kind: number;            // weapid for WEAP.DAT: 0 sword, 1 axe, 2 mace, -1 fist (idle frames)
  quality: number; qualclass: number;
}
/** How a spell hurts: a missile, an area spell (SPELLS.C area_spells, by its target mode), or a
    targeted class 7 spell. */
export type AreaKind = 'sheet' | 'flame' | 'frost' | 'shockwave' | 'repel';
export type TargetKind = 'bleed' | 'smite' | 'smiteUndead';
/** A missile's explosion where it comes to rest (ComObjData fate 9: OBJPHYS.C mob_to_static -> EFFECT.C
    mts_doanim -> SPELLS.C damage_square): 1 the fireballs (0x14, 0x1D), 10d6 type 0x0B; 2 the lightning
    bolt (0x15), 6d5 type 3; 0 none. */
export type Explosion = 0 | 1 | 2;
export const explosionOf = (missileIndex: number): Explosion =>
  missileIndex === 4 || missileIndex === 13 ? 1 : missileIndex === 5 ? 2 : 0;
export interface MissileAttack { damage: number; type: number; name: string; explode: Explosion }
export interface SpellAttack {
  index: number; name: string; circle: number; cost: number; delayTicks: number;
  missile: MissileAttack | null;
  area: AreaKind | null;
  target: TargetKind | null;
}
export const AREA_SPELLS: Record<AreaKind, { count: number; dist: number; radius: number; random: boolean; name: string }> = {
  sheet: { count: 6, dist: 4, radius: 2, random: true, name: 'Sheet Lightning' },    // 6d5 type 3 per strike
  flame: { count: 10, dist: 4, radius: 2, random: false, name: 'Flame Wind' },       // 10d6 type 0x0B, once per square
  frost: { count: 5, dist: 3, radius: 1, random: false, name: 'Frost' },             // 10 type 0x23 to each critter
  shockwave: { count: 50, dist: 0, radius: 1, random: false, name: 'Shockwave' },    // Casting/2+15 type 3 to each critter
  repel: { count: 50, dist: 4, radius: 2, random: false, name: 'Repel Undead' },     // the undead flee; Casting type 3 to one already fleeing
};

export interface PlayerProfile {
  hp: number; hpMax: number; mana: number; manaMax: number; level: number; easy: boolean;
  armour: number[]; armourParts: ArmourParts[]; cmbModTH: number[]; resist: number; defence: number;
  hasted: boolean; timeStop: boolean; lefty: number;
  /** the active buffs, with their duration dice (set_curmagic); they wear off during the fight */
  buffs: { index: number; dice: number; sides: number; plus: number }[];
  melee: MeleeProfile; fist: MeleeProfile;
  launcher: { name: string; ammoName: string; damage: number; type: number } | null;
  missileSkill: number; casting: number; manaSkill: number;
  attackSpell: SpellAttack | null;
  attackSpellBlocked: string | null;   // why the chosen attack spell cannot be cast here
  /** The character and spell choice, so the fight can redo FixPlayerEquips when an item breaks. */
  character: Character; attackSpellIndex: number | null;
  expRaw: number;          // experience in the game's units (tenths of the displayed XP)
  fightLevel: number;      // the dungeon level the fight is on (1..80): its world sets casting and XP rules
}

export type MonsterSpell =
  | ({ kind: 'missile' } & MissileAttack)
  | { kind: 'area'; area: AreaKind; name: string }
  | { kind: 'heal'; sub: number; name: string }       // class 4: healing(who, sub), rollem(sub, 8) (sub 15: all)
  | { kind: 'none'; name: string };

export interface MonsterProfile {
  creature: number; itemId: number; name: string; hp: number; avghit: number; powerful: boolean; attitude: number;
  height: number; resist: number; armour: number[]; defence: number; nerve: number; equip: number; str: number;
  dex: number; passive: boolean; attacks: Attack[]; exp: number; blood: number; race: number;
  poison: number;          // Creature b0F: critter_attack's poison level on a hit
  missile: MissileAttack | null;
  caster: number; offensive: boolean; spells: MonsterSpell[];
  dungeonLevel: number;    // 1..80, for player_get_exp's halving rule and the Britannia casting rule
  ignoresFights: boolean;  // bA_1: never reacts to being hit (no flee check, a non-hostile one stays peaceful)
  seqLen: number[];        // CR.AN sequence lengths (8); the blow lands on frame 3 of sequences 3..5
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

/** spec_damage[8] and spec_skill[9] (COMBAT.C:59) are 17 contiguous bytes, 0 x 8, 5, 0 x 8, indexed by specweap
    1..8: specweap 8 (effect 15) reads spec_damage[8], the 5, past the end of its table. */
const SPEC_BYTES = [0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0];

/** `hand` is the item actually in the weapon hand (undefined when it is empty): frp_check's Poison Weapon term
    tests is_sharp on it. Bare-handed, AskInventory gives a null pointer and DOS reads the interrupt vector
    table at 0000:0000, whose id word 0x0019 (a bow) passes is_sharp (COMBAT.C:275, 322). */
function meleeFrom(c: Character, itemId: number | null, quality: number, ench: { major: number; effect: number } | null,
  valor: number, poisonWeap: boolean, hand: number | undefined): MeleeProfile {
  const wd = itemId !== null && itemId < 0x10 ? weapons[itemId] : weapons[15];
  const isFist = itemId === null || itemId >= 0x10;
  let skill = wd.skill;
  if (skill >= SK.Missile || skill < SK.Barehand) skill = SK.Barehand;
  let askill = (c.skills[SK.Attack] >> 1) + c.skills[skill] + valor + Math.trunc(c.dex / 7) + (c.easy ? 7 : 0);
  let base: number[], strBonus: number;
  if (skill === SK.Barehand) {
    const v = Math.trunc((c.skills[SK.Barehand] * 2) / 5) + 4;
    base = [v, v, v]; strBonus = Math.trunc(c.str / 6);
  } else {
    base = [wd.slash, wd.bash, wd.stab]; strBonus = Math.trunc(c.str / 9);
  }
  // DoPlayerWeapon: class 0xC enchantment, effect 0..3 damage 2e+1, 4..7 to-hit 2e-7, 8.. a special weapon
  let dmgEnch = 0, toHit = 0, specweap = 0;
  if (!isFist && ench && ench.major === 0xc) {
    if (ench.effect < 4) dmgEnch = ench.effect * 2 + 1;
    else if (ench.effect < 8) toHit = ench.effect * 2 - 7;
    else {
      specweap = ench.effect - 7;
      dmgEnch = SPEC_BYTES[specweap];        // spec_damage[specweap]: 5 for specweap 8, else 0
      toHit = SPEC_BYTES[8 + specweap];      // spec_skill[specweap]: always 0
    }
  }
  askill += toHit;
  const id = isFist ? 15 : itemId!;
  const kind = isFist ? -1 : Math.min(5, Math.max(3, wd.skill)) - 3;
  return {
    name: isFist ? 'Fist' : wd.name, isFist, itemId: id, askill, base, strBonus, ench: dmgEnch, toHitEnch: toHit, valor, specweap,
    poison: poisonWeap && (hand === undefined || isSharp(hand)), speed: wd.speed, minCharge: wd.minCharge, maxCharge: wd.maxCharge,
    wsize: items[id].radius, kind, quality: isFist ? 63 : quality, qualclass: isFist ? 3 : items[id].qualclass,
  };
}

/** The attack a spell makes when the player casts it; null for spells that do not hurt a monster. */
export function spellAttackOf(index: number, level: number): SpellAttack | null {
  const s = spells[index];
  if (!s || !s.circle) return null;
  const delayUnits = (s.circle * 2 - level) * 4 + 0x80; // RUNES.C:243, 1/256 s units
  const base = { index: s.index, name: s.name ?? s.words, circle: s.circle, cost: 3 * s.circle,
    delayTicks: Math.max(0, Math.ceil(delayUnits / 16)), missile: null, area: null, target: null } as SpellAttack;
  if (s.cls === 5 && s.missile !== null) {
    return { ...base, missile: missileAttack(s.missile) };
  }
  if (s.cls === 6) {
    const area = ({ 2: 'sheet', 4: 'flame', 5: 'repel', 6: 'shockwave', 7: 'frost' } as Record<number, AreaKind>)[s.minor];
    return area ? { ...base, area } : null;
  }
  if (s.cls === 7) {
    const target = ({ 0: 'bleed', 2: 'smiteUndead', 6: 'smite' } as Record<number, TargetKind>)[s.minor];
    return target ? { ...base, target } : null;
  }
  return null;
}

export function playerProfile(c: Character, attackSpellIndex: number | null, fightLevel = c.dungeonLevel): PlayerProfile {
  const d = derive(c, fightLevel);
  const w = c.equipment[weaponSlot(c)];
  const melee = w && w.itemId < 0x10 ? meleeFrom(c, w.itemId, w.quality, w.ench, d.valor, d.poisonWeap, w.itemId)
    : meleeFrom(c, null, 0, null, d.valor, d.poisonWeap, w?.itemId);
  const fist = meleeFrom(c, null, 0, null, d.valor, d.poisonWeap, undefined);
  let launcher: PlayerProfile['launcher'] = null;
  if (w && w.itemId >= 0x18 && w.itemId <= 0x1f) {
    const m = missiles[w.itemId - 0x10];
    if (m.ammo >= 0 && m.ammo < 0x10) {
      const ammo = missiles[m.ammo];
      launcher = { name: m.name, ammoName: ammo.name, damage: ammo.damage, type: ammo.damageType ?? 0x40 };
    }
  }
  let attackSpell: SpellAttack | null = null, attackSpellBlocked: string | null = null;
  if (attackSpellIndex !== null) {
    const st = spellStatus(c, fightLevel)[attackSpellIndex];
    if (st && st.castable) attackSpell = spellAttackOf(attackSpellIndex, c.level);
    else if (st) attackSpellBlocked = st.reasons.join(', ');
  }
  return {
    hp: d.startHp, hpMax: d.maxHp, mana: d.startMana, manaMax: d.maxMana, level: c.level, easy: c.easy,
    armour: d.armour, armourParts: d.armourParts, cmbModTH: d.cmbModTH, resist: d.resist, defence: d.defence,
    hasted: d.hasted, timeStop: d.timeStop, lefty: c.lefty, melee, fist, launcher,
    buffs: d.activeBuffs.map((index) => { const st = stabilityOf(index); return { index, dice: st.dice, sides: st.sides, plus: st.plus }; }),
    missileSkill: c.skills[SK.Missile], casting: c.skills[SK.Casting], manaSkill: c.skills[SK.Mana], attackSpell, attackSpellBlocked,
    character: c, attackSpellIndex, expRaw: c.expRaw, fightLevel,
  };
}

/** A missile by its index from FIRST_MISSILE (0x10): missile_newhit's damage, type -ammo, and its explosion. */
export function missileAttack(index: number, defaultType = 0): MissileAttack {
  const m = missiles[index];
  return { damage: m.damage, type: m.damageType ?? defaultType, name: m.name, explode: explosionOf(index) };
}

/** A creature's spell byte as SPELLS.C cast() reads it: 0..0x3F index spells[]; with bit 6 or 7 set it is
    class 12 + (byte >> 6), minor byte & 0x3F. Class 13 minors 8 and 9 are the acid and snowball missiles
    (special_spells -> do_spell(5, 4 or 6) -> release_missile items 6 and 12). */
export function monsterSpell(idx: number): MonsterSpell {
  if (idx === 0xff) return { kind: 'none', name: '-' };
  if (idx & 0xc0) {
    const cls = 12 + (idx >> 6), sub = idx & 0x3f;
    if (cls === 13 && (sub === 8 || sub === 9)) return { kind: 'missile', ...missileAttack(sub === 8 ? 6 : 12) };
    return { kind: 'none', name: `special spell ${cls}.${sub} (no damage to the player)` };
  }
  const s = spells[idx];
  if (!s) return { kind: 'none', name: `spell ${idx}` };
  const name = s.name ?? s.words ?? `spell ${idx}`;
  if (s.cls === 5 && s.missile !== null) return { kind: 'missile', ...missileAttack(s.missile) };
  if (s.cls === 4) return { kind: 'heal', sub: s.minor, name: `${name} (heals itself)` };
  if (s.cls === 6) {
    const area = ({ 2: 'sheet', 4: 'flame', 6: 'shockwave', 7: 'frost' } as Record<number, AreaKind>)[s.minor];
    if (area) return { kind: 'area', area, name: AREA_SPELLS[area].name };
  }
  return { kind: 'none', name: `${name} (${s.className ?? 'class ' + s.cls}, no damage to the player)` };
}

export function monsterProfile(creatureIndex: number, hp: number, powerful: boolean, attitude: number, dungeonLevel = 1): MonsterProfile {
  const cr: CreatureRec = creatures[creatureIndex];
  const fm = cr.firesMissile;
  return {
    creature: creatureIndex, itemId: cr.id, name: creatureName(cr), hp, avghit: cr.avghit, powerful, attitude,
    height: heightOf(cr.id), resist: resistOf(cr.id), armour: cr.armour, defence: cr.defence, nerve: cr.nerve,
    equip: cr.equip, str: cr.str, dex: cr.dex, passive: !!cr.passive, attacks: cr.attacks, exp: cr.exp, blood: cr.blood, race: cr.race,
    poison: cr.poison ?? 0,
    missile: fm !== null ? missileAttack(fm, 0x40) : null,
    caster: cr.caster, offensive: !!cr.offensive, spells: cr.spells.map(monsterSpell), ignoresFights: !!cr.ignoresFights, dungeonLevel,
    seqLen: cr.seqLen ?? [4, 4, 4, 4, 4, 4, 4, 4],
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

/** Poison Weapon's bonus (frp_check): damage += damage * (Casting + 30) / 40, before the critical. */
export const poisonBonus = (damage: number, casting: number) => damage + Math.trunc((damage * (casting + 30)) / 40);

export const isUndead = (resist: number) => (resist & 0x80) !== 0;
export const worldName = (level: number) => worldOf(level);
