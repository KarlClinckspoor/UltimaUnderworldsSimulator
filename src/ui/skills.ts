// Skills tab: exact odds of every skill_check call site outside combat (plan Part A).
import { gradeCounts, gradeOfRoll, pPass } from '../core/skillcheck';
import { maxWeight, type Character } from '../core/character';
import { armour as ARMOUR, SK, weapons } from '../data/gameData';
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

const CHECKS: Check[] = [
  { id: 'casting', label: 'Casting a spell', where: 'RUNES.C:249', value: (c) => c.skills[SK.Casting] + 5, target: (_, p) => 2 * p,
    param: { label: 'circle', min: 1, max: 8, def: 1 }, effect: '2 or 1: the spell is cast · 0: it fails, no mana spent · -1: backfire (mana spent, circle/2 d8 damage, never below 3 HP). Needs level ≥ 2 × circle − 1 and mana ≥ 3 × circle first.',
    extra: castingTable },
  { id: 'track', label: 'Track (F9) / detect monster', where: 'SKILLS.C use_skill, SPELLS.C:700', value: (c) => c.skills[SK.Track], target: (_, p) => 15 - p,
    param: { label: 'creature noise', min: 0, max: 15, def: 10 }, effect: '> 0: the creature is counted in its direction. One check per creature within 8 squares.' },
  { id: 'lore', label: 'Lore: looking at an item', where: 'INTERACT.C:650', value: (c) => c.skills[SK.Lore], target: () => 10,
    effect: 'Lore level = grade + 1, at least 1 (2 → 3, 1 → 2, 0 and −1 → 1); the best result is kept on the object.', extra: loreLevels },
  { id: 'lore-barter', label: 'Lore: barter (strict side)', where: 'BARTER.C:408', value: (c) => c.skills[SK.Lore], target: () => 20,
    effect: 'One side checks against 20 (lore 1 + [grade > 0]), the other against 15 (lore 1 + grade). Which side is which is not traced.' },
  { id: 'lore-barter15', label: 'Lore: barter (other side)', where: 'BARTER.C:408', value: (c) => c.skills[SK.Lore], target: () => 15, effect: 'Lore level 1 + grade (0..3).' },
  { id: 'look-trigger', label: 'Hidden look trigger', where: 'TRIGGER.C:126', value: (c) => c.skills[SK.Search], target: (_, p) => p,
    param: { label: "trap's z", min: 1, max: 63, def: 8 }, effect: '≤ 0: not triggered. Only look triggers (type 5) with z > 0.' },
  { id: 'detect-trap', label: 'Search: detect a trap', where: 'INTERACT.C:526', value: (c) => c.skills[SK.Search], target: () => 8, effect: '> 0: offers to disarm.' },
  { id: 'disarm', label: 'Traps: disarm', where: 'INTERACT.C:533', value: (c) => c.skills[SK.Traps], target: () => 8, effect: '> 0: removed · 0: unable · −1: set off.' },
  { id: 'remove-trap', label: 'Remove Trap spell', where: 'SPELLS.C:738', value: () => 45, target: () => 8, effect: 'As disarm, with a fixed value of 45.' },
  { id: 'lockpick', label: 'Pick Lock', where: 'USEITEMS.C:1028', value: (c) => c.skills[SK['Pick Lock']], target: (_, p) => 3 * p,
    param: { label: "lock's z", min: 0, max: 15, def: 3 }, effect: '> 0: opens. z 15 never opens; z 14 fails outright below 31, so never with Pick Lock (cap 30).', extra: lockNote },
  { id: 'open-spell', label: 'Open spell', where: 'SPELLS.C:748', value: () => 45, target: (_, p) => 3 * p,
    param: { label: "lock's z", min: 0, max: 15, def: 10 }, effect: '> 0: opens (45 passes the z 14 guard).' },
  { id: 'repair', label: 'Repair at an anvil', where: 'WORLDEV.C:632', value: (c) => c.skills[SK.Repair], target: (_, p) => p,
    param: { label: 'item durability', min: 1, max: 60, def: 5, options: durabilityItems },
    effect: '2: full repair · 1: +3 + skill/5 quality · 0: nothing · −1: destroyed if (rand & 63) > quality + skill, else −(4 + rand & 7) quality.', extra: repairTable },
  { id: 'swim', label: 'Swimming (per tick)', where: 'PLAYTIME.C:201', value: (c) => c.skills[SK.Swimming], target: (_, p) => p,
    param: { label: 'load = weight × 32 / max weight', min: 0, max: 32, def: 4 }, effect: 'grade < 1 adds rollem(3 − grade, 4) to swim_count; drowning damage rollem(2, hurt + 2) with hurt = 2 − grade.', extra: swimNote },
  { id: 'fall', label: 'Acrobat: falling', where: 'PHYSICS.C:432', value: (c) => c.skills[SK.Acrobat], target: (_, p) => 2 * p,
    param: { label: 'fall damage', min: 1, max: 40, def: 5 }, effect: '> 0: damage × (30 − Acrobat) / 30.' },
  { id: 'mana-regen', label: 'Mana regeneration', where: 'PLAYTIME.C:125', value: (c) => c.skills[SK.Mana], target: () => 10, effect: 'mana + grade when grade > 0, every third duration check.' },
  { id: 'hp-regen', label: 'HP regeneration', where: 'PLAYTIME.C:139', value: (c) => c.str, target: () => 15, effect: '> 0: +1 HP, every 24 ticks.' },
  { id: 'mushroom', label: 'Mushroom', where: 'USEITEMS.C:622', value: (c) => c.int, target: () => 20,
    effect: 'The result is tested as a truth value, so every grade except 0 counts (−1 included): then mana + 0..2. A quirk of the original.', extra: mushroomNote },
  { id: 'drunk', label: 'Drink', where: 'USEITEMS.C:694', value: (c) => c.str, target: (_, p) => p, param: { label: 'drunk level', min: 0, max: 63, def: 10 },
    effect: '−1: passes out · 0: short effect · other grades not traced.' },
  { id: 'chargen', label: 'Character creation (one check)', where: 'SKILLS.C:173', value: (_, p) => p, target: () => 20,
    param: { label: 'prime attribute', min: 10, max: 30, def: 20 }, effect: 'Each grade (−1..2) is added to the skill: three checks for a new skill, two for one already held.', extra: chargenDist },
];

