// DATA\SKILLS.DAT, read by CHARGEN.C's strt_chargen: per class its STR, DEX and INT and its
// bonus points (four bytes each), then five skill entries a class, each a count and that many
// skill indices: one skill is given outright, several make a menu to pick one from.
// Extracted from the pristine UW1 file (187 bytes).
export interface ChargenClass { name: string; attrs: [number, number, number]; points: number; entries: number[][] }
export const CHARGEN_GAME = 'UW1';
export const CHARGEN_CLASSES: ChargenClass[] = [
  { name: 'Fighter', attrs: [20, 16, 12], points: 12, entries: [[0], [1], [0, 1], [2, 3, 4, 5, 6], [19, 10, 11, 15, 17, 18]] },
  { name: 'Mage', attrs: [12, 16, 20], points: 12, entries: [[0], [1], [7], [9], [7, 9]] },
  { name: 'Bard', attrs: [14, 20, 14], points: 12, entries: [[0], [1], [8, 15], [18, 17, 13, 16, 11, 19], [7, 9, 3, 4, 5, 2, 6]] },
  { name: 'Tinker', attrs: [18, 18, 12], points: 12, entries: [[0], [1], [14], [2, 3, 4, 5, 6], [16, 10, 11, 18, 14]] },
  { name: 'Druid', attrs: [18, 12, 18], points: 12, entries: [[0], [1], [9], [7], [12, 8, 11]] },
  { name: 'Paladin', attrs: [12, 18, 18], points: 12, entries: [[0], [1], [15], [18, 15, 17, 14], [2, 3, 4, 5, 6]] },
  { name: 'Ranger', attrs: [16, 16, 16], points: 12, entries: [[0], [1], [12], [10, 17, 13, 11, 19, 14], [2, 3, 4, 5, 6, 0, 1, 12]] },
  { name: 'Shepherd', attrs: [12, 12, 12], points: 20, entries: [[0], [1], [2, 3, 4, 5, 6, 1], [10, 11, 13, 17, 18, 19, 12, 9, 8, 7], [10, 11, 13, 17, 18, 19, 12, 9, 8, 7]] },
];
