// Typed view of src/data/game.json (built by tools/compact-data.mjs).
import raw from './game.json';

export interface Weapon { id: number; name: string; slash: number; bash: number; stab: number;
  minCharge: number; speed: number; maxCharge: number; skill: number; durability: number }
export interface MissileRec { id: number; name: string; damage: number; type: number; ammo: number; damageType: number | null }
export interface ArmourRec { id: number; name: string; protection: number; durability: number; category: number; categoryName: string | null }
export interface Attack { chance: number; damage: number; prob: number }
export interface CreatureRec {
  id: number; name: string; armour: number[]; avghit: number; str: number; dex: number; int: number;
  passive: number; flier: number; speed: number; equip: number; defence: number; attacks: Attack[];
  nerve: number; arms: { present: number; item: number }[]; firesMissile: number | null;
  offensive: number; exp: number; spells: number[]; caster: number; locks: number; noise: number;
  poison: number; blood: number; ignoresFights: number;
}
export interface SpellRec { index: number; circle: number | null; cls: number; className: string | null;
  minor: number; flags: number; runes: number[]; words: string; missile: number | null; heal: string | null }
export interface EnemyRow { c: number; hp: number; pw: number; att: number; n: number; placed: number; trap: number;
  spawnP?: number[]; objs: number[]; authored: number;
  /** the NPC's name (STRINGS.PAK block 7, whoami + 0x10), when it has one */
  who?: string }
export interface LevelRec { level: number; rows: EnemyRow[] }
export interface ItemRec { name: string; height: number; radius: number; resist: number; qualclass: number }

interface Raw {
  items: [string, number, number, number, number][];
  weapons: Weapon[]; missiles: MissileRec[]; armour: ArmourRec[]; creatures: CreatureRec[];
  spells: SpellRec[]; levels: LevelRec[];
}
const R = raw as unknown as Raw;

/** The talismans' identified names (LOOK.C talisman_desc, strings 0x105 + n at lore 3): every
    shiny sword, shiny shield and iron ring is the talisman, so the site uses these names. */
export const IDENTIFIED: Record<number, string> = { 0x0a: 'Caliburn (Sword of Justice)', 0x37: 'Shield of Valor', 0x36: 'Ring of Humility' };
const ident = <T extends { name: string }>(id: number, r: T): T => (IDENTIFIED[id] ? { ...r, name: IDENTIFIED[id] } : r);

export const items: ItemRec[] = R.items.map(([name, height, radius, resist, qualclass], id) =>
  ident(id, { name, height, radius, resist, qualclass }));
export const weapons = R.weapons.map((w) => ident(w.id, w));
export const missiles = R.missiles;
export const armour = R.armour.map((a) => ident(a.id, a));
export const creatures = R.creatures;
export const spells = R.spells;
export const levels = R.levels;

export const SKILLS = ['Attack', 'Defense', 'Barehand', 'Sword', 'Axe', 'Mace', 'Missile', 'Mana', 'Lore',
  'Casting', 'Traps', 'Search', 'Track', 'Stealth', 'Repair', 'Charisma', 'Pick Lock', 'Acrobat', 'Appraise',
  'Swimming'] as const;
export const SK = Object.fromEntries(SKILLS.map((s, i) => [s, i])) as Record<(typeof SKILLS)[number], number>;
export const RUNES = ['An', 'Bet', 'Corp', 'Des', 'Ex', 'Flam', 'Grav', 'Hur', 'In', 'Jux', 'Kal', 'Lor', 'Mani',
  'Nox', 'Ort', 'Por', 'Quas', 'Rel', 'Sanct', 'Tym', 'Uus', 'Vas', 'Wis', 'Ylem'];
export const ATTITUDES = ['hostile', 'upset', 'mellow', 'friendly'];
export const ITEM_ADVENTURER = 0x7f;

/** Creature heights, from COMOBJ.DAT (the player is item 0x7F, height 23). */
export const heightOf = (itemId: number) => items[itemId]?.height ?? 0;
export const resistOf = (itemId: number) => items[itemId]?.resist ?? 0;
export const itemName = (itemId: number) => items[itemId]?.name ?? `item 0x${itemId.toString(16)}`;

/** Goblin colours. CRIT\ASSOC.ANM gives each goblin an animation (gngob32 or graygob: the body
    and weapon) and an aux palette, and the palette sets the skin: palettes 0 and 2 carry the
    green ramp, 1 and 3 do not. This matches the tribes on level 1: Vernix, Drog and Lanugo
    (green) are 0x47 and 0x46; Ketchaval, Retichall, Eb and Jaacar (gray) are 0x50 and 0x4C. */
const GOBLIN_COLOUR: Record<number, string> = { 0x46: 'Green', 0x47: 'Green', 0x4d: 'Green', 0x4c: 'Gray', 0x4e: 'Gray', 0x50: 'Gray' };
/** Creature display name: no item-id suffix (it stays in tooltips), goblins by colour. */
export function creatureName(c: CreatureRec): string {
  const base = c.name.replace(/\s*\(0x[0-9a-f]+\)$/i, '');
  const col = GOBLIN_COLOUR[c.id];
  return col ? `${col} ${base.toLowerCase()}` : base;
}
export const creatureLabel = creatureName;
/** An NPC name as block 7 has it: 'a_bizarre fish' loses its article marker, 'the Slasher of Veils' keeps its own. */
export const npcName = (s: string) => s.replace(/^(a|an)_/, '').replace(/_/g, ' ');
export const creatureHex = (c: CreatureRec) => `creature 0x${c.id.toString(16).toUpperCase()}`;
