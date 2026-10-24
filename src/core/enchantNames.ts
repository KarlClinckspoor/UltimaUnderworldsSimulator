// What the game calls a class-12 enchantment, against what it does. obj/LOOK.C do_of names a
// weapon's enchantment with string block 6 entry 0x1C0 + effect, and armour's with 0x1D0 + effect
// (OBJ_MINOR > 1). The strings below are decoded from UW1's STRINGS.PAK; the effects are
// COMBAT.C DoPlayerWeapon (weapons: (e & 7) + 1 to hit for 0..7, damage for 8..15) and PLAYDATA.C
// player_affected_by (armour: protection for 0..7, toughness for 8..15).
//
// In UW1 the names are right: "Accuracy" adds to hit and "Damage" adds damage, eight tiers each with
// Unsurpassed the strongest. The swap players often report is real only in UW2, whose strings were
// shortened to four tiers each and put on the wrong effects (docs/FINDINGS.md of both games).

import type { Enchant } from './character';

const TIERS = ['Minor ', '', 'Additional ', 'Major ', 'Great ', 'Very Great ', 'Tremendous ', 'Unsurpassed '];
export const WEAPON_NAMES = [...TIERS.map((t) => `${t}Accuracy`), ...TIERS.map((t) => `${t}Damage`)];
export const ARMOUR_NAMES = [...TIERS.map((t) => `${t}Protection`), ...TIERS.map((t) => `${t}Toughness`)];

export interface EnchantInfo {
  gameName: string;      // what Look shows at lore 3, "of ..."
  effect: string;        // what it does
  misleading: string | null;
}

/** A class-12 enchantment on a weapon (true) or a worn item (false). */
export function describeEnchant(isWeapon: boolean, e: Enchant): EnchantInfo | null {
  if (e.major !== 12) return null;
  const x = e.effect & 15, n = (x & 7) + 1;
  if (isWeapon) return { gameName: WEAPON_NAMES[x], effect: x & 8 ? `+${n} damage` : `+${n} to hit`, misleading: null };
  return { gameName: ARMOUR_NAMES[x], effect: x & 8 ? `+${n} armour here (toughness)` : `monsters −${n} to hit here (protection)`, misleading: null };
}

/** The note shown with the enchantment choices. */
export const ENCHANT_NAME_NOTE = 'In UW1 the names are right: a weapon "of … Accuracy" adds to-hit and "of … Damage" adds damage, '
  + 'eight tiers each, +1 to +8 in the order Minor, (plain), Additional, Major, Great, Very Great, Tremendous, Unsurpassed. '
  + 'The tier words are not intuitive ("Major" +4 is below "Great" +5; the plain "Accuracy" is +2), but Unsurpassed is the strongest. '
  + 'Players often report Accuracy and Damage as swapped; that bug is real only in UW2, where effects 0-3 are named Accuracy but add damage.';
