// One monster as an actor: its AI step (AI.C critter_ai -> critter_mv -> crit_offense) and the blows it
// strikes, against a Defender that is either the player (fight.ts) or another critter (duel.ts, plan C).
// The draws are made in the game's order; what differs between the two defenders (cmbModTH, armour wear,
// easy mode, poison, the player's or the critter's armour) is behind the Defender interface, as COMBAT.C
// tests `hitobj == 1` / `defender == 1` at exactly those points.

import type { Rng } from '../core/rng';
import { gradeOfRoll } from '../core/skillcheck';
import { ATK_CHARGE, critMultiplier, DMG_PHYSICAL, meleeProbe, pickloc, rollDamage, shouldIFlee } from './blow';
import { AREA_SPELLS, type AreaKind, type MissileAttack, type MonsterProfile } from './setup';
import { creatures } from '../data/gameData';

/** The counters a monster's attacks feed (a subset of Stats, so a Stats object serves). */
export interface MonsterSink {
  srcAttempts: number[]; srcHits: number[]; srcCrits: number[];
  zoneHits: number[]; zoneMisses: number[]; zoneProtMisses: number[];
  defensiveCasts: number; monHeals: number; monHealed: number;
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
  /** damage_item with no armour step (damage_square, explosions, area spells). Returns death. */
  direct(dd: number, type: number, src: number): boolean;
  /** critter_attack's poison after a hit (the player only). */
  afterMeleeHit(hitloc: number, poison: number): void;
  /** sp_shockwave reads the player's Casting whoever casts it. */
  casting: number;
}

/** The monster's square in an area spell's rectangle (gronk_area / process_area): the centre is
    `dist` squares ahead of the caster, the rectangle runs -radius..radius+1 around it, the target
    stands D squares straight ahead. Returns the square's index in the iteration order (x outer,
    y inner, the x axis across the line of fire) or -1 when it is outside. */
export function areaSquareIndex(kind: AreaKind, D: number): number {
  const a = AREA_SPELLS[kind];
  const rel = D - a.dist;
  if (rel < -a.radius || rel > a.radius + 1) return -1;
  const side = 2 * a.radius + 2;
  return a.radius * side + (rel + a.radius);
}

export class MonsterActor {
  dmgTaken = 0;          // OBJ_DAMAGE since the last flee test (a byte)
  lastHit = false;       // last_hit set: the next step runs the hit reaction
  bound = false;         // b19 bit 5: bound to fight
  seq = 0; frame = 0; k = 0; castSlot = 0;
  heldSteps = -1;        // goal 15 (sp_hold): GTARG counts down one per AI step at rate 7; -1 when not held
  rate = 4;
  private readonly rawSpells: number[];
  private readonly D2: number;

  constructor(readonly M: MonsterProfile, public hp: number, public active: boolean,
    readonly ranged: boolean, readonly D: number, readonly sink: MonsterSink, readonly rng: Rng) {
    this.rawSpells = creatures[M.creature].spells;
    this.D2 = D * D;
  }

  /** damage_critter records the attacker; a creature with bA_1 never reacts to it (AI.C critter_mv). */
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
    const swing = rng.int(9);           // critter_ai's argument, drawn before critter_attack's own rolls
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
    T.afterMeleeHit(hitloc, M.poison);
    return died;
  }

  private missile(m: MissileAttack, src: number, T: Defender): boolean {
    const { rng, sink } = this;
    sink.srcAttempts[src]++;
    const hitloc = pickloc(0, T.height, T.height >> 1, T.height >> 1, rng) + 4;
    sink.srcHits[src]++;
    sink.zoneHits[hitloc % 4]++;
    if (T.blow(rollDamage(m.damage, rng), hitloc % 4, m.type, src)) return true;
    // a fireball or lightning bolt then comes to rest and explodes on the struck object's square
    if (m.explode === 1) return T.direct(rng.rollem(10, 6), 0x0b, src);
    if (m.explode === 2) return T.direct(rng.rollem(6, 5), 0x03, src);
    return false;
  }

  /** The monster's area spell on the target, D squares ahead of it. */
  private area(kind: AreaKind, T: Defender): boolean {
    const { rng, sink, D } = this;
    sink.srcAttempts[5]++;
    const a = AREA_SPELLS[kind];
    const idx = areaSquareIndex(kind, D);
    const on = (dd: number, type: number) => T.direct(dd, type, 5);
    if (kind === 'sheet') {
      const side = 2 * a.radius + 2, squares = side * side, den = (2 * a.radius + 1) ** 2 + 3;
      let count = a.count, tries = 0, hits = 0;
      do {
        for (let i = 0; i < squares; i++) if (rng.int(den) < count) { if (i === idx) hits++; if (--count === 0) break; }
      } while (count > 0 && tries++ < 4);
      if (hits) sink.srcHits[5]++;
      for (let h = 0; h < hits; h++) if (on(rng.rollem(6, 5), 0x03)) return true;
      return false;
    }
    if (idx < 0) return false;
    if (kind === 'flame') {
      let count = a.count;
      for (let i = 0; i < idx; i++) if (rng.int(3) === 0 && --count === 0) return false;
      rng.int(3);
      sink.srcHits[5]++;
      return on(rng.rollem(10, 6), 0x0b);
    }
    sink.srcHits[5]++;
    if (kind === 'frost') return on(10, 0x23);
    if (kind === 'shockwave') return on(Math.trunc(T.casting / 2) + 15, 0x03);
    return false;
  }

  /** One AI step. Returns 0 nothing, 1 the target died, 2 the monster fled. */
  step(T: Defender): number {
    const { M, rng } = this;
    if (!this.active) return 0;
    if (this.seq !== 0) {
      // this step finds `frame`: the blow on frame 3, the sequence over on frame seq_len - 1
      let died = false;
      if (this.frame === 3) {
        if (this.seq <= 3) died = this.melee(this.seq - 1, T);
        else if (this.seq === 5) died = this.missile(M.missile!, 3, T);
        else {
          const sp = M.spells[this.castSlot - 1];
          if (sp.kind === 'missile') died = this.missile(sp, 4, T);
          else if (sp.kind === 'area') died = this.area(sp.area, T);
          else if (sp.kind === 'heal') {
            // healing(): rollem(sub, 8), or all for sub 15; get_hp_back caps the result at avghit
            const amount = sp.sub === 15 ? 0xff : rng.rollem(sp.sub, 8) & 0xff;
            const before = this.hp;
            this.hp = this.hp + amount > M.avghit ? M.avghit : this.hp + amount;
            this.sink.monHeals++; this.sink.monHealed += this.hp - before;
          } else this.sink.defensiveCasts++;
        }
      }
      const len = M.seqLen[this.seq <= 3 ? this.seq + 2 : 6];
      if (this.frame >= len - 1) { this.seq = 0; this.frame = 0; this.k = 0; this.castSlot = 0; }
      else this.frame++;
      return died ? 1 : 0;
    }
    if (this.heldSteps >= 0) {
      // goal 15: critter_mv skips the hit test; rate 7; GTARG-- until 0, then critter_discard_goal
      this.rate = 7;
      this.heldSteps = this.heldSteps > 0 ? this.heldSteps - 1 : -1;
      return 0;
    }
    this.rate = 4;
    if (this.lastHit) {
      this.lastHit = false;
      if (this.ranged && this.D2 > 2 && !M.offensive) this.bound = true; // bound to fight
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