const GRADE_COLORS = [C.death, C.flee, C.blue, C.win];
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
    ui.pinned.length ? h('button', { class: 'btn ghost', onclick: () => { ui.pinned = []; rerender(); } }, `Clear ${ui.pinned.length} pinned`) : null);

  const gc = gradeCounts(value, target);
  const gradeCard = card('Grade odds', `skill_check(${value}, ${target}): score = ${value} − ${target} + rand() % 31`);
  const gbar = h('div');
  const scen = [...ui.pinned, { label: 'current', value, target }];
  groupedBars(gbar, GRADE_LABELS, scen.map((s, i) => ({ name: s.label, color: i === scen.length - 1 ? C.accent : C.series[i % C.series.length],
    values: gradeCounts(s.value, s.target).counts.map((x) => x / 31) })), { yfmt: (v) => pct(v, 1), labels: true, yMax: 1 });
  const tbl = h('table', { class: 'mini wide' }, h('tr', {}, ...GRADE_LABELS.map((g) => h('th', {}, g))),
    h('tr', {}, ...gc.counts.map((n) => h('td', {}, `${n}/31 = ${pct(n / 31)}`))));
  gradeCard.append(gbar, tbl, h('p', { class: 'effect' }, h('b', {}, `${chk.label} · ${chk.where}: `), chk.effect));

  // score distribution
  const scoreCard = card('The 31 equally likely scores', 'thresholds at 3, 16 and 29');
  const sc = h('div');
  const scores = Array.from({ length: 31 }, (_, r) => value - target + r);
  stackedBars(sc, scores.map(String), [0, 1, 2, 3].map((g) => ({ name: GRADE_LABELS[g], color: GRADE_COLORS[g],
    values: scores.map((_, r) => (gradeOfRoll(value, target, r) + 1 === g ? 1 / 31 : 0)) })), { height: 180, yfmt: (v) => pct(v, 1),
    tip: (cat, s) => `score ${cat}: ${s.name}` });
  scoreCard.append(sc);

  // P(pass) vs value
  const curveCard = card('P(grade ≥ 1) against the value', `target ${target}; marker at the current value`);
  const cv = h('div');
  const xs = Array.from({ length: 61 }, (_, i) => i - 10);
  lineChart(cv, [...ui.pinned.map((s, i) => ({ name: s.label, color: C.series[i % C.series.length], points: xs.map((x) => [x, pPass(x, s.target)] as [number, number]), dashed: true })),
    { name: 'success or critical', color: C.accent, points: xs.map((x) => [x, pPass(x, target)] as [number, number]) },
    { name: 'critical', color: C.win, points: xs.map((x) => [x, gradeCounts(x, target).counts[3] / 31] as [number, number]) },
    { name: 'failure (−1)', color: C.death, points: xs.map((x) => [x, gradeCounts(x, target).counts[0] / 31] as [number, number]) }],
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
    h('p', { class: 'hint' }, 'Exact odds (n/31), filled in from the character. The combat rolls are on the Combat tab.'), list),
  h('div', { class: 'skills-main' }, ctrls, cards)));
}

