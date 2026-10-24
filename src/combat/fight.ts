// The fight loop: one player against one monster, nobody moving (plan B2), in 1/16 s ticks.
// UW2 timings: the monster's AI step every 4 ticks (AI.C critter_ai; 8 ticks under Speed, never
// under Freeze Time), its blow on the step that finds frame 3 of attack sequences 3..5 and the
// sequence over on the step that finds frame seq_len - 1 (CR.AN); the player's swing follows
// PANELS.C adjust_weapon (one weapon frame per 32 clock units = 2 ticks) through the frames of
// DATA\WEAP.DAT and COMBAT.C player_attack (charge +speed per 16 units at the hold frame, the
// blow at the strike frame).

import type { Rng } from '../core/rng';
import { gradeOfRoll, skillCheck } from '../core/skillcheck';
import {
  ATK_CHARGE, checkRes, creatureArmourAt, critMultiplier, DMG_PHYSICAL, meleeProbe, pickloc, rollDamage, shouldIFlee,
} from './blow';
import {
  AREA_SPELLS, chooseSwing, isUndead, PLAYER_HEIGHT, poisonBonus, swingKindOf, type AreaKind, type FightSettings,
  type MeleeProfile, type MonsterProfile, type PlayerProfile,
} from './setup';
import { DUR_BIN, emptyStats, type Stats } from './stats';
import { creatures, items, weaponFrames, worldOf } from '../data/gameData';
import { objWorn, shieldSlot, weaponSlot, type Character } from '../core/character';
import { playerProfile } from './setup';

export type HpMode = { kind: 'stored' } | { kind: 'roll' } | { kind: 'set'; value: number };

const nextBoundary = (t: number) => t + (t % 2 === 0 ? 2 : 1);

/** The frame indexes of a swing: hold (phase 0x40), strike (phase 0x80) and the total (frmtot),
    from WEAP.DAT for weapon kind 0..2 (sword, axe, mace); kind 3 is the bare fist (ammunition in
    hand too); -1 the built-in idle table a launcher in hand gets (do_weapload, PANELS.C:548). */
export function swingFrames(kind: number, swingKind: number, lefty: number): { hold: number; strike: number; total: number } {
  const IDLE = [0x20, 0x21, 0x42, 0x63, 0x64, 0x65, 0x86, 0xa7, 0xe8];
  let frames: number[], total: number;
  if (kind < 0 || kind > 3) { frames = IDLE; total = 9; }
  else {
    const rec = weaponFrames.find((w) => w.lefty === lefty && w.kind === kind) ?? weaponFrames.find((w) => w.kind === kind);
    if (!rec) { frames = IDLE; total = 9; } else { frames = rec.wframe[swingKind]; total = rec.frmtot[swingKind]; }
  }
  let hold = frames.findIndex((f) => (f & 0xe0) === 0x40);
  if (hold < 0) hold = 3;
  let strike = frames.findIndex((f, i) => i > hold && (f & 0xe0) === 0x80);
  if (strike < 0) strike = hold + 3;
  return { hold, strike, total: Math.max(total, strike + 1) };
}

/** Strike time and next possible start of a full-charge melee swing begun at tick s.
    Frames every 2 ticks from the next boundary; charging (speed per tick, to 100) starts one tick
    after the hold frame shows; release restarts the frames at the next boundary. */
export function swingTimes(s: number, speed: number, f = { hold: 3, strike: 6, total: 9 }) {
  const b1 = nextBoundary(s);              // weap_frame 0
  const bh = b1 + 2 * f.hold;              // the hold frame: charging starts
  const k = Math.ceil(100 / Math.max(1, speed));
  const release = bh + k + 1;              // play_pow reaches 100 (the first 16 units only set otime)
  const c1 = nextBoundary(release);        // frame hold + 1
  const strike = c1 + 2 * (f.strike - f.hold - 1);
  const ready = c1 + 2 * (f.total - f.hold - 1); // weap_frame == frmtot: ready (-1)
  return { strike, next: ready + 1 };      // a new swing the frame after
}
/** Fire time and next start of a launcher shot: the idle table's hold frame (index 2) opens the
    aim cursor, the shot leaves on release, missile_finish puts the weapon back at once. */
