// Exact distributions of one blow (plan B5): hit location, to-hit grade, critical
// multiplier, damage dice, power scaling, armour, easy mode and resistance are independent
// steps, so the damage of one blow is an exact mixture of convolutions.

import { gradeProbs } from '../core/skillcheck';
import { modProbs } from '../core/randdist';
import { ATK_CHARGE, checkResPass, creatureArmourAt, damageRollDist, DMG_PHYSICAL, meleeProbe, picklocDist } from './blow';
import { chooseSwing, PLAYER_HEIGHT, poisonBonus, swingKindOf, type FightSettings, type MonsterProfile, type PlayerProfile } from './setup';

export interface BlowDist {
  pMiss: number;      // grade 0 or -1
  pCrit: number;      // grade 2
  dist: number[];     // P(damage = v) over all swings (misses count as 0)
  mean: number;
  zones: number[];    // hit location probabilities 0..3
}

function addScaled(out: number[], dist: number[], w: number, map: (v: number) => number) {
  for (let v = 0; v < dist.length; v++) {
    if (!dist[v]) continue;
    const d = map(v);
    while (out.length <= d) out.push(0);
    out[d] += dist[v] * w;
  }
}

function finish(out: number[], pMiss: number, pCrit: number, zones: number[]): BlowDist {
  const mean = out.reduce((s, p, v) => s + p * v, 0);
  return { pMiss, pCrit, dist: out, mean, zones };
}

/** The player's melee blow on the monster (DoPlayerWeapon + do_attack + do_damage), a special weapon's
    extra power left aside. */
export function playerBlowDist(P: PlayerProfile, M: MonsterProfile, S: FightSettings): BlowDist {
  const m = P.melee;
  const cell = chooseSwing(m, S.swing);
  let base = m.base[swingKindOf(cell)] + m.strBonus + m.ench;
  if (m.poison && M.blood) base = poisonBonus(base, P.casting); // frp_check, before the critical
  const probe = meleeProbe(0, PLAYER_HEIGHT, cell, m.wsize);
  const zones = picklocDist(0, M.height, probe.z, probe.top);
  const gc = gradeProbs(m.askill + S.hitangle, M.defence);
  const pMiss = gc[0] + gc[1], pHit = gc[2], pCrit = gc[3];
  const pass = checkResPass(M.resist, DMG_PHYSICAL);
  const out = [pMiss + (pHit + pCrit) * (1 - pass)];
  for (let z = 0; z < 4; z++) {
    if (!zones[z]) continue;
    const arm = creatureArmourAt(M.armour, z, M.powerful);
    const map = (v: number) => Math.max(0, ((v * m.maxCharge) >> 7) + S.hitangle - arm) & 0xff;
    addScaled(out, damageRollDist(base), zones[z] * pHit * pass, map);
    addScaled(out, damageRollDist(base), zones[z] * pCrit * pass * 0.5, map);
    addScaled(out, damageRollDist(base * 2), zones[z] * pCrit * pass * 0.5, map);
  }
  return finish(out, pMiss, pCrit, zones);
}

/** A monster's melee blow on the player from attack slot `slot` at attack frame k
    (critter_attack). Powerful monsters' extra to-hit and damage are uniform ranges. */
export function monsterBlowDist(M: MonsterProfile, slot: number, P: PlayerProfile, k: number): BlowDist {
  const a = M.attacks[slot];
  const power = ATK_CHARGE[Math.max(0, Math.min(15, k))];
  // powerful: askill += rand() % 6 + 7, damage += rand() % 12 + 4; the swing is rand() % 9
  const extrasHit = M.powerful ? modProbs(6).map((p, i) => [i + 7, p]) : [[0, 1]];
  const extrasDmg = M.powerful ? modProbs(12).map((p, i) => [i + 4, p]) : [[0, 1]];
  const swingP = modProbs(9);
  const zones = [0, 0, 0, 0];
  const out = [0];
  let pMiss = 0, pCrit = 0;
  const pass = checkResPass(P.resist, DMG_PHYSICAL);
  for (let swing = 0; swing < 9; swing++) {
    const wsw = swingP[swing];
    const probe = meleeProbe(0, M.height, swing, 2);
    const zd = picklocDist(0, PLAYER_HEIGHT, probe.z, probe.top);
    for (let z = 0; z < 4; z++) {
      if (!zd[z]) continue;
      zones[z] += zd[z] * wsw;
      for (const [eh, wh] of extrasHit) {
        const askill = a.chance + (M.equip >> 1) + eh - P.cmbModTH[z];
        const gc = gradeProbs(askill, P.defence);
        const w = wsw * zd[z] * wh;
        pMiss += w * (gc[0] + gc[1]); pCrit += w * gc[3];
        out[0] += w * ((gc[0] + gc[1]) + (gc[2] + gc[3]) * (1 - pass));
        for (const [ed, wd] of extrasDmg) {
          const dmg = a.damage + Math.trunc(M.str / 5) + ed;
          const arm = P.armour[z];
          const map = (v: number) => {
            let d = Math.max(0, ((v * power) >> 7) - arm);
            if (P.easy) d >>= 1;
            return d & 0xff;
          };
          const ww = w * wd * pass;
          addScaled(out, damageRollDist(dmg), ww * gc[2], map);
          addScaled(out, damageRollDist(dmg), ww * gc[3] * 0.5, map);
          addScaled(out, damageRollDist(dmg * 2), ww * gc[3] * 0.5, map);
        }
      }
    }
  }
  return finish(out, pMiss, pCrit, zones);
}

/** Distribution of the attack frame counter k when a monster starts an attack: each step
    starts one with chance 1/4 (rand() % 4 == 0, exactly 1/4 for both models), else k rises by 1 up
    to 15 (crit_attack). */
export function attackFrameDist(): number[] {
  const p = new Array(16).fill(0);
  for (let k = 0; k < 15; k++) p[k] = Math.pow(0.75, k) * 0.25;
  p[15] = Math.pow(0.75, 15);
  return p;
}

/** Expected monster melee damage per blow, averaged over slots and the attack frame. */
export function monsterExpectedBlow(M: MonsterProfile, P: PlayerProfile) {
  const fk = attackFrameDist();
  let mean = 0, pHit = 0;
  const probs = M.attacks.map((a) => a.prob);
  // slot choice: r = rand() % 100, walking the prob table with i capped at 2
  const slotP = [0, 0, 0];
  const p100 = modProbs(100);
  for (let r0 = 0; r0 < 100; r0++) { let r = r0, i = 0; while (probs[i] <= r && i < 2) { r -= probs[i]; i++; } slotP[i] += p100[r0]; }
  for (let s = 0; s < 3; s++) {
    if (!slotP[s]) continue;
    for (let k = 0; k < 16; k++) {
      if (fk[k] < 1e-6) continue;
      const b = monsterBlowDist(M, s, P, k);
      mean += slotP[s] * fk[k] * b.mean;
      pHit += slotP[s] * fk[k] * (1 - b.pMiss);
    }
  }
  return { mean, pHit, slotP };
}
