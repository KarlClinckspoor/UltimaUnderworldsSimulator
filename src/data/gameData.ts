// Typed view of src/data/game.json (built by tools/compact-data.mjs from the UW2 extracts).
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
  race: number; poison: number; blood: number; ignoresFights: number;
  seqLen: number[] | null;   // CR.AN sequence lengths: 2 combat stance, 3..5 attacks, 6 cast / fire
}
export interface SpellRec { index: number; name: string | null; circle: number | null; cls: number; className: string | null;
  minor: number; flags: number; runes: number[]; words: string; missile: number | null; heal: string | null }
export interface EnemyRow { c: number; hp: number; pw: number; att: number; n: number; placed: number; trap: number;
  spawnP?: number[]; objs: number[]; authored: number }
export interface LevelRec { level: number; world: number; worldName: string; levelInWorld: number; rows: EnemyRow[] }
export interface WeaponFrames { lefty: number; kind: number; frmtot: number[]; wframe: number[][] }
export interface ItemRec { name: string; height: number; radius: number; resist: number; qualclass: number }

interface Raw {
  items: [string, number, number, number, number][];
  weapons: Weapon[]; missiles: MissileRec[]; armour: ArmourRec[]; creatures: CreatureRec[];
  spells: SpellRec[]; levels: LevelRec[]; weaponFrames: WeaponFrames[];
}
const R = raw as unknown as Raw;

export const items: ItemRec[] = R.items.map(([name, height, radius, resist, qualclass]) =>
  ({ name, height, radius, resist, qualclass }));
export const weapons = R.weapons;
export const missiles = R.missiles;
export const armour = R.armour;
export const creatures = R.creatures;
export const spells = R.spells;
export const levels = R.levels;
export const weaponFrames = R.weaponFrames;

/** (level - 1) / 8: eight levels to a world (SKILLCHK.C player_get_exp, RUNES.C player_cast). */
export const worldOf = (level: number) => Math.trunc((level - 1) / 8);
export const WORLD_NAMES = ['Britannia', 'Prison Tower', 'Killorn Keep', 'Ice Caverns', 'Talorus',
  'Scintillus Academy', 'Tomb of Praecor Loth', 'Pits of Carnage', 'Ethereal Void', 'Levels 73-80'];
export const worlds = WORLD_NAMES.map((name, w) => ({ world: w, name, levels: levels.filter((L) => L.world === w) }))
  .filter((w) => w.levels.length > 0);

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

/** Creature display name without the item-id suffix used to disambiguate duplicates. */
export const creatureLabel = (c: CreatureRec) => c.name;
