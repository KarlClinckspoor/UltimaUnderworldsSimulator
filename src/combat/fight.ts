// The fight loop: one player against one monster, nobody moving (plan B2), in 1/16 s ticks.
// Timings: the monster's AI step every 4 ticks (rate 4 at 16 frames a second, AI.C
// move_mobile / timetodo; 8 ticks under Speed, never under Freeze Time); the player's swing
// follows PANELS.C adjust_weapon (one weapon frame per 32 clock units = 2 ticks) and
// COMBAT.C player_attack (charge +speed per 16 units from frame 3, strike at frame 6).

import type { Rng } from '../core/rng';
import { gradeOfRoll, skillCheck } from '../core/skillcheck';
import {
  ATK_CHARGE, checkRes, creatureArmourAt, critMultiplier, DMG_PHYSICAL, meleeProbe, pickloc, rollDamage, shouldIFlee,
} from './blow';
import {
  chooseSwing, PLAYER_HEIGHT, swingKindOf, type FightSettings, type MeleeProfile, type MonsterProfile, type PlayerProfile,
} from './setup';
import { DUR_BIN, emptyStats, type Stats } from './stats';
import { creatures, items } from '../data/gameData';
import { objWorn, shieldSlot, weaponSlot, type Character } from '../core/character';
import { playerProfile } from './setup';

export type HpMode = { kind: 'stored' } | { kind: 'roll' } | { kind: 'set'; value: number };

const nextBoundary = (t: number) => t + (t % 2 === 0 ? 2 : 1);

/** Strike time and next possible start of a full-charge melee swing begun at tick s. */
export function swingTimes(s: number, speed: number) {
  const b1 = nextBoundary(s);              // weap_frame 0
  const b4 = b1 + 6;                       // weap_frame 3: the hold, charging starts
  const k = Math.ceil(100 / Math.max(1, speed));
  const release = b4 + k + 1;              // play_pow reaches 100 (first 16 units only set otime)
  const c1 = nextBoundary(release);        // frame 4
  const strike = c1 + 4;                   // frame 6: the blow
  return { strike, next: c1 + 11 };        // frame 9 at c1 + 10, ready at the next frame
}
/** Fire time and next start of a launcher shot (frames 0..3, aim, then back to ready). */
export function shotTimes(s: number, aim: number) {
  const b4 = nextBoundary(s) + 6;
  const fire = b4 + aim;
  // missile_finish sets the goal to ready; the next adjust_weapon takes the `swung` branch
  // straight to weap_frame -1 (PANELS.C:815), and a new shot can start the frame after
  return { fire, next: nextBoundary(fire) + 1 };
}

/** process_area (SPELLS.C) in AREA_RANDOM mode on open floor, the target `dist` squares
    straight ahead of the caster: how many times its square is struck. */
export function areaHits(rng: Rng, dist: number, flame: boolean): number {
  let count = rng.rollem(3, 4);
  let hits = 0, tries = 0;
  do {
    for (let x = 2; x <= 7; x++)
      for (let y = -2; y <= 3; y++) {
        if (rng.int(5 * 5 + 3) < count) {
          if (flame ? Math.abs(x - dist) + Math.abs(y) <= 1 : x === dist && y === 0) hits++;
          if (--count === 0) return hits;
        }
      }
  } while (count > 0 && tries++ < 4);
  return hits;
}

/** Experience for a kill by the player (COMBAT.C player_killed_a -> SKILLCHK.C player_get_exp).
    Only a kill pays: damage_critter calls player_killed_a when the critter dies and the player
    struck it (directly, or with his missile or spell). exp * 4 + 2d(exp); a powerful critter
    times (24..47)/16, computed in a 16-bit int in DOS UW1, which wraps (and can turn negative)
    when the product passes 32767. player_get_exp then takes a negative amount away (floor 0),
    ignores gains once experience is above 0x17700, and halves gains (+1) when the character's
    level is above twice the dungeon level plus two. Units: tenths of the displayed XP. */
