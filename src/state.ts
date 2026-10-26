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
export interface SkillsUi { check: string; value: number | null; target: number | null; pinned: { label: string; value: number; target: number }[] }
export interface AppState { tab: 'skills' | 'combat'; panelOpen: boolean; character: Character; combat: CombatUi; skills: SkillsUi }

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
};

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
  try { history.replaceState(null, '', '#' + p.toString()); } catch { /* ignore */ }
}
export function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const tab = p.get('tab');
  if (tab === 'skills' || tab === 'combat') state.tab = tab;
  for (const k of HASH_COMBAT) {
    const v = p.get(k);
    if (v === null) continue;
    const cur = state.combat[k];
    (state.combat as any)[k] = typeof cur === 'number' || k === 'attackSpell' ? Number(v) : v;
  }
  const c = p.get('check');
  if (c) state.skills.check = c;
}
