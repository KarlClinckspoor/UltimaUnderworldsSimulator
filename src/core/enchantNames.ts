// What the game calls a class-12 enchantment, against what it does. obj/LOOK.C do_of names a
// weapon's enchantment with string block 6 entry 0x1C0 + effect, and armour's with 0x1D0 + effect
// (OBJ_MINOR > 1). The strings below are decoded from UW2's STRINGS.PAK; the effects are
// COMBAT.C DoPlayerWeapon (weapons) and PLAYDATA.C player_affected_by (armour).
//
// UW2's weapon names are the wrong way round: effects 0..3 add damage (2e + 1) but are named
// "... Accuracy", and effects 4..7 add to hit (2e - 7) but are named "... Damage"
// (docs/FINDINGS.md, "Weapon enchantments 'of Accuracy' and 'of Damage' do each other's job").
// Within each kind the order is right: Unsurpassed is the strongest. Armour names are right.

import type { Enchant } from './character';

export const WEAPON_NAMES = ['Minor Accuracy', 'Major Accuracy', 'Great Accuracy', 'Unsurpassed Accuracy',
  'Minor Damage', 'Major Damage', 'Great Damage', 'Unsurpassed Damage',
  'LifeStealer', 'Undead Bane', 'Fire Doom', 'Stone Strike', 'Unknown Special', 'Entry', 'Unknown Special', 'Unknown Special'];
export const ARMOUR_NAMES = ['Minor Protection', 'Protection', 'Additional Protection', 'Major Protection', 'Great Protection',
  'Very Great Protection', 'Tremendous Protection', 'Unsurpassed Protection',
  'Minor Toughness', 'Toughness', 'Additional Toughness', 'Major Toughness', 'Great Toughness', 'Very Great Toughness',
  'Tremendous Toughness', 'Unsurpassed Toughness'];

const SPECIALS = ['', 'heals you by the damage done', 'kills the undead (liches lose half their HP)', 'a fireball, 10d6 fire on the target',
  'holds the target (not the undead)', 'opens doors', 'opens doors, on every hit', 'nothing', 'nothing'];

export interface EnchantInfo {
  gameName: string;      // what Look shows at lore 3, "of ..."
  effect: string;        // what it does
  misleading: string | null;
}

/** A class-12 enchantment on a weapon (true) or a worn item (false). */
export function describeEnchant(isWeapon: boolean, e: Enchant): EnchantInfo | null {
  if (e.major !== 12) return null;
  const x = e.effect & 15;
  if (!isWeapon) {
    const n = (x & 7) + 1;
    return { gameName: ARMOUR_NAMES[x], effect: x & 8 ? `+${n} armour here (toughness)` : `monsters −${n} to hit here (protection)`, misleading: null };
  }
  if (x < 4) return { gameName: WEAPON_NAMES[x], effect: `+${2 * x + 1} damage`,
    misleading: `The game calls it "of ${WEAPON_NAMES[x]}", but it adds ${2 * x + 1} damage, not accuracy.` };
  if (x < 8) return { gameName: WEAPON_NAMES[x], effect: `+${2 * x - 7} to hit`,
    misleading: `The game calls it "of ${WEAPON_NAMES[x]}", but it adds ${2 * x - 7} to hit, not damage.` };
  const k = x - 7;
  return { gameName: WEAPON_NAMES[x], effect: `special: ${SPECIALS[k]}${k <= 5 ? ', after a critical hit' : ''}`, misleading: null };
}

/** The note shown with the enchantment choices. */
export const ENCHANT_NAME_NOTE = 'A bug in UW2: a weapon\'s "of … Accuracy" enchantments add damage and its "of … Damage" ones add to-hit. '
  + 'The code (DoPlayerWeapon) gives effects 0-3 +1/+3/+5/+7 damage and effects 4-7 +1/+3/+5/+7 to hit, while Look names effects 0-3 '
  + 'Minor/Major/Great/Unsurpassed Accuracy and 4-7 the same tiers of Damage. Within each kind the order is right (Unsurpassed is the '
  + 'strongest), and the simulator applies what the code does. Armour names (Protection, Toughness) are right. UW1 is not affected: '
  + 'there the names match.';
