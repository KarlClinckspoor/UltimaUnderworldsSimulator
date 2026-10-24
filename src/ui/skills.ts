// Skills tab: exact odds of every skill_check call site outside combat (plan Part A).
import { gradeCounts, gradeOfRoll, gradeProbs, pPass } from '../core/skillcheck';
import { faceProbs, modProbs, setRandModel } from '../core/randdist';
import { maxWeight, type Character } from '../core/character';
import { armour as ARMOUR, SK, weapons, worldOf } from '../data/gameData';
import { changed, state } from '../state';
import { card, clear, fmt, h, numInput, pct, select } from './dom';
import { C, groupedBars, heatmap, lineChart, stackedBars } from './charts';

interface Check {
  id: string; label: string; where: string;
  value: (c: Character, p: number) => number; target: (c: Character, p: number) => number;
  param?: { label: string; min: number; max: number; def: number; options?: [number, string][] };
  effect: string;
  extra?: (c: Character, p: number, el: HTMLElement) => void;
}

const durabilityItems: [number, string][] = [
  ...weapons.slice(0, 15).map((w) => [w.durability, `${w.name} (${w.durability})`] as [number, string]),
  ...ARMOUR.filter((a) => a.durability < 255 && !a.name.startsWith('item')).map((a) => [a.durability, `${a.name} (${a.durability})`] as [number, string]),
].sort((a, b) => a[0] - b[0]);