export function shotTimes(s: number, aim: number) {
  const bh = nextBoundary(s) + 4;
  const fire = bh + aim;
  return { fire, next: nextBoundary(fire) + 1 };
}

/** The monster's square in an area spell's rectangle (gronk_area / process_area): the centre is
    `dist` squares ahead of the caster, the rectangle runs -radius..radius+1 around it, the monster
    stands D squares straight ahead. Returns the square's index in the iteration order (x outer,
    y inner, the x axis across the line of fire) or -1 when it is outside. */
export function areaSquareIndex(kind: AreaKind, D: number): number {
  const a = AREA_SPELLS[kind];
  const rel = D - a.dist;
  if (rel < -a.radius || rel > a.radius + 1) return -1;
  const side = 2 * a.radius + 2;
  return a.radius * side + (rel + a.radius);
}

/** player_killed_a's amount (COMBAT.C:942): exp * 4 + 2d(exp); a powerful critter times (24..47)/16 in a
    32-bit product whose quotient is stored back into a 16-bit int. */
export function killedExp(cexp: number, powerful: boolean, rng: R16) {
  let exp = cexp * 4 + rng.rollem(2, cexp);
  exp = ((exp & 0xffff) ^ 0x8000) - 0x8000;
  let nominal = exp, wrapped = false;
  if (powerful) {
    const q = Math.trunc((exp * (rng.int(24) + 24)) / 16);
    nominal = q;
    exp = ((q & 0xffff) ^ 0x8000) - 0x8000;
    wrapped = exp !== q;
  }
  return { exp, nominal, wrapped };
}
/** player_get_exp's arithmetic (SKILLCHK.C:63) for a gain or loss n on dungeon level `at`: a gain is halved
    (rounding up or down at random), halved again (+1) when the character's level is above twice the world
    number plus two, a loss stops at 0, and a gain that would pass 0x7FFF0 is refused. Returns the new
    experience; levels stop above 0x17700 but the experience still counts. */
export function getExpAfter(n: number, level: number, at: number, expRaw: number, rng: R16): { exp: number; halved: boolean } {
  let halved = false;
  if (n > 0) n = Math.trunc((n + rng.int(2)) / 2);
  if (n < 0) return { exp: -n > expRaw ? 0 : expRaw + n, halved };
  if (worldOf(at) * 2 + 2 < level) { n = Math.trunc(n / 2) + 1; halved = true; }
  if (expRaw + n > 0x7fff0) return { exp: expRaw, halved };
  return { exp: expRaw + n, halved };
}
type R16 = { int(n: number): number; rollem(d: number, s: number): number };

/** Experience for a kill by the player (player_killed_a -> player_get_exp). Only a kill pays: damage_critter
    calls player_killed_a when the critter dies and the player struck it. Units: tenths of the displayed XP. */
export function killXp(M: MonsterProfile, P: { level: number; expRaw: number }, rng: R16) {
  const k = killedExp(M.exp, M.powerful, rng);
  const g = getExpAfter(k.exp, P.level, M.dungeonLevel, P.expRaw, rng);
  return { awarded: g.exp - P.expRaw, nominal: Math.trunc(k.nominal / 2), wrapped: k.wrapped, halved: g.halved, rawAmount: k.exp };
}

export function monsterStartHp(m: MonsterProfile, mode: HpMode, rng: Rng): number {
  if (mode.kind === 'set') return Math.max(1, Math.min(255, mode.value | 0));
  if (mode.kind === 'roll') return Math.max(1, Math.trunc((m.avghit * (16 + rng.int(24))) / 32));
  return m.hp;
}

