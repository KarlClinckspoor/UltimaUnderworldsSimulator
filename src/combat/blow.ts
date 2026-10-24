// One blow, as combat/COMBAT.C and combat/DAMAGE.C do it. Every function takes a random
// source R so the C cross-check can feed the same rand() values to both versions. The exact
// distributions (…Dist, …Pass) use the weights of the chosen random model (core/randdist.ts).

import { faceProbs, modProbs, pModBelow } from '../core/randdist';

export interface R {
  /** rand() % n */
  int(n: number): number;
  /** rollem(dice, sides) */
  rollem(dice: number, sides: number): number;
}

/** pickloc (COMBAT.C:98): hit location 0..3 from the defender's bottom/top and the blow's. */
export function pickloc(dz: number, dtop: number, az: number, atop: number, r: R): number {
  const dmid = (dz + dtop) >> 1;
  const amid = (az + atop) >> 1;
  if (dz + 1 > amid) return 2;
  if (dtop - 1 < amid) return 3;
  if (amid < dmid) {
    if (r.int(2)) return 2;
  } else if (r.int(3) === 0) return 3;
  if (r.int(3)) return 0;
  return 1;
}

/** Exact distribution of pickloc over locations 0..3. */
export function picklocDist(dz: number, dtop: number, az: number, atop: number): number[] {
  const dmid = (dz + dtop) >> 1;
  const amid = (az + atop) >> 1;
  if (dz + 1 > amid) return [0, 0, 1, 0];
  if (dtop - 1 < amid) return [0, 0, 0, 1];
  const m2 = modProbs(2), m3 = modProbs(3);
  const p = [0, 0, 0, 0];
  let rest: number;
  if (amid < dmid) { p[2] = m2[1]; rest = m2[0]; } else { p[3] = m3[0]; rest = 1 - m3[0]; }
  p[0] += rest * (1 - m3[0]); p[1] += rest * m3[0];
  return p;
}

/** The probe a melee blow uses (resolve_attack): z from the swing, height (wsize*2+1)*4. */
export function meleeProbe(attackerZ: number, attackerHeight: number, towhere: number, wsize: number) {
  const z = attackerZ + Math.trunc((attackerHeight * Math.trunc(towhere / 3)) / 3);
  return { z, top: z + (wsize * 2 + 1) * 4 };
}

/** do_damage's dice: damage raised to 2, then (damage/6)d6 + 1d(damage%6). */
export function rollDamage(damage: number, r: R): number {
  if (damage < 2) damage = 2;
  const quot = Math.trunc(damage / 6), rem = damage % 6;
  let d = 0;
  if (quot) d = r.rollem(quot, 6);
  if (rem) d += r.rollem(1, rem);
  return d;
}

/** Exact distribution of rollDamage, as an array p[v] = P(roll = v). */
export function damageRollDist(damage: number): number[] {
  if (damage < 2) damage = 2;
  const quot = Math.trunc(damage / 6), rem = damage % 6;
  let dist = [1];
  const add = (sides: number) => {
    const fp = faceProbs(sides);
    const out = new Array(dist.length + sides).fill(0);
    for (let v = 0; v < dist.length; v++) if (dist[v]) for (let f = 1; f <= sides; f++) out[v + f] += dist[v] * fp[f - 1];
    dist = out;
  };
  for (let i = 0; i < quot; i++) add(6);
  if (rem) add(rem);
  return dist;
}

/** The critical multiplier ((rand() & 0x1F) + 0x30) >> 5: 1 or 2 at even odds. */
export const critMultiplier = (r: R) => ((r.int(32) + 0x30) >> 5);

/** Creature armour at a hit location (do_damage): 0xFF means use location 0. */
export function creatureArmourAt(armour: number[], hitloc: number, powerful: boolean): number {
  let a = armour[hitloc % 4];
  if (a === 0xff) a = armour[0];
  if (powerful) a = Math.trunc((a * 5) / 3);
  return a;
}

export const DMG_MAGIC = 0x03, DMG_PHYSICAL = 0x04, DMG_FIRE = 0x08, DMG_POISON = 0x10, DMG_COLD = 0x20, DMG_MISSILE = 0x40;

/** Fire on a cold-resistant object, or cold on a fire-resistant one that does not also resist cold,
    does double damage, capped at 0xFF (check_res, DAMAGE.C:224; UW2 only). */
export const checkResDoubles = (res: number, type: number) =>
  ((type & DMG_FIRE) && (res & DMG_COLD)) || ((type & DMG_COLD) && (res & DMG_FIRE) && (res & 0x28) !== 0x28);

/** check_res (DAMAGE.C:210). damage is a byte. */
export function checkRes(res: number, damage: number, type: number, r: R): number {
  if (type & res) {
    if (type & DMG_MAGIC) {
      if (r.int(3) < (res & 3)) return 0;
      type &= 0xfc;
    }
    if (res & type) return 0;
  }
  if (checkResDoubles(res, type)) damage = damage < 0x7f ? damage << 1 : 0xff;
  return damage;
}

/** Probability that check_res lets damage through (the doubling is separate: checkResDoubles). */
export function checkResPass(res: number, type: number): number {
  if (!(type & res)) return 1;
  let p = 1;
  if (type & DMG_MAGIC) { p = 1 - pModBelow(3, res & 3); type &= 0xfc; }
  if (res & type) return 0;
  return p;
}

/** is_sharp (COMBAT.C:275): a weapon or missile item other than the cudgel..mace range (7..9) and the sling. */
export const isSharp = (itemId: number) => itemId < 0x20 && !(itemId >= 7 && itemId < 10) && itemId !== 0x18;

/** should_i_flee (AI.C:1358). Arguments are bytes in the game. */
export function shouldIFlee(maxhp: number, hp: number, nerve: number, damage: number, r: R): boolean {
  maxhp &= 0xff; hp &= 0xff; damage &= 0xff;
  if ((maxhp * 3) >> 2 < hp) return false;
  if (maxhp >> 3 > hp) return false;
  if (maxhp >> 1 < damage) return true;
  if (maxhp === 0) return false;
  const v = Math.trunc((hp << 4) / maxhp) + r.int(4);
  return !(0xf - nerve < v);
}

/** Creature attack charge by attack frame (AI.C atk_charge). */
export const ATK_CHARGE = [50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 155, 170, 185, 205, 230, 255];

/** The swing kind of a view cell 1..9 (COMBAT.C swing_kind): 0 slash, 1 bash, 2 stab. */
export const SWING_KIND = [2, 2, 2, 0, 0, 0, 1, 1, 1];
export const SWING_KIND_NAMES = ['slash', 'bash', 'stab'];
