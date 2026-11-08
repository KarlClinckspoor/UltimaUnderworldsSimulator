// One store for the site: the character (kept in localStorage), the active tab and the
// settings of each tab (kept in the URL hash so a link reproduces a view).
import { defaultCharacter, type Character } from './core/character';
import { defaultSettings, type FightSettings } from './combat/setup';

export interface CombatUi extends FightSettings {
  level: number; row: number;          // selected enemy: level and row index
  n: number; hpMode: 'stored' | 'roll' | 'set'; hpSet: number; seed: number;
  attackSpell: number | null;
  allN: number; threshold: number; inclTrap: boolean; inclPeaceful: boolean; fleeCounts: boolean;
}
export interface ArenaUi {
  view: 'player' | 'arena';          // the Combat tab's sub-view
  mode: 'melee' | 'ranged';
  nMelee: number; nRanged: number;   // fights per pair
  hpMode: 'roll' | 'avg'; powerful: boolean; timeLimit: number; distance: number;
  rand: 'game' | 'ideal'; seed: number;
  flee: 'loss' | 'draw'; timeout: 'draw' | 'ignore';
  sel: string;                       // the head-to-head pair, "i-j" in the shown run, or ''
  player: boolean;                   // add the character as an entrant
  playerBuffs: boolean;              // with the panel's buffs (spells are left out otherwise)
  focus: string;                     // the entrant summarised against all others (entrant key), or ''
}
export interface SkillsUi { check: string; value: number | null; target: number | null; pinned: { label: string; value: number; target: number }[] }
export type Tab = 'skills' | 'combat' | 'chargen';
export interface AppState { tab: Tab; panelOpen: boolean; character: Character; combat: CombatUi; skills: SkillsUi; arena: ArenaUi }

const CHAR_KEY = 'uw1sim.character.v1';

function loadCharacter(): Character {
  try {
    const s = localStorage.getItem(CHAR_KEY);
    if (s) return { ...defaultCharacter(), ...JSON.parse(s) };
  } catch { /* storage unavailable */ }
  return defaultCharacter();
}

export const state: AppState = {
  tab: 'combat', panelOpen: true, character: loadCharacter(),
  combat: { ...defaultSettings(), level: 1, row: 0, n: 1000, hpMode: 'stored', hpSet: 20, seed: 1, attackSpell: null,
    allN: 300, threshold: 0.9, inclTrap: true, inclPeaceful: true, fleeCounts: false },
  skills: { check: 'casting', value: null, target: null, pinned: [] },
  arena: defaultArena(),
};
export function defaultArena(): ArenaUi {
  return { view: 'player', mode: 'melee', nMelee: 200, nRanged: 1000, hpMode: 'roll', powerful: false, timeLimit: 120, distance: 3,
    rand: 'game', seed: 1, flee: 'loss', timeout: 'draw', sel: '', player: false, playerBuffs: false, focus: '' };
}

type Listener = (why: string) => void;
const listeners: Listener[] = [];
export const subscribe = (f: Listener) => { listeners.push(f); };
export function changed(why: string) {
  if (why.startsWith('character')) {
    try { localStorage.setItem(CHAR_KEY, JSON.stringify(state.character)); } catch { /* ignore */ }
  }
  writeHash();
  for (const f of listeners) f(why);
}

const HASH_COMBAT: (keyof CombatUi)[] = ['level', 'row', 'mode', 'distance', 'hitangle', 'swing', 'timeLimit', 'n',
  'hpMode', 'hpSet', 'seed', 'attackSpell', 'rangedHitChance', 'aimTicks'];
function writeHash() {
  const p = new URLSearchParams();
  p.set('tab', state.tab);
  for (const k of HASH_COMBAT) { const v = state.combat[k]; if (v !== null && v !== undefined) p.set(k, String(v)); }
  p.set('check', state.skills.check);
  const d = defaultArena() as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(state.arena)) if (v !== d[k]) p.set('a.' + k, String(v));
  try { history.replaceState(null, '', '#' + p.toString()); } catch { /* ignore */ }
}
export function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const tab = p.get('tab');
  if (tab === 'skills' || tab === 'combat' || tab === 'chargen') state.tab = tab;
  for (const k of HASH_COMBAT) {
    const v = p.get(k);
    if (v === null) continue;
    const cur = state.combat[k];
    (state.combat as any)[k] = typeof cur === 'number' || k === 'attackSpell' ? Number(v) : v;
  }
  const c = p.get('check');
  if (c) state.skills.check = c;
  const d = defaultArena() as unknown as Record<string, unknown>;
  for (const k of Object.keys(d)) {
    const v = p.get('a.' + k);
    if (v === null) continue;
    (state.arena as any)[k] = typeof d[k] === 'number' ? Number(v) : typeof d[k] === 'boolean' ? v === 'true' : v;
  }
}