export function newStats(p: PlayerProfile, m: MonsterProfile, s: FightSettings): Stats {
  const monMax = Math.max(m.hp, Math.trunc((m.avghit * 39) / 32), 1) + 1;
  return emptyStats(p.hpMax + 1, Math.max(monMax, 256), Math.ceil(s.timeLimit / DUR_BIN) + 1);
}

/** Runs n fights and adds them to st. */
export function simulate(st: Stats, P: PlayerProfile, M: MonsterProfile, S: FightSettings, hpMode: HpMode,
  n: number, rng: Rng): Stats {
  const d0 = rng.draws;
  for (let i = 0; i < n; i++) fight(st, P, M, S, hpMode, rng);
  st.draws += rng.draws - d0;
  return st;
}

/** restore_mana: nothing in Scintillus Academy (world 5) but on its level 1 and the far side of its
    level 8 (x >= 25, taken as not reached). */
export const manaRegenAllowed = (level: number) => worldOf(level) !== 5 || level === 41;

export function fight(st: Stats, P0: PlayerProfile, M: MonsterProfile, S: FightSettings, hpMode: HpMode, rng: Rng) {
  const T = Math.round(S.timeLimit * 16);
  const ranged = S.mode === 'ranged';
  const D = Math.max(1, Math.round(S.distance));
  const D2 = D * D;
  const rawSpells = creatures[M.creature].spells;
  let P = P0;
  let ch: Character | null = null; // a copy of the character, made when an item first wears
  const own = () => (ch ??= structuredClone(P0.character));
  /** An item broke: FixPlayerEquips recomputes armour, defence, protection and the weapon (INVDATA.C). */
  const refit = () => {
    const np = playerProfile(own(), P0.attackSpellIndex, P0.fightLevel);
    P = { ...np, hp: P0.hp, mana: P0.mana };
    mel = { ...np.melee };
    quality = mel.quality;
  };

  // ---- player state
  let php = P.hp, mana = P.mana;
  let mel: MeleeProfile = { ...P.melee };
  let quality = mel.quality;
  const cell = () => chooseSwing(mel, S.swing);
  // ---- monster state
  let mhp = monsterStartHp(M, hpMode, rng);
  const mhp0 = mhp;
  let dmgTaken = 0, lastHit = false, active = M.attitude === 0, bound = false;
  let seq = 0, frame = 0, k = 0, castSlot = 0, heldUntil = -1, tNow = 0;
  const interval = P.timeStop ? Infinity : P.hasted ? 8 : 4;
  let tM = P.timeStop ? Infinity : rng.int(4);
  const regenOk = manaRegenAllowed(P0.fightLevel);
  let tRegen = regenOk ? 960 : Infinity; // mana: skill_check(Mana, 10) every third 20 s duration check

  let outcome = -1; // 0 win 1 death 2 flee 3 timeout
  let dealt = 0;

  // ---- what the player does next
  type Plan = 'melee' | 'launcher' | 'spell' | 'none';
  const decide = (): Plan => {
    if (ranged) {
      if (P.attackSpell && mana >= P.attackSpell.cost) return 'spell';
      return P.launcher ? 'launcher' : 'none';
    }
    return P.launcher ? 'launcher' : 'melee';
  };
  let plan = 'none' as Plan, tP = Infinity, nextStart = 0;
  const schedule = (s: number) => {
    plan = decide();
    if (plan === 'melee') {
      const w = swingTimes(s, mel.speed, swingFrames(mel.kind < 0 ? 3 : mel.kind, swingKindOf(cell()), P.lefty));
      tP = w.strike; nextStart = w.next;
    } else if (plan === 'launcher') { const w = shotTimes(s, S.aimTicks); tP = w.fire; nextStart = w.next; }
    else if (plan === 'spell') { tP = s + Math.max(1, S.aimTicks); nextStart = -1; }
    else tP = Infinity;
  };
  schedule(0);

  // damage_critter records the attacker; a creature with bA_1 never reacts to it (AI.C critter_mv)
  const wakeMonster = () => { if (!M.ignoresFights) { active = true; lastHit = true; } };
  const hurtMonster = (d: number, parts: number[] | null, part: number) => {
    // parts: shares of d by DEALT_PARTS (melee); otherwise all to `part`
    const lost = Math.min(d, mhp);
    st.overkill += d - lost;
    if (lost > 0) {
      if (parts) { const tot = parts.reduce((a, b) => a + b, 0) || 1; for (let i = 0; i < parts.length; i++) st.dealt[i] += (lost * parts[i]) / tot; }
      else st.dealt[part] += lost;
    }
    dealt += lost;
    dmgTaken = Math.min(255, dmgTaken + d);
    if (mhp <= d) { mhp = 0; return true; }
    mhp -= d;
    return false;
  };
  const hurtPlayer = (d: number, src: number, zone: number): boolean => {
    const lost = Math.min(d, php);
    st.srcDamage[src] += lost;
    if (zone >= 0) st.zoneDamage[zone] += lost;
    if (php <= d && d > 0) { php = 0; return true; }
    php -= d;
    return false;
  };
  /** damage_item on the monster with no armour step (spells, damage_square): check_res then damage_critter. */
  const spellHit = (dd: number, type: number, part: number): boolean => {
    dd &= 0xff;
    const after = checkRes(M.resist, dd, type, rng);
    st.resistedMon += dd - after;
    wakeMonster();
    return hurtMonster(after, null, part);
  };

  // A missile (launcher ammo or a missile spell) striking the monster: missile_thwack.
  const thwackMonster = (damage: number, type: number, part: number): boolean => {
    const mid = M.height >> 1;
    const hitloc = pickloc(0, M.height, mid, mid, rng) + 4;
    let dd = rollDamage(damage, rng);          // power 0x80, hitangle 0
    const arm = creatureArmourAt(M.armour, hitloc, M.powerful);
    st.absorbedMon += Math.min(arm, dd);
    dd = arm > dd ? 0 : dd - arm;
    return spellHit(dd, type, part);
  };
  /** The player's area spell (gronk_area -> process_area), the monster D squares ahead on open floor. */
  const areaOnMonster = (kind: AreaKind, casting: number): boolean => {
    const a = AREA_SPELLS[kind];
    const idx = areaSquareIndex(kind, D);
    const side = 2 * a.radius + 2, squares = side * side;
    if (kind === 'sheet') {
      // 0x40: random open squares, chance count in w*h+3 each, up to five passes; each strike is damage_square kind 2
      let count = a.count, tries = 0, hits = 0;
      const den = (2 * a.radius + 1) * (2 * a.radius + 1) + 3;
      do {
        for (let i = 0; i < squares; i++) {
          if (rng.int(den) < count) {
            if (i === idx) hits++;
            if (--count === 0) break;
          }
        }
      } while (count > 0 && tries++ < 4);
      if (hits) wakeMonster();
      for (let h = 0; h < hits; h++) if (spellHit(rng.rollem(6, 5), 0x03, 6)) return true;
      return false;
    }
    if (idx < 0) return false;
    if (kind === 'flame') {
      // 0x80: every open square once (sp_meteor hits an empty square one time in three, never the same
      // square twice running, and at most five critters); count 10 can run out before the monster's square
      let count = a.count;
      for (let i = 0; i < idx; i++) if (rng.int(3) === 0 && --count === 0) return false;
      // the square's own call (1 in 3), else the critter's call: one damage_square kind 1 either way
      rng.int(3);
      return spellHit(rng.rollem(10, 6), 0x0b, 6);
    }
    if (kind === 'frost') return spellHit(10, 0x23, 6);
    if (kind === 'shockwave') return spellHit(Math.trunc(casting / 2) + 15, 0x03, 6);
    // repel: the undead take 255 (liches, race 0x17, half their HP) of type 3
    if (!isUndead(M.resist)) return false;
    return spellHit(M.race === 0x17 ? mhp >> 1 : 0xff, 0x03, 6);
  };

  const playerMelee = (): boolean => {
    const c = cell();
    const kind = swingKindOf(c);
    const i0 = mel.base[kind] + mel.strBonus + mel.ench;
    let damage = i0;
    const probe = meleeProbe(0, PLAYER_HEIGHT, c, mel.wsize);
    const hitloc = pickloc(0, M.height, probe.z, probe.top, rng);
    const h = S.hitangle;
    const g = skillCheck(mel.askill + h, M.defence, rng);
    st.pSwings++;
    let poisonExtra = 0;
    if (mel.poison && M.blood) { const d2 = poisonBonus(damage, P.casting); poisonExtra = d2 - damage; damage = d2; }
    let critExtra = 0, crit = false;
    if (g === 2) { const mult = critMultiplier(rng); critExtra = damage * (mult - 1); damage *= mult; st.pCrits++; crit = true; }
    if (g <= 0) {
      st.pMisses++;
      wakeMonster(); // damage_item(..., 0) still records the attacker
      if (g === -1 && !M.passive) {
        st.pBadMisses++;
        if (!mel.isFist && mel.qualclass < 3) {
          const w = rng.rollem(2, 3) >> mel.qualclass;
          st.weaponWearEvents++;
          st.weaponQualityLost += Math.min(w, quality);
          quality -= w;
          const ws = weaponSlot(P0.character), e = own().equipment[ws];
          if (quality <= 0) { st.weaponBroken++; delete own().equipment[ws]; refit(); }
          else if (e) e.quality = quality;
        }
      }
      return false;
    }
    st.pHits++;
    const roll = rollDamage(damage, rng);
    const scaled = (roll * mel.maxCharge) >> 7;
    let dd = scaled + h;
    const arm = creatureArmourAt(M.armour, hitloc, M.powerful);
    st.absorbedMon += Math.min(arm, dd);
    dd = arm > dd ? 0 : dd - arm;
    dd &= 0xff;
    const ddone = dd;
    const after = checkRes(M.resist, dd, DMG_PHYSICAL, rng);
    st.resistedMon += dd - after;
    const f = damage > 0 ? scaled / damage : 0;
    const parts = [mel.base[kind] * f, mel.strBonus * f, mel.ench * f, critExtra * f, h, 0, 0, poisonExtra * f];
    wakeMonster();
    if (hurtMonster(after, parts, 0)) return true;
    // a special weapon's power after a hit: on a critical, or every hit for specweap 6 (player_attack)
    if (mel.specweap > 0 && (crit || mel.specweap === 6)) {
      st.specialTriggers++;
      switch (mel.specweap) {
        case 1: { const before = php; php = Math.min(P.hpMax, php + ddone); st.specialHealed += php - before; break; }
        case 2: if (isUndead(M.resist)) return spellHit(M.race === 0x17 ? mhp >> 1 : 0xff, 0x03, 8); break;
        case 3: return spellHit(rng.rollem(10, 6), 0x0b, 8); // damage_square(tx, ty, 1) on the monster's square
        case 4: // sp_hold: not undead, and not shrugged off (check_res type 3)
          if (!isUndead(M.resist) && checkRes(M.resist, 1, 0x03, rng)) {
            const time = (rng.int(16)) * Math.trunc(P.casting / 3) + 0x10;
            heldUntil = Math.max(heldUntil, tNow + time); seq = 0; frame = 0; castSlot = 0; st.specialHeldTicks += time;
          }
          break;
      }
    }
    return false;
  };
  const playerShot = (): boolean => {
    st.pShots++;
    if (rng.next() >= S.rangedHitChance) return false;
    st.pShotHits++;
    const L = P.launcher!;
    let d = L.damage;
    let scale = (P.missileSkill << 3) + 0xc0;
    const g = skillCheck(P.missileSkill, 10, rng);
    if (g === -1) scale -= 0x80; else if (g === 2) scale += 0xc0;
    d = (d * scale) >> 8;
    return thwackMonster(d, L.type, 5);
  };
  /** One cast attempt (player_cast); returns [monster died, ticks until the next attempt]. */
  const playerCast = (): [boolean, number] => {
    const sp = P.attackSpell!;
    const g = skillCheck(P.casting, sp.circle * 3, rng);
    const aim = Math.max(1, S.aimTicks);
    if (g === 0) { st.fizzles++; return [false, aim]; }
    const wait = Math.max(aim, sp.delayTicks);
    if (g === -1) {
      mana -= sp.cost; st.manaSpent += sp.cost;
      st.backfires++;
      const dmg = rng.rollem(sp.circle >> 1, 8);
      if (php > 3) { const before = php; php = php - dmg <= 3 ? 3 : php - dmg; st.selfDamage += before - php; }
      return [false, wait];
    }
    st.casts++;
    if (sp.missile) {
      mana -= sp.cost; st.manaSpent += sp.cost; // paid when the missile is launched
      st.pShots++;
      if (rng.next() >= S.rangedHitChance) return [false, wait];
      st.pShotHits++;
      return [thwackMonster(sp.missile.damage, sp.missile.type, 6), wait];
    }
    if (sp.area) {
      mana -= sp.cost; st.manaSpent += sp.cost;
      return [areaOnMonster(sp.area, P.casting), wait];
    }
    // class 7: the mana is paid only when the handler reports success
    let ok = false, died = false;
    if (sp.target === 'bleed' && M.blood) { ok = true; died = spellHit(Math.trunc(P.casting / 2) + 10, DMG_PHYSICAL, 6); }
    else if (sp.target === 'smite' && M.blood) { ok = true; died = spellHit(P.casting * 3 + 110, DMG_PHYSICAL, 6); }
    else if (sp.target === 'smiteUndead' && isUndead(M.resist)) { ok = true; died = spellHit(M.race === 0x17 ? mhp >> 1 : 0xff, 0x03, 6); }
    if (ok) { mana -= sp.cost; st.manaSpent += sp.cost; } else st.targetRefused++;
    return [died, wait];
  };

  // ---- the monster's blows on the player
  const monsterMelee = (slot: number): boolean => {
    const a = M.attacks[slot];
    let askill = a.chance + (M.equip >> 1);
    let damage = a.damage + Math.trunc(M.str / 5);
    if (M.powerful) { askill += rng.int(6) + 7; damage += rng.int(12) + 4; }
    const swing = rng.int(9);
    const probe = meleeProbe(0, M.height, swing, 2);
    const hitloc = pickloc(0, PLAYER_HEIGHT, probe.z, probe.top, rng);
    const mod = P.cmbModTH[hitloc];
    const roll = rng.int(31);
    const g = gradeOfRoll(askill - mod, P.defence, roll);
    st.srcAttempts[slot]++;
    if (g === 2) {
      damage *= critMultiplier(rng);
      st.srcCrits[slot]++;
      wearArmour(hitloc);
    }
    if (g <= 0) {
      st.zoneMisses[hitloc]++;
      if (mod && gradeOfRoll(askill, P.defence, roll) > 0) st.zoneProtMisses[hitloc]++;
      return false;
    }
    st.srcHits[slot]++;
    st.zoneHits[hitloc]++;
    let dd = (rollDamage(damage, rng) * ATK_CHARGE[k]) >> 7;
    return armourAndApply(dd, hitloc % 4, DMG_PHYSICAL, slot);
  };
  /** A critical on the player wears the item in the slot for the location (frp_check):
      locations 0 and 1 the shield hand, 2 the legs (one time in five the boots), 3 the head;
      DamageInventory(slot, 2d4, physical, worn only) -> damage_object, shifted by qualclass. */
  const wearArmour = (hitloc: number) => {
    let slot = (hitloc + 1) & 3;
    if (slot === 3) slot += rng.int(5) === 0 ? 1 : 0;
    else if (slot !== 0 && slot <= 2) slot = shieldSlot(P0.character);
    const dmg = rng.rollem(2, 4);
    const c = ch ?? P0.character;
    const e = c.equipment[slot];
    if (!e || !objWorn(c, e.itemId, slot)) return;
    const it = items[e.itemId];
    let d = checkRes(it.resist, dmg, DMG_PHYSICAL, rng);
    if (it.qualclass === 3) return;
    d >>= it.qualclass;
    st.armourWearEvents++;
    const mine = own().equipment[slot];
    st.armourQualityLost += Math.min(d, mine.quality);
    mine.quality -= d;
    if (mine.quality <= 0) { st.armourBroken++; delete own().equipment[slot]; refit(); }
  };
  const armourAndApply = (dd: number, zone: number, type: number, src: number): boolean => {
    const arm = P.armour[zone];
    const absorbed = Math.min(arm, dd);
    if (arm > 0 && absorbed > 0) {
      const pp = P.armourParts[zone];
      st.zoneAbsorbed[zone][0] += (absorbed * pp.items) / arm;
      st.zoneAbsorbed[zone][1] += (absorbed * pp.spell) / arm;
      st.zoneAbsorbed[zone][2] += (absorbed * pp.toughness) / arm;
    }
    dd = arm > dd ? 0 : dd - arm;
    if (P.easy) { st.easyHalved += dd - (dd >> 1); dd >>= 1; }
    dd &= 0xff;
    const after = checkRes(P.resist, dd, type, rng);
    st.resistedPlayer += dd - after;
    return hurtPlayer(after, src, zone);
  };
  const monsterMissile = (damage: number, type: number, src: number): boolean => {
    st.srcAttempts[src]++;
    const hitloc = pickloc(0, PLAYER_HEIGHT, PLAYER_HEIGHT >> 1, PLAYER_HEIGHT >> 1, rng) + 4;
    st.srcHits[src]++;
    st.zoneHits[hitloc % 4]++;
    return armourAndApply(rollDamage(damage, rng), hitloc % 4, type, src);
  };
  /** The monster's area spell on the player, D squares ahead of it (the same geometry, mirrored). */
  const monsterArea = (kind: AreaKind): boolean => {
    st.srcAttempts[5]++;
    const a = AREA_SPELLS[kind];
    const idx = areaSquareIndex(kind, D);
    const onPlayer = (dd: number, type: number) => {
      dd &= 0xff;
      const after = checkRes(P.resist, dd, type, rng);
      st.resistedPlayer += dd - after;
      return hurtPlayer(after, 5, -1);
    };
    if (kind === 'sheet') {
      const side = 2 * a.radius + 2, squares = side * side, den = (2 * a.radius + 1) ** 2 + 3;
      let count = a.count, tries = 0, hits = 0;
      do {
        for (let i = 0; i < squares; i++) if (rng.int(den) < count) { if (i === idx) hits++; if (--count === 0) break; }
      } while (count > 0 && tries++ < 4);
      if (hits) st.srcHits[5]++;
      for (let h = 0; h < hits; h++) if (onPlayer(rng.rollem(6, 5), 0x03)) return true;
      return false;
    }
    if (idx < 0) return false;
    if (kind === 'flame') {
      let count = a.count;
      for (let i = 0; i < idx; i++) if (rng.int(3) === 0 && --count === 0) return false;
      rng.int(3);
      st.srcHits[5]++;
      return onPlayer(rng.rollem(10, 6), 0x0b);
    }
    st.srcHits[5]++;
    if (kind === 'frost') return onPlayer(10, 0x23);
    if (kind === 'shockwave') return onPlayer(Math.trunc(P.casting / 2) + 15, 0x03); // sp_shockwave reads the player's Casting
    return false;
  };

  // ---- one monster AI step (AI.C critter_ai -> critter_mv -> crit_offense)
  const monsterStep = (): number => { // 0 nothing, 1 player died, 2 fled
    if (!active) return 0;
    if (tNow < heldUntil) return 0;      // held (goal 15): no move, no attack
    if (seq !== 0) {
      // this step finds `frame`: the blow on frame 3, the sequence over on frame seq_len - 1
      let died = false;
      if (frame === 3) {
        if (seq <= 3) died = monsterMelee(seq - 1);
        else if (seq === 5) died = monsterMissile(M.missile!.damage, M.missile!.type, 3);
        else {
          const sp = M.spells[castSlot - 1];
          if (sp.kind === 'missile') died = monsterMissile(sp.damage, sp.type, 4);
          else if (sp.kind === 'area') died = monsterArea(sp.area);
          else st.defensiveCasts++;
        }
      }
      const len = M.seqLen[seq <= 3 ? seq + 2 : 6];
      if (frame >= len - 1) { seq = 0; frame = 0; k = 0; castSlot = 0; }
      else frame++;
      return died ? 1 : 0;
    }
    if (lastHit) {
      lastHit = false;
      if (ranged && D2 > 2 && !M.offensive) bound = true; // bound to fight
      if (!bound && shouldIFlee(M.avghit, mhp, M.nerve, dmgTaken, rng)) return 2;
      dmgTaken = 0;
    }
    if (!ranged) {
      if (rng.int(4) === 0) {
        let r = rng.int(100), i = 0;
        while (M.attacks[i].prob <= r && i < 2) { r -= M.attacks[i].prob; i++; }
        seq = i + 1; frame = 0;
      } else if (k < 15) k++;
    } else if (M.caster > 0) {
      if (rawSpells[2] !== 0xff && rng.int(256) < M.caster) { seq = 13; castSlot = 3; frame = 0; }
      else if (M.offensive && D2 < 0x40) {
        if (rng.int(128) < M.caster) { seq = 13; castSlot = rng.int(16) < 11 ? 1 : 2; frame = 0; }
      }
    } else if (M.missile && D2 < 0x10) {
      if (rng.int(192) <= M.dex) { seq = 5; frame = 0; }
    }
    return 0;
  };

  let t = 0;
  while (outcome < 0) {
    t = Math.min(tP, tM, tRegen);
    if (t > T) { t = T; outcome = 3; break; }
    tNow = t;
    if (t === tRegen) {
      const g = skillCheck(P.manaSkill, 10, rng);
      if (g > 0) mana = Math.min(P.manaMax, mana + g);
      tRegen += 960;
      if (plan === 'none') schedule(t);
      continue;
    }
    if (tP <= tM) {
      let died = false;
      if (plan === 'melee') { died = playerMelee(); schedule(nextStart); }
      else if (plan === 'launcher') { died = playerShot(); schedule(nextStart); }
      else if (plan === 'spell') { const [d, wait] = playerCast(); died = d; schedule(t + wait - Math.max(1, S.aimTicks)); }
      if (died) { outcome = 0; break; }
      if (php <= 0) { outcome = 1; break; }
    } else {
      const r = monsterStep();
      tM += interval;
      if (r === 1) { outcome = 1; break; }
      if (r === 2) { outcome = 2; break; }
    }
  }

  // ---- record
  const secs = t / 16;
  st.n++;
  st.outcomes[outcome]++;
  const bin = Math.min(st.durHist[outcome].length - 1, Math.floor(secs / DUR_BIN));
  st.durHist[outcome][bin]++;
  st.durSum[outcome] += secs;
  if (outcome === 0) {
    st.hpLeftHist[Math.min(st.hpLeftHist.length - 1, php)]++;
    st.ttkSum += secs;
    const x = killXp(M, P0, rng);
    st.xp += x.awarded; st.xpNominal += x.nominal;
    if (x.wrapped) st.xpWrapped++;
    if (x.awarded < 0) st.xpNegative++;
    if (x.halved) st.xpHalved++;
  } else st.monHpLeftHist[Math.min(st.monHpLeftHist.length - 1, mhp)]++;
  st.dealtPerFight += dealt; st.dealtPerFightSq += dealt * dealt;
  st.dps += secs > 0 ? dealt / secs : 0;
  st.manaLeft += mana;
  void mhp0;
}
