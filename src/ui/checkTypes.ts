// What the Skills tab knows about one skill_check call site. The catalogue itself is per game
// (src/data/checks.ts); the tab (skills.ts) is the same for both.
import type { Character } from '../core/character';

export interface Check {
  id: string; label: string; where: string;
  value: (c: Character, p: number) => number;
  target: (c: Character, p: number) => number;
  /** what the value is, in words ("Lore", "Pick Lock + 1", "INT") */
  vName: string;
  /** what the target is, in words ("8", "3 × circle") */
  tName: string;
  /** the highest value the character can reach (skills and attributes stop at 30), null when the value is a free parameter */
  vCap: number | null;
  param?: { label: string; min: number; max: number; def: number; options?: [number, string][] };
  /** one line: what each grade does */
  effect: string;
  /** a paragraph on what the check is for */
  about?: string;
  /** the rule in LaTeX (\V{..} value, \T{..} target) and in Python */
  tex: string;
  py: string;
  notes?: string[];
  /** a timed check run by duration_check */
  timed?: 'hp' | 'mana' | 'drown';
  extra?: (c: Character, p: number, el: HTMLElement) => void;
}

export interface GameTiming {
  game: 'UW1' | 'UW2';
  /** game seconds between duration checks */
  checkSeconds: number;
  /** duration checks per mana roll and per HP roll */
  manaEvery: number;
  hpEvery: number;
  source: string;
  /** game-specific remarks on the timed checks */
  manaNote?: string;
  hpNote?: string;
}