export function killXp(M: MonsterProfile, P: { level: number; expRaw: number }, rng: Rng) {
  let exp = M.exp * 4 + rng.rollem(2, M.exp);
  let nominal = exp, wrapped = false, halved = false;
  if (M.powerful) {
    const prod = exp * (rng.int(24) + 24);
    nominal = Math.trunc(prod / 16);
    wrapped = prod > 32767;
    exp = Math.trunc((((prod & 0xffff) ^ 0x8000) - 0x8000) / 16); // (int16) cast, then C division
  }
  let awarded = exp;
  if (exp < 0) awarded = -Math.min(-exp, P.expRaw);
  else if (P.expRaw > 0x17700) awarded = 0;
  else if (M.dungeonLevel * 2 + 2 < P.level) { awarded = Math.trunc(exp / 2) + 1; halved = true; }
  return { awarded, nominal, wrapped, halved };
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

export function fight(st: Stats, P0: PlayerProfile, M: MonsterProfile, S: FightSettings, hpMode: HpMode, rng: Rng) {
  const T = Math.round(S.timeLimit * 16);
  const ranged = S.mode === 'ranged';
  const D = Math.max(1, Math.round(S.distance));
  const D2 = D * D;
  const rawSpells = creatures[M.creature].spells;
  let P = P0;
  let ch: Character | null = null; // a copy of the character, made when an item first wears
  const own = () => (ch ??= structuredClone(P0.character));
  /** An item broke: FixPlayerEquips recomputes armour, defence, protection and the weapon (INVDATA.C:443). */
  const refit = () => {
    const np = playerProfile(own(), P0.attackSpellIndex);
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
  let seq = 0, frame = 0, k = 0, castSlot = 0;
  const interval = P.timeStop ? Infinity : P.hasted ? 8 : 4;
  let tM = P.timeStop ? Infinity : rng.int(4);
  let tRegen = 1008; // mana: skill_check(Mana, 10) every third 21 s duration check

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
    if (plan === 'melee') { const w = swingTimes(s, mel.speed); tP = w.strike; nextStart = w.next; }
    else if (plan === 'launcher') { const w = shotTimes(s, S.aimTicks); tP = w.fire; nextStart = w.next; }
    else if (plan === 'spell') { tP = s + Math.max(1, S.aimTicks); nextStart = -1; }
    else tP = Infinity;
  };
  schedule(0);

  // damage_critter records the attacker; a creature with bA_1 never reacts to it (AI.C:1225)
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

  // A missile (launcher ammo or a missile spell) striking the monster: missile_thwack.
  const thwackMonster = (damage: number, type: number, part: number): boolean => {
    const mid = M.height >> 1;
    const hitloc = pickloc(0, M.height, mid, mid, rng) + 4;
    let dd = rollDamage(damage, rng);          // power 0x80, hitangle 0
    const arm = creatureArmourAt(M.armour, hitloc, M.powerful);
    st.absorbedMon += Math.min(arm, dd);
    dd = arm > dd ? 0 : dd - arm;
    dd &= 0xff;
    const after = checkRes(M.resist, dd, type, rng);
    st.resistedMon += dd - after;
    wakeMonster();
    return hurtMonster(after, null, part);
  };
  const areaOnMonster = (kind: 1 | 2): boolean => {
    const hits = areaHits(rng, D, kind === 1);
    if (hits) wakeMonster(); // only squares actually struck call damage_item
    for (let h = 0; h < hits; h++) {
      const dd = kind === 1 ? rng.rollem(10, 6) : rng.rollem(6, 5);
      const after = checkRes(M.resist, dd, kind === 1 ? 0x0b : 0x03, rng);
      st.resistedMon += dd - after;
      if (hurtMonster(after, null, 6)) return true;
    }
    return false;
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
    let critExtra = 0;
    if (g === 2) { const mult = critMultiplier(rng); critExtra = damage * (mult - 1); damage *= mult; st.pCrits++; }
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
    const after = checkRes(M.resist, dd, DMG_PHYSICAL, rng);
    st.resistedMon += dd - after;
    const f = damage > 0 ? scaled / damage : 0;
    const parts = [mel.base[kind] * f, mel.strBonus * f, mel.ench * f, critExtra * f, h, 0, 0];
    wakeMonster();
    return hurtMonster(after, parts, 0);
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
  /** One cast attempt; returns [monster died, ticks until the next attempt]. */
  const playerCast = (): [boolean, number] => {
    const sp = P.attackSpell!;
    const g = skillCheck(P.casting + 5, sp.circle * 2, rng);
    const aim = Math.max(1, S.aimTicks);
    if (g === 0) { st.fizzles++; return [false, aim]; }
    mana -= sp.cost; st.manaSpent += sp.cost;
    const wait = Math.max(aim, sp.delayTicks);
    if (g === -1) {
      st.backfires++;
      const dmg = rng.rollem(sp.circle >> 1, 8);
      if (php > 3) { const before = php; php = php - dmg <= 3 ? 3 : php - dmg; st.selfDamage += before - php; }
      return [false, wait];
    }
    st.casts++;
    if (sp.missile) {
      st.pShots++;
      if (rng.next() >= S.rangedHitChance) return [false, wait];
      st.pShotHits++;
      return [thwackMonster(sp.missile.damage, sp.missile.type, 6), wait];
    }
    return [areaOnMonster(sp.area!), wait];
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
  /** A critical on the player wears the item in the slot for the location (COMBAT.C:308-312):
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
  const monsterArea = (kind: 1 | 2): boolean => {
    st.srcAttempts[5]++;
    const hits = areaHits(rng, D, kind === 1);
    if (hits) st.srcHits[5]++;
    for (let h = 0; h < hits; h++) {
      const dd = kind === 1 ? rng.rollem(10, 6) : rng.rollem(6, 5);
      const after = checkRes(P.resist, dd, kind === 1 ? 0x0b : 0x03, rng);
      st.resistedPlayer += dd - after;
      if (hurtPlayer(after, 5, -1)) return true;
    }
    return false;
  };

  // ---- one monster AI step (AI.C critter_ai -> critter_mv -> crit_offense)
  const monsterStep = (): number => { // 0 nothing, 1 player died, 2 fled
    if (!active) return 0;
    if (seq !== 0) {
      if (frame !== 4) { frame++; return 0; }
      let died = false;
      if (seq <= 3) { died = monsterMelee(seq - 1); k = 0; }
      else if (seq === 5) died = monsterMissile(M.missile!.damage, M.missile!.type, 3);
      else {
        const sp = M.spells[castSlot - 1];
        if (sp.kind === 'missile') died = monsterMissile(sp.damage, sp.type, 4);
        else if (sp.kind === 'area') died = monsterArea(sp.area);
        else st.defensiveCasts++;
      }
      seq = 0; frame = 0; castSlot = 0;
      return died ? 1 : 0;
    }
    if (lastHit) {
      lastHit = false;
      if (ranged && D2 > 2 && !M.offensive) bound = true; // b19 bit 5: bound to fight
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
    if (t === tRegen) {
      const g = skillCheck(P.manaSkill, 10, rng);
      if (g > 0) mana = Math.min(P.manaMax, mana + g);
      tRegen += 1008;
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