const world = (c: Character) => worldOf(c.dungeonLevel);
const CHECKS: Check[] = [
  { id: 'casting', label: 'Casting a spell', where: 'RUNES.C:238', value: (c) => c.skills[SK.Casting], target: (_, p) => 3 * p,
    param: { label: 'circle', min: 1, max: 8, def: 1 }, effect: '2 or 1: the spell is cast · 0: "The incantation failed", no mana spent · -1: backfire (mana spent, (circle/2)d8 damage, never below 3 HP). First: level ≥ 2 × circle − 1, mana ≥ 3 × circle, and in Britannia (levels 1-8) no circle above 3. No +5 and a target of 3 × circle: casting is harder than in UW1.',
    extra: castingTable },
  { id: 'track', label: 'Track (skill key)', where: 'SPELLS2.C:613', value: (c) => c.skills[SK.Track], target: (_, p) => 15 - p,
    param: { label: 'creature noise', min: 0, max: 15, def: 10 }, effect: '> 0: the creature is counted in its direction; 2 names it. One check per creature within 8 squares. UW2 has no Detect Monster spell.' },
  { id: 'lore', label: 'Lore: looking at an item', where: 'INTERACT.C:547', value: (c) => c.skills[SK.Lore], target: () => 8,
    effect: 'Lore level = grade + 1, at least 1 (2 → 3, 1 → 2, 0 and −1 → 1); the best result is kept on the object. Target 8 (UW1: 10).', extra: loreLevels },
  { id: 'lore-barter', label: 'Lore: barter (NPC side)', where: 'BARTER.C:368', value: (c) => c.skills[SK.Lore], target: () => 20,
    effect: 'Lore level 1 + [grade > 0] for the item on the NPC side of the trade.' },
  { id: 'lore-barter15', label: 'Lore: barter (your side)', where: 'BARTER.C:369', value: (c) => c.skills[SK.Lore], target: () => 15, effect: 'Lore level 1 + grade (0..3).' },
  { id: 'look-trigger', label: 'Hidden look trigger', where: 'TRIGGER.C:107', value: (c) => c.skills[SK.Search], target: (_, p) => p,
    param: { label: "trigger's z", min: 1, max: 127, def: 8 }, effect: '≤ 0: not triggered. Only look triggers (type 5) with z > 0. The Reveal spell runs the check with Search 45.' },
  { id: 'detect-trap', label: 'Search: detect a trap', where: 'SKILLS.C:885', value: (c) => c.skills[SK.Search], target: (c) => 10 + 2 * world(c),
    effect: '> 0: offers to disarm. Target 10 + 2 × world (10 in Britannia … 26 on levels 73-80); set the dungeon level in the panel.' },
  { id: 'detect-spell', label: 'Detect Trap spell', where: 'SPELLS.C:862', value: () => 45, target: (c) => 10 + 2 * world(c), effect: 'As the Search check, with a fixed value of 45.' },
  { id: 'disarm', label: 'Traps: disarm', where: 'SKILLS.C:923', value: (c) => c.skills[SK.Traps], target: (c) => 8 + world(c),
    effect: '> 0: removed · 0: "Unable to defuse trap" · −1: set off. Target 8 + world.' },
  { id: 'remove-trap', label: 'Remove Trap spell', where: 'SPELLS.C:846', value: () => 45, target: (c) => 8 + world(c),
    effect: 'As disarm, with a fixed value of 45; the detection roll before it (45 vs 10 + 2 × world) only stops the spell on a 0.' },
  { id: 'lockpick', label: 'Pick Lock', where: 'OBJUSE.C:325', value: (c) => c.skills[SK['Pick Lock']] + 1, target: (_, p) => 3 * p,
    param: { label: "lock's z", min: 0, max: 15, def: 3 }, effect: '> 0: opens · 0: fails · −1: a fumble: DEX vs 20 (> 0) or "You broke your pick". The value is Pick Lock + 1. z 15 never opens; z 14 needs a value of 32, so never with Pick Lock (cap 30 + 1).', extra: lockNote },
  { id: 'open-spell', label: 'Open spell', where: 'SPELLS.C:856', value: () => 45, target: (_, p) => 3 * p,
    param: { label: "lock's z", min: 0, max: 15, def: 10 }, effect: '> 0: opens (45 passes the z 14 guard). Mana is spent either way.' },
  { id: 'repair', label: 'Repair at an anvil', where: 'WORLDEV.C:1013', value: (c) => c.skills[SK.Repair], target: (_, p) => p,
    param: { label: 'item durability', min: 1, max: 60, def: 5, options: durabilityItems },
    effect: '2: full repair · 1: +3 + skill/5 quality · 0: nothing · −1: destroyed if (rand & 63) > quality + skill, else −(4 + rand & 7) quality.', extra: repairTable },
  { id: 'swim', label: 'Swimming (per check)', where: 'PLAYTIME.C:228', value: (c) => c.skills[SK.Swimming], target: (_, p) => p,
    param: { label: 'load = weight × 32 / max weight', min: 0, max: 32, def: 4 }, effect: 'grade < 1 adds rollem(3 − grade, 4) to swim_count; a second roll sets the drowning damage rollem(2, hurt + 2) with hurt = 2 − grade once swim_count passes 0x78.', extra: swimNote },
  { id: 'fall', label: 'Acrobat: falling', where: 'PHYSICS.C:610', value: (c) => c.skills[SK.Acrobat], target: (_, p) => 2 * p,
    param: { label: 'fall damage', min: 1, max: 40, def: 5 }, effect: '> 0: damage × (30 − Acrobat) / 30. Damage of 3 or less is ignored; no fall damage at all in the Ethereal Void (levels 65-72).' },
  { id: 'ice', label: 'Acrobat: thin ice', where: 'TRIGGER.C:1181', value: (c) => c.skills[SK.Acrobat], target: (_, p) => (p > 20 ? p : 0),
    param: { label: 'carried weight / 12', min: 0, max: 60, def: 10 }, effect: 'Only a −1 breaks the ice under you (the tile drops one step). The target is weight / 12 when that is above 20, else 0.' },
  { id: 'skill-trap', label: 'Skill trap', where: 'TRIGGER.C:378', value: (_, p) => p, target: () => 15,
    param: { label: 'attribute or skill value', min: 0, max: 40, def: 15 }, effect: 'A trap with heading 1 rolls value against 3 × owner (others compare them outright): ≤ 0 fails and the trap\'s else-chain runs. Quality 0..2 an attribute, 3 the value 15, 4+ a skill. Owner is fixed at 5 here (target 15); edit the target for other traps.' },
  { id: 'mana-regen', label: 'Mana regeneration', where: 'PLAYTIME.C:134', value: (c) => c.skills[SK.Mana], target: () => 10,
    effect: 'mana + grade when grade > 0, every third duration check (every 60 game seconds). Nothing in Scintillus Academy (levels 41-48) except its level 1 and the far side of its level 8.' },
  { id: 'hp-regen', label: 'HP regeneration', where: 'PLAYTIME.C:148', value: (c) => c.str, target: () => 15, effect: '> 0: +1 HP, every 30th duration check (every 10 game minutes; UW1: every 24th).' },
  { id: 'mushroom', label: 'Mushroom', where: 'USEITEMS.C:222', value: (c) => c.int, target: () => 20,
    effect: 'The result is tested as a truth value, so every grade except 0 counts (−1 included): then mana + 0..2. The same quirk as UW1.', extra: mushroomNote },
  { id: 'drunk', label: 'Drink', where: 'USEITEMS.C:307', value: (c) => c.str, target: (_, p) => p, param: { label: 'drunk level', min: 0, max: 63, def: 10 },
    effect: '−1: passes out · 0: wobbles (drunk / 6) · 2: +2 HP.' },
  { id: 'halluc', label: 'Hallucination (special attack)', where: 'SPELLS.C:980', value: (c) => c.int, target: () => 20,
    effect: '> 0 resists a mind-blast special (cases 3 and 4 of special_spells).' },
  { id: 'chargen', label: 'Character creation (one check)', where: 'SKILLS.C:143', value: (_, p) => p, target: () => 20,
    param: { label: 'prime attribute', min: 10, max: 30, def: 20 }, effect: 'Each grade (−1..2) is added to the skill: three checks for a new skill, two for one already held.', extra: chargenDist },
];