function castingTable(c: Character, _p: number, el: HTMLElement) {
  const t = h('table', { class: 'mini wide' }, h('tr', {}, ...['Circle', 'Target', 'Cast', 'Fizzle (0)', 'Backfire (−1)', 'Backfire damage', 'Allowed?'].map((x) => h('th', {}, x))));
  const mm = ((c.skills[SK.Mana] + 1) * c.int) >> 3;
  for (let circle = 1; circle <= 8; circle++) {
    const g = gradeCounts(c.skills[SK.Casting] + 5, 2 * circle).counts;
    const why = [Math.floor((c.level + 1) / 2) < circle ? `level ${2 * circle - 1}` : '', 3 * circle > mm ? `${3 * circle} mana` : ''].filter(Boolean).join(', ');
    t.append(h('tr', {}, h('td', {}, String(circle)), h('td', {}, String(2 * circle)), h('td', {}, pct((g[2] + g[3]) / 31)), h('td', {}, pct(g[1] / 31)),
      h('td', {}, pct(g[0] / 31)), h('td', {}, circle >> 1 ? `${circle >> 1}d8, mean ${(4.5 * (circle >> 1)).toFixed(1)}` : 'none'), h('td', { class: why ? 'warn' : '' }, why ? `needs ${why}` : 'yes')));
  }
  el.append(t, h('p', { class: 'hint' }, 'A critical (2) casts like a success; the self-damage comes from the −1.'));
}
function loreLevels(c: Character, _p: number, el: HTMLElement) {
  const g = gradeCounts(c.skills[SK.Lore], 10).counts;
  el.append(h('p', {}, `Lore level 1: ${pct((g[0] + g[1]) / 31)} · level 2: ${pct(g[2] / 31)} · level 3: ${pct(g[3] / 31)}`));
}
function lockNote(c: Character, p: number, el: HTMLElement) {
  if (p >= 15) el.append(h('p', { class: 'warn' }, 'z 15: never opens.'));
  else if (p === 14) el.append(h('p', { class: 'warn' }, `z 14: fails outright for values below 31, so Pick Lock ${c.skills[SK['Pick Lock']]} never opens it.`));
  else el.append(h('p', {}, `Opens with ${pct(pPass(c.skills[SK['Pick Lock']], 3 * p))} per try.`));
}
function repairTable(c: Character, p: number, el: HTMLElement) {
  const sk = c.skills[SK.Repair];
  const g = gradeCounts(sk, p).counts.map((x) => x / 31);
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
  el.append(h('p', {}, `Max weight ${maxWeight(c)} (STR × 20). Load = weight × 32 / max weight, e.g. carrying half the maximum gives 16.`));
  const t = h('table', { class: 'mini wide' }, h('tr', {}, ...['Load', 'P(no swim_count rise)', 'Expected drowning damage per tick'].map((x) => h('th', {}, x))));
  for (const load of [0, 4, 8, 16, 24, 32]) {
    const g = gradeCounts(c.skills[SK.Swimming], load).counts.map((x) => x / 31);
    // hurt = 2 - grade; damage rollem(2, hurt + 2) when hurt != 0 -> mean 2 * (hurt + 3) / 2
    let ed = 0;
    [-1, 0, 1, 2].forEach((gr, i) => { const hurt = 2 - gr; if (hurt) ed += g[i] * (hurt + 3); });
    t.append(h('tr', {}, h('td', {}, String(load)), h('td', {}, pct(g[2] + g[3])), h('td', {}, fmt(ed, 2))));
  }
  el.append(t);
}
function mushroomNote(c: Character, _p: number, el: HTMLElement) {
  const g = gradeCounts(c.int, 20).counts.map((x) => x / 31);
  el.append(h('p', {}, `As the code reads (any grade but 0): ${pct(1 - g[1])}. As probably intended (grade > 0): ${pct(g[2] + g[3])}.`));
}
function chargenDist(_c: Character, p: number, el: HTMLElement) {
  const g = gradeCounts(p, 20).counts.map((x) => x / 31);
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
