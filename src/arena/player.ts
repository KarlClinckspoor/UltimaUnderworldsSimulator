// The character as an arena entrant: it fights every monster with Part B's engine (fight.ts), and those
// games are added to the round robin before the ratings are fitted again. The monsters' own pairs do not
// change, so only the fit is redone.
//
// Melee: the weapon in hand (or the fist), no spells at all. Ranged: the single most damaging ranged move,
// the launcher or one castable attack spell, chosen by the damage per use against an unarmoured target.
import { makeRng, type RandModel } from '../core/rng';
import { ATTACK_SPELLS, spellStatus, type Character } from '../core/character';
import { defaultSettings, monsterProfile, playerProfile, spellAttackOf, type FightSettings, type MonsterProfile, type PlayerProfile } from '../combat/setup';
import { newStats, simulate, type HpMode } from '../combat/fight';
import type { DuelSettings } from '../combat/duel';
import type { Stats } from '../combat/stats';
import type { PairRec } from './arena';

export interface MoveOption { label: string; spell: number | null; perUse: number; uses: number }
export interface PlayerSetup {
  P: PlayerProfile | null;     // null: no way to fight in this mode
  S: FightSettings;
  move: string;                // what the character does, in words
  options: MoveOption[];       // the ranged candidates with their damage per use (ranged only)
  why?: string;                // why it cannot fight in this mode
}

/** The character for the arena: the panel's buffs only when asked (spells are left out by default). */
export const arenaCharacter = (c: Character, buffs: boolean): Character => (buffs ? c : { ...c, buffs: [] });

/** A target that never acts, flees or resists: no armour, bleeds, not undead. */
function dummy(): MonsterProfile {
  const base = monsterProfile(0, 255, false, 1, 9);
  const none = { chance: 0, damage: 0, prob: 0 };
  return { ...base, name: 'target', hp: 255, avghit: 255, armour: [0, 0, 0, 0], resist: 0, blood: 1, attacks: [none, none, none],
    missile: null, caster: 0, offensive: false, ignoresFights: true, attitude: 1, passive: true };
}

/** Damage per use of one ranged option: mean HP removed from the dummy per shot or cast attempt. */
function perUse(P: PlayerProfile, S: FightSettings, n = 400): { perUse: number; uses: number } {
  const st: Stats = simulate(newStats(P, dummy(), S), P, dummy(), { ...S, timeLimit: 20 }, { kind: 'set', value: 255 }, n, makeRng(97, 0, 'ideal'));
  const dealt = st.dealt.reduce((a, b) => a + b, 0);
  const uses = P.attackSpell ? st.casts + st.fizzles + st.backfires : st.pShots;
  return { perUse: uses ? dealt / uses : 0, uses: uses / n };
}

export function playerSetup(c0: Character, mode: 'melee' | 'ranged', D: DuelSettings, rand: RandModel, buffs: boolean): PlayerSetup {
  const c = arenaCharacter(c0, buffs);
  const S: FightSettings = { ...defaultSettings(), mode, distance: D.distance, timeLimit: D.timeLimit, rand };
  if (mode === 'melee') {
    const P = playerProfile(c, null);
    return { P, S, move: `${P.launcher ? `${P.launcher.name} (shoots point-blank)` : P.melee.name}, best swing, full charge`, options: [] };
  }
  const options: MoveOption[] = [];
  const base = playerProfile(c, null);
  if (base.launcher) options.push({ label: `${base.launcher.name} with ${base.launcher.ammoName}`, spell: null, ...perUse(base, S) });
  const status = spellStatus(c);
  for (const i of ATTACK_SPELLS) {
    if (!status[i]?.castable || !spellAttackOf(i, c.level)) continue;
    const P = { ...playerProfile(c, i), launcher: null };
    if (!P.attackSpell) continue;
    options.push({ label: P.attackSpell.name, spell: i, ...perUse(P, S) });
  }
  if (!options.length) return { P: null, S, move: 'none', options, why: 'no ranged attack: equip a sling, bow or crossbow, or learn a castable attack spell' };
  options.sort((a, b) => b.perUse - a.perUse);
  const best = options[0];
  const P = playerProfile(c, best.spell);
  const fallback = best.spell !== null && P.launcher ? `, then the ${P.launcher.name} when the mana runs out` : '';
  return { P, S, move: `${best.label} (${best.perUse.toFixed(1)} HP per use)${fallback}`, options };
}

/** Part B's HP mode for the arena's: rolled fresh, or exactly the average. */
export const arenaHpMode = (D: DuelSettings, M: MonsterProfile): HpMode =>
  D.hpMode === 'roll' ? { kind: 'roll' } : { kind: 'set', value: M.avghit };

/** A player-vs-monster Stats record as an arena pair (i = the character, j = the monster). The player never
    flees; a monster's flight is outcome 3. The monster's starting HP is not recorded by fight(), so it is the
    mean of the HP rule (avghit, or avghit × 27.5 / 32 when rolled), and its HP after a win is not known (NaN). */
export function pairFromPlayerStats(i: number, j: number, st: Stats, P: PlayerProfile, M: MonsterProfile, D: DuelSettings): PairRec {
  const n = st.n;
  const o = [st.outcomes[0], st.outcomes[1], 0, st.outcomes[2], st.outcomes[3]];
  const hist: number[] = [];
  for (const h of st.durHist) h.forEach((v, b) => { const s = Math.floor(b / 2); hist[s] = (hist[s] ?? 0) + v; });
  for (let s = 0; s < hist.length; s++) hist[s] ??= 0;
  let last = hist.length - 1;
  while (last > 0 && !hist[last]) last--;
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const hpLeft = st.hpLeftHist.reduce((s, c, hp) => s + c * hp, 0);
  const mStart = D.hpMode === 'roll' ? (M.avghit * 27.5) / 32 : M.avghit;
  return {
    i, j, o, dur: sum(st.durSum), hist: hist.slice(0, last + 1),
    side: [
      { att: st.pSwings + st.pShots + st.casts + st.fizzles + st.backfires - (P.attackSpell?.missile ? st.casts : 0),
        hit: st.pHits + st.pShotHits + (P.attackSpell && !P.attackSpell.missile ? st.casts : 0), crit: st.pCrits,
        dealt: sum(st.dealt), absorbed: st.absorbedMon, resisted: st.resistedMon, hpStart: P.hp * n, hpLeft },
      { att: sum(st.srcAttempts), hit: sum(st.srcHits), crit: sum(st.srcCrits), dealt: sum(st.srcDamage),
        absorbed: st.zoneAbsorbed.reduce((s, z) => s + sum(z), 0), resisted: st.resistedPlayer, hpStart: mStart * n, hpLeft: NaN },
    ],
  };
}