const GRADE_COLORS = [C.death, C.flee, C.blue, C.win];
void maxWeight;
const GRADE_LABELS = ['−1 failure', '0 near miss', '1 success', '2 critical'];

let paramVals: Record<string, number> = {};

export function renderSkills(root: HTMLElement) {
  clear(root);
  const c = state.character;
  const ui = state.skills;
  const chk = CHECKS.find((k) => k.id === ui.check) ?? CHECKS[0];
  const p = paramVals[chk.id] ?? chk.param?.def ?? 0;
  const autoV = chk.value(c, p), autoT = chk.target(c, p);
  const value = ui.value ?? autoV, target = ui.target ?? autoT;
  const rerender = () => renderSkills(root);
  setRandModel(state.combat.rand);
  const game = state.combat.rand === 'game';

  // ---- catalogue
  const list = h('div', { class: 'check-list' });
  for (const k of CHECKS) {
    const pk = paramVals[k.id] ?? k.param?.def ?? 0;
    const pr = pPass(k.value(c, pk), k.target(c, pk));
    list.append(h('button', { class: `check ${k.id === chk.id ? 'on' : ''}`, onclick: () => { ui.check = k.id; ui.value = null; ui.target = null; changed('skills'); rerender(); } },
      h('span', {}, k.label), h('span', { class: 'pbar' }, h('i', { style: `width:${(100 * pr).toFixed(1)}%` })), h('b', {}, pct(pr, 0))));
  }

  // ---- controls
  const ctrls = h('div', { class: 'row wrap ctrls' },
    h('label', { class: 'lab' }, h('span', {}, `Value (auto ${autoV})`), numInput(value, -20, 80, (v) => { ui.value = v; rerender(); })),
    h('label', { class: 'lab' }, h('span', {}, `Target (auto ${autoT})`), numInput(target, -20, 100, (v) => { ui.target = v; rerender(); })),
    chk.param ? h('label', { class: 'lab' }, h('span', {}, chk.param.label),
      chk.param.options ? select(p, chk.param.options, (v) => { paramVals[chk.id] = v; ui.target = null; rerender(); })
        : numInput(p, chk.param.min, chk.param.max, (v) => { paramVals[chk.id] = v; ui.target = null; ui.value = null; rerender(); })) : null,
    h('button', { class: 'btn ghost', onclick: () => { ui.value = null; ui.target = null; rerender(); } }, 'Use character'),
    h('button', { class: 'btn', title: 'Keep this scenario on the charts for comparison', onclick: () => { ui.pinned.push({ label: `${chk.label} ${value}/${target}`, value, target }); rerender(); } }, 'Pin scenario'),
    ui.pinned.length ? h('button', { class: 'btn ghost', onclick: () => { ui.pinned = []; rerender(); } }, `Clear ${ui.pinned.length} pinned`) : null,
    h('label', { class: 'lab' }, h('span', {}, 'Random numbers'), select(state.combat.rand, [['game', "the game's rand() (n/32768)"], ['ideal', 'ideal (n/31)']],
      (v) => { state.combat.rand = v; changed('combat'); rerender(); })));

  const gc = gradeCounts(value, target);
  const gradeCard = card('Grade odds', `skill_check(${value}, ${target}): score = ${value} − ${target} + rand() % 31`);
  const gbar = h('div');
  const scen = [...ui.pinned, { label: 'current', value, target }];
  groupedBars(gbar, GRADE_LABELS, scen.map((s, i) => ({ name: s.label, color: i === scen.length - 1 ? C.accent : C.series[i % C.series.length],
    values: gradeProbs(s.value, s.target) })), { yfmt: (v) => pct(v, 1), labels: true, yMax: 1 });
  const ideal = gradeCounts(value, target, 'ideal'), real = gradeCounts(value, target, 'game');
  const ppm = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 1e6).toFixed(0)} ppm`;
  const tbl = h('table', { class: 'mini wide' }, h('tr', {}, h('th', {}, ''), ...GRADE_LABELS.map((g) => h('th', {}, g))),
    h('tr', { class: game ? 'on' : '' }, h('td', {}, "game's rand()"), ...real.counts.map((n) => h('td', {}, `${n}/32768 = ${pct(n / 32768, 3)}`))),
    h('tr', { class: game ? '' : 'on' }, h('td', {}, 'ideal'), ...ideal.counts.map((n) => h('td', {}, `${n}/31 = ${pct(n / 31, 3)}`))),
    h('tr', {}, h('td', { class: 'muted' }, 'difference'), ...real.counts.map((n, i) => h('td', { class: 'muted' }, ppm(n / 32768 - ideal.counts[i] / 31)))));
  void gc;
  gradeCard.append(gbar, tbl, h('p', { class: 'effect' }, h('b', {}, `${chk.label} · ${chk.where}: `), chk.effect));

  // score distribution
  const scoreCard = card('The 31 scores', game ? "thresholds at 3, 16 and 29 · with the game's rand(), rand() % 31 = 0 comes up 1058 times in 32768, every other residue 1057"
    : 'thresholds at 3, 16 and 29 · ideal model: each residue 1/31');
  const w31 = modProbs(31);
  const sc = h('div');
  const scores = Array.from({ length: 31 }, (_, r) => value - target + r);
  stackedBars(sc, scores.map(String), [0, 1, 2, 3].map((g) => ({ name: GRADE_LABELS[g], color: GRADE_COLORS[g],
    values: scores.map((_, r) => (gradeOfRoll(value, target, r) + 1 === g ? w31[r] : 0)) })), { height: 180, yfmt: (v) => pct(v, 2),
    tip: (cat, s) => `score ${cat}: ${s.name}` });
  scoreCard.append(sc);

  // P(pass) vs value
  const curveCard = card('P(grade ≥ 1) against the value', `target ${target}; marker at the current value`);
  const cv = h('div');
  const xs = Array.from({ length: 61 }, (_, i) => i - 10);
  lineChart(cv, [...ui.pinned.map((s, i) => ({ name: s.label, color: C.series[i % C.series.length], points: xs.map((x) => [x, pPass(x, s.target)] as [number, number]), dashed: true })),
    { name: 'success or critical', color: C.accent, points: xs.map((x) => [x, pPass(x, target)] as [number, number]) },
    { name: 'critical', color: C.win, points: xs.map((x) => [x, gradeProbs(x, target)[3]] as [number, number]) },
    { name: 'failure (−1)', color: C.death, points: xs.map((x) => [x, gradeProbs(x, target)[0]] as [number, number]) }],
  { yDomain: [0, 1], marker: value, xLabel: 'value', yfmt: (v) => pct(v, 0) });
  curveCard.append(cv, h('ul', { class: 'legend' }, ...[[C.accent, 'success or critical'], [C.win, 'critical'], [C.death, 'failure (−1)'], ...ui.pinned.map((pp, i) => [C.series[i % C.series.length], pp.label + ' (dashed)'])].map(([col, l]) => h('li', {}, h('i', { class: 'sw', style: `background:${col}` }), l))));

  // heatmap
  const heatCard = card('P(grade ≥ 1): value × target', 'click a cell to load it');
  const hm = h('div');
  const vs = Array.from({ length: 51 }, (_, i) => i), ts = Array.from({ length: 51 }, (_, i) => i);
  heatmap(hm, vs, ts, (v, t) => pPass(v, t), { xLabel: 'value', yLabel: 'target', mark: [value, target], fmt: (x) => pct(x, 1),
    onClick: (v, t) => { ui.value = v; ui.target = t; rerender(); } });
  heatCard.append(hm);

  const cards = h('div', { class: 'cards' }, gradeCard, scoreCard, curveCard, heatCard);
  if (chk.extra) { const ex = card('Details', chk.label); chk.extra(c, p, ex); cards.append(ex); }
  root.append(h('div', { class: 'skills-layout' }, h('div', { class: 'catalogue' }, h('h3', {}, 'Every skill check'),
    h('p', { class: 'hint' }, `Exact odds (${game ? "n/32768, the game's rand()" : 'n/31, ideal'}), filled in from the character. The combat rolls are on the Combat tab.`), list),
  h('div', { class: 'skills-main' }, ctrls, cards)));
}

function castingTable(c: Character, _p: number, el: HTMLElement) {
  const t = h('table', { class: 'mini wide' }, h('tr', {}, ...['Circle', 'Target', 'Cast', 'Fizzle (0)', 'Backfire (−1)', 'Backfire damage', 'Allowed?'].map((x) => h('th', {}, x))));
  const mm = ((c.skills[SK.Mana] + 1) * c.int) >> 3;
  for (let circle = 1; circle <= 8; circle++) {
    const g = gradeProbs(c.skills[SK.Casting], 3 * circle);
    const why = [Math.floor((c.level + 1) / 2) < circle ? `level ${2 * circle - 1}` : '', 3 * circle > mm ? `${3 * circle} mana` : '',
      worldOf(c.dungeonLevel) === 0 && circle > 3 ? 'to leave Britannia' : ''].filter(Boolean).join(', ');
    t.append(h('tr', {}, h('td', {}, String(circle)), h('td', {}, String(3 * circle)), h('td', {}, pct(g[2] + g[3])), h('td', {}, pct(g[1])),
      h('td', {}, pct(g[0])), h('td', {}, circle >> 1 ? `${circle >> 1}d8, mean ${(4.5 * (circle >> 1)).toFixed(1)}` : 'none'), h('td', { class: why ? 'warn' : '' }, why ? `needs ${why}` : 'yes')));
  }
  el.append(t, h('p', { class: 'hint' }, 'A critical (2) casts like a success; the self-damage comes from the −1.'));
}
function loreLevels(c: Character, _p: number, el: HTMLElement) {
  const g = gradeProbs(c.skills[SK.Lore], 8);
  el.append(h('p', {}, `Lore level 1: ${pct(g[0] + g[1])} · level 2: ${pct(g[2])} · level 3: ${pct(g[3])}`));
}
function lockNote(c: Character, p: number, el: HTMLElement) {
  const v = c.skills[SK['Pick Lock']] + 1;
  if (p >= 15) el.append(h('p', { class: 'warn' }, 'z 15: never opens.'));
  else if (p === 14) el.append(h('p', { class: 'warn' }, `z 14: fails outright for values below 32, so Pick Lock ${c.skills[SK['Pick Lock']]} (+1) never opens it.`));
  else {
    const g = gradeProbs(v, 3 * p);
    const saved = pPass(c.dex, 20);
    el.append(h('p', {}, `Opens with ${pct(g[2] + g[3])} per try; fumbles ${pct(g[0])}, of which DEX ${c.dex} vs 20 saves the pick ${pct(saved)}: the pick breaks ${pct(g[0] * (1 - saved))} of tries.`));
  }
}
function repairTable(c: Character, p: number, el: HTMLElement) {
  const sk = c.skills[SK.Repair];
  const g = gradeProbs(sk, p);
  const rows: [string, number][] = [];
  rows.push(['full repair (2)', g[3]], [`+${3 + Math.trunc(sk / 5)} quality (1)`, g[2]], ['nothing (0)', g[1]]);
  el.append(h('p', {}, 'Per quality of the item (the destruction chance depends on it):'));
  const t = h('table', { class: 'mini wide' }, h('tr', {}, ...['Quality', 'Full', `+${3 + Math.trunc(sk / 5)}`, 'Nothing', 'Destroyed', 'Damaged −4..−11', 'Time (min)'].map((x) => h('th', {}, x))));
  for (const q of [5, 15, 30, 45, 60]) {
    const pd = Math.max(0, 63 - (q + sk)) / 64;
    t.append(h('tr', {}, h('td', {}, String(q)), h('td', {}, pct(g[3])), h('td', {}, pct(g[2])), h('td', {}, pct(g[1])), h('td', {}, pct(g[0] * pd)),
      h('td', {}, pct(g[0] * (1 - pd))), h('td', {}, String(Math.max(15, 3 * p - sk - Math.trunc(q / 2))))));
  }
  el.append(t);
  void rows;
}
function swimNote(c: Character, _p: number, el: HTMLElement) {
  el.append(h('p', {}, `Max weight ${maxWeight(c)} (STR × 13 + 300). Load = weight × 32 / max weight, e.g. carrying half the maximum gives 16.`));
  const t = h('table', { class: 'mini wide' }, h('tr', {}, ...['Load', 'P(no swim_count rise)', 'Expected drowning damage per tick'].map((x) => h('th', {}, x))));
  for (const load of [0, 4, 8, 16, 24, 32]) {
    const g = gradeProbs(c.skills[SK.Swimming], load);
    // hurt = 2 - grade; damage rollem(2, hurt + 2) when hurt != 0 -> mean 2 * (hurt + 3) / 2
    let ed = 0;
    // damage rollem(2, hurt + 2): 2 + two faces of (rand() * sides) / 0x8000
    [-1, 0, 1, 2].forEach((gr, i) => { const hurt = 2 - gr; if (hurt) ed += g[i] * (2 + 2 * faceProbs(hurt + 2).reduce((m, p, f) => m + p * f, 0)); });
    t.append(h('tr', {}, h('td', {}, String(load)), h('td', {}, pct(g[2] + g[3])), h('td', {}, fmt(ed, 2))));
  }
  el.append(t);
}
function mushroomNote(c: Character, _p: number, el: HTMLElement) {
  const g = gradeProbs(c.int, 20);
  el.append(h('p', {}, `As the code reads (any grade but 0): ${pct(1 - g[1])}. As probably intended (grade > 0): ${pct(g[2] + g[3])}.`));
}
function chargenDist(_c: Character, p: number, el: HTMLElement) {
  const g = gradeProbs(p, 20);
  const conv = (n: number) => {
    let d = new Map<number, number>([[0, 1]]);
    for (let i = 0; i < n; i++) {
      const nd = new Map<number, number>();
      for (const [s, ps] of d) [-1, 0, 1, 2].forEach((gr, j) => nd.set(s + gr, (nd.get(s + gr) ?? 0) + ps * g[j]));
      d = nd;
    }
    return [...d.entries()].sort((a, b) => a[0] - b[0]);
  };
  const three = conv(3), two = conv(2);
  el.append(h('p', {}, 'Sum of the grades added (before the base, attribute share and random bonus):'));
  const box = h('div');
  const cats = Array.from({ length: 10 }, (_, i) => String(i - 3));
  groupedBars(box, cats, [
    { name: 'new skill (3 checks)', color: C.accent, values: cats.map((x) => three.find(([s]) => s === +x)?.[1] ?? 0) },
    { name: 'held skill (2 checks)', color: C.blue, values: cats.map((x) => two.find(([s]) => s === +x)?.[1] ?? 0) }], { yfmt: (v) => pct(v, 1), height: 180 });
  el.append(box);
}
