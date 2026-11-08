// One monster as an actor: its AI step (AI.C critter_ai -> critter_mv -> crit_offense) and the blows it
// strikes, against a Defender that is either the player (fight.ts) or another critter (duel.ts, plan C).
// The draws are made in the game's order; what differs between the two defenders (cmbModTH, armour wear,
// easy mode, poison, the player's or the critter's armour) is behind the Defender interface, as COMBAT.C
// tests `hitobj == 1` / `defender == 1` at exactly those points.

import type { Rng } from '../core/rng';
import { gradeOfRoll } from '../core/skillcheck';
import { ATK_CHARGE, critMultiplier, DMG_PHYSICAL, meleeProbe, pickloc, rollDamage, shouldIFlee } from './blow';
import type { MonsterProfile } from './setup';
import { SRC } from './stats';
import { creatures } from '../data/gameData';

/** damage_square (SPELLS.C:861) on one object: kind 1 is 10d6 of type 0x0B (magic and fire),
    kind 2 6d5 of type 3 (magic), straight to damage_item (no armour, no easy-mode halving). */
export function squareDamage(rng: Rng, kind: 1 | 2): [number, number] {
  return kind === 1 ? [rng.rollem(10, 6), 0x0b] : [rng.rollem(6, 5), 0x03];
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

/** The counters a monster's attacks feed (a subset of Stats, so a Stats object serves). */
export interface MonsterSink {
  srcAttempts: number[]; srcHits: number[]; srcCrits: number[];
  zoneHits: number[]; zoneMisses: number[]; zoneProtMisses: number[];
  defensiveCasts: number;
}

/** What a monster's blow meets. */
export interface Defender {
  height: number;
  defence: number;
  /** cmbModTH[hitloc] when the player is hit (frp_check), 0 for a critter. */
  protect(hitloc: number): number;
  /** A critical: the player's armour at the location wears (frp_check `defender == 1`); nothing for a critter. */
  onCritical(hitloc: number): void;
  /** A miss: do_attack still calls damage_item with 0, so a critter notes its attacker. */
  onMiss(): void;
  /** do_damage from the armour step on: armour at the zone, easy mode, check_res, damage. Returns death. */
  blow(dd: number, zone: number, type: number, src: number): boolean;
  /** damage_item with no armour step (damage_square: bursts and area spells). Returns death. */
  direct(dd: number, type: number, src: number): boolean;
  /** critter_attack's poison after a hit (the player only). */
  afterMeleeHit(poison: number): void;
}

export class MonsterActor {
  dmgTaken = 0;          // OBJ_DAMAGE since the last flee test (the byte b11: it wraps)
  lastHit = false;       // last_hit set: the next step runs the hit reaction
  bound = false;         // b19 bit 5: bound to fight
  seq = 0; frame = 0; k = 0; castSlot = 0;
  private readonly rawSpells: number[];
  private readonly D2: number;

  constructor(readonly M: MonsterProfile, public hp: number, public active: boolean,
    readonly ranged: boolean, readonly D: number, readonly sink: MonsterSink, readonly rng: Rng) {
    this.rawSpells = creatures[M.creature].spells;
    this.D2 = D * D;
  }

  /** damage_critter records the attacker; a creature with bA_1 never reacts to it (AI.C:1225). */
  wake() { if (!this.M.ignoresFights) { this.active = true; this.lastHit = true; } }

  /** damage_critter: HP down, death at 0; OBJ_DAMAGE grows (a byte). Returns the HP actually lost and death. */
  hurt(d: number): { lost: number; died: boolean } {
    const lost = Math.min(d, this.hp);
    this.dmgTaken = (this.dmgTaken + d) & 0xff;
    if (this.hp <= d) { this.hp = 0; return { lost, died: true }; }
    this.hp -= d;
    return { lost, died: false };
  }

  // ---- the monster's blows
  private melee(slot: number, T: Defender): boolean {
    const { M, rng, sink } = this;
    const a = M.attacks[slot];
    const swing = rng.int(9); // critter_ai's argument (AI.C:1156), drawn before critter_attack runs
    let askill = a.chance + (M.equip >> 1);
    let damage = a.damage + Math.trunc(M.str / 5);
    if (M.powerful) { askill += rng.int(6) + 7; damage += rng.int(12) + 4; }
    const probe = meleeProbe(0, M.height, swing, 2);
    const hitloc = pickloc(0, T.height, probe.z, probe.top, rng);
    const mod = T.protect(hitloc);
    const roll = rng.int(31);
    const g = gradeOfRoll(askill - mod, T.defence, roll);
    sink.srcAttempts[slot]++;
    if (g === 2) {
      damage *= critMultiplier(rng);
      sink.srcCrits[slot]++;
      T.onCritical(hitloc);
    }
    if (g <= 0) {
      sink.zoneMisses[hitloc]++;
      if (mod && gradeOfRoll(askill, T.defence, roll) > 0) sink.zoneProtMisses[hitloc]++;
      T.onMiss();
      return false;
    }
    sink.srcHits[slot]++;
    sink.zoneHits[hitloc]++;
    const dd = (rollDamage(damage, rng) * ATK_CHARGE[this.k]) >> 7;
    const died = T.blow(dd, hitloc % 4, DMG_PHYSICAL, slot);
    T.afterMeleeHit(M.poison);
    return died;
  }

  private missile(damage: number, type: number, src: number, T: Defender): boolean {
    const { rng, sink } = this;
    sink.srcAttempts[src]++;
    const hitloc = pickloc(0, T.height, T.height >> 1, T.height >> 1, rng) + 4;
    sink.srcHits[src]++;
    sink.zoneHits[hitloc % 4]++;
    return T.blow(rollDamage(damage, rng), hitloc % 4, type, src);
  }

  private area(kind: 1 | 2, T: Defender): boolean {
    const { rng, sink, D } = this;
    sink.srcAttempts[SRC.area]++;
    const hits = areaHits(rng, D, kind === 1);
    if (hits) sink.srcHits[SRC.area]++;
    for (let h = 0; h < hits; h++) {
      const [dd, type] = squareDamage(rng, kind);
      if (T.direct(dd, type, SRC.area)) return true;
    }
    return false;
  }

  /** A Fireball or Lightning Bolt bursting on the target's square after it hit (EFFECT.C mts_doanim). */
  private burst(kind: 1 | 2, T: Defender): boolean {
    this.sink.srcAttempts[SRC.explosion]++;
    const [dd, type] = squareDamage(this.rng, kind);
    return T.direct(dd, type, SRC.explosion);
  }

  /** One AI step. Returns 0 nothing, 1 the target died, 2 the monster fled. */
  step(T: Defender): number {
    const { M, rng } = this;
    if (!this.active) return 0;
    if (this.seq !== 0) {
      if (this.frame !== 4) { this.frame++; return 0; }
      let died = false;
      if (this.seq <= 3) { died = this.melee(this.seq - 1, T); this.k = 0; }
      else if (this.seq === 5) died = this.missile(M.missile!.damage, M.missile!.type, SRC.missile, T);
      else {
        const sp = M.spells[this.castSlot - 1];
        if (sp.kind === 'missile') {
          died = this.missile(sp.damage, sp.type, SRC.spell, T);
          if (!died && sp.explode) died = this.burst(sp.explode, T);
        }
        else if (sp.kind === 'area') died = this.area(sp.area, T);
        else this.sink.defensiveCasts++;
      }
      this.seq = 0; this.frame = 0; this.castSlot = 0;
      return died ? 1 : 0;
    }
    if (this.lastHit) {
      this.lastHit = false;
      if (this.ranged && this.D2 > 2 && !M.offensive) this.bound = true; // b19 bit 5: bound to fight
      if (!this.bound && shouldIFlee(M.avghit, this.hp, M.nerve, this.dmgTaken, rng)) return 2;
      this.dmgTaken = 0;
    }
    if (!this.ranged) {
      if (rng.int(4) === 0) {
        let r = rng.int(100), i = 0;
        while (M.attacks[i].prob <= r && i < 2) { r -= M.attacks[i].prob; i++; }
        this.seq = i + 1; this.frame = 0;
      } else if (this.k < 15) this.k++;
    } else if (M.caster > 0) {
      if (this.rawSpells[2] !== 0xff && rng.int(256) < M.caster) { this.seq = 13; this.castSlot = 3; this.frame = 0; }
      else if (M.offensive && this.D2 < 0x40) {
        if (rng.int(128) < M.caster) { this.seq = 13; this.castSlot = rng.int(16) < 11 ? 1 : 2; this.frame = 0; }
      }
    } else if (M.missile && this.D2 < 0x10) {
      if (rng.int(192) <= M.dex) { this.seq = 5; this.frame = 0; }
    }
    return 0;
  }
}
