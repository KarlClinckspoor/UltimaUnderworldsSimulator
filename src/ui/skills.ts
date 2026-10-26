// Skills tab: exact odds of every skill_check call site outside combat (plan Part A). The
// catalogue of checks is per game (data/checks.ts); everything here is shared by UW1 and UW2.
import { gradeCounts, gradeProbs, pPass } from '../core/skillcheck';
import { setRandModel } from '../core/randdist';
import type { Character } from '../core/character';
import { CHECKS, TIMING } from '../data/checks';
import { changed, state } from '../state';
import { card, clear, h, numInput, pct, select } from './dom';
import { C, groupedBars, heatmap, lineChart } from './charts';
import { formula, tex } from './formula';
import { withHelp } from './help';
import { renderTimed } from './timedCards';
import type { Check } from './checkTypes';

export const GRADE_COLORS = [C.death, C.flee, C.blue, C.win];
export const GRADE_LABELS = ['−1 critical failure', '0 failure', '1 success', '2 critical success'];

let paramVals: Record<string, number> = {};
const val = (x: string | number) => h('span', { class: 'val' }, String(x));
const tgt = (x: string | number) => h('span', { class: 'tgt' }, String(x));

const ROLL_TEX = String.raw`\begin{gathered}
s = \V{v} - \T{t} + r,\qquad r = \texttt{rand()} \bmod 31,\qquad P(r) = \begin{cases}1058/32768 & r = 0\\ 1057/32768 & r = 1, \dots, 30\end{cases}\\[6pt]
g = \operatorname{check}(\V{v}, \T{t}) = \begin{cases}\phantom{-}2 \text{ critical success} & s \ge 29\\ \phantom{-}1 \text{ success} & 16 \le s \le 28\\ \phantom{-}0 \text{ failure} & 3 \le s \le 15\\ -1 \text{ critical failure} & s \le 2\end{cases}\\[6pt]
P(g \ge 1) = \frac{1}{32768} \sum_{r = \max(0,\ 16 - (\V{v} - \T{t}))}^{30} w_r,\qquad w_0 = 1058,\ w_{1..30} = 1057
\end{gathered}`;
const ROLL_PY = `def rand():                       # Borland C++: a 32-bit LCG, 15 bits out
    global seed
    seed = (seed * 0x015A4E35 + 1) & 0xFFFFFFFF
    return (seed >> 16) & 0x7FFF

def skill_check(value, target):   # SKILLCHK.C
    score = value - target + rand() % 31
    if score > 28: return 2         # critical success
    if score > 15: return 1         # success
    if score > 2:  return 0         # failure
    return -1                       # critical failure

def grade_odds(value, target):     # exact, as the Skills tab shows them
    w = [1058] + [1057] * 30        # draws of rand() % 31 giving r, out of 32768
    odds = {-1: 0, 0: 0, 1: 0, 2: 0}
    for r in range(31):
        s = value - target + r
        g = 2 if s > 28 else 1 if s > 15 else 0 if s > 2 else -1
        odds[g] += w[r] / 32768
    return odds`;

/** Residues r = rand() % 31 that give each grade for d = value - target. */
function residueRanges(d: number) {
  const ranges: [number, number][] = [[0, 2 - d], [3 - d, 15 - d], [16 - d, 28 - d], [29 - d, 30]];
  return ranges.map(([a, b]) => { const lo = Math.max(0, a), hi = Math.min(30, b); return hi < lo ? null : [lo, hi] as [number, number]; });
}

export function renderSkills(root: HTMLElement) {
  clear(root);
  const c = state.character;
  const ui = state.skills;
  const chk = CHECKS.find((k) => k.id === ui.check) ?? CHECKS[0];
  const p = paramVals[chk.id] ?? chk.param?.def ?? 0;
  const autoV = chk.value(c, p), autoT = chk.target(c, p);
  const value = ui.value ?? autoV, target = ui.target ?? autoT;
  const rerender = () => renderSkills(root);
  setRandModel('game');

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
    h('label', { class: 'lab val-lab' }, h('span', {}, 'Value ', h('small', {}, `(${chk.vName}; auto ${autoV})`)), numInput(value, -20, 80, (v) => { ui.value = v; rerender(); }, { class: 'num val-in' })),
    h('label', { class: 'lab tgt-lab' }, h('span', {}, 'Target ', h('small', {}, `(${chk.tName}; auto ${autoT})`)), numInput(target, -20, 100, (v) => { ui.target = v; rerender(); }, { class: 'num tgt-in' })),
    chk.param ? h('label', { class: 'lab' }, h('span', {}, chk.param.label),
      chk.param.options ? select(p, chk.param.options, (v) => { paramVals[chk.id] = v; ui.target = null; rerender(); })
        : numInput(p, chk.param.min, chk.param.max, (v) => { paramVals[chk.id] = v; ui.target = null; ui.value = null; rerender(); })) : null,
    h('button', { class: 'btn ghost', onclick: () => { ui.value = null; ui.target = null; rerender(); } }, 'Use character'),
    h('button', { class: 'btn', title: 'Keep this scenario on the grade odds chart for comparison', onclick: () => { ui.pinned.push({ label: `${chk.label} ${value}/${target}`, value, target }); rerender(); } }, 'Pin scenario'),
    ui.pinned.length ? h('button', { class: 'btn ghost', onclick: () => { ui.pinned = []; rerender(); } }, `Clear ${ui.pinned.length} pinned`) : null);

  const cards = h('div', { class: 'cards' },
    detailsCard(chk, c, p, value, target),
    gradeCard(value, target, ui.pinned),
    curveCard(value, target),
    thresholdCard(chk, value, target),
    heatCard(value, target, (v, t) => { ui.value = v; ui.target = t; rerender(); }));
  if (chk.timed) renderTimed(cards, chk, c, p, value, target, TIMING, rerender);

  root.append(h('div', { class: 'skills-layout' }, h('div', { class: 'catalogue' }, h('h3', {}, 'Every skill check'),
    h('p', { class: 'hint' }, 'Exact odds with the game\'s rand() (counts out of 32768), filled in from the character. The bars show the chance of success or better. The combat rolls are on the Combat tab.'), list),
  h('div', { class: 'skills-main' }, ctrls, cards)));
}

function detailsCard(chk: Check, c: Character, p: number, value: number, target: number) {
  const el = card('Details', h('span', {}, `${chk.label} · ${TIMING.game} ${chk.where}`));
  el.classList.add('span-all', 'details');
  if (chk.about) el.append(h('p', {}, chk.about));
  el.append(h('p', { class: 'this-check' },
    h('b', {}, 'Value '), val(`${chk.vName} = ${value}`), ' · ', h('b', {}, 'Target '), tgt(`${chk.tName} = ${target}`),
    ' · value − target = ', h('b', {}, String(value - target))));
  el.append(h('p', { class: 'effect' }, h('b', {}, 'Outcome: '), chk.effect));
  el.append(formula(chk.tex, chk.py));
  if (chk.timed) el.append(timedInfo(chk));
  for (const n of chk.notes ?? []) el.append(h('p', { class: 'hint' }, n));
  if (chk.extra) { const box = h('div', { class: 'extra' }); chk.extra(c, p, box); el.append(box); }
  const roll = h('details', { class: 'roll' }, h('summary', {}, 'The roll behind every check (skill_check)'),
    h('p', {}, 'Every check here goes through the same function: the value minus the target plus a number from 0 to 30. Only value − target matters, so raising the value by 1 is worth exactly as much as lowering the target by 1. Each step moves one of the 31 residues (about 3.2%) from one grade to the next.'),
    formula(ROLL_TEX, ROLL_PY));
  el.append(roll);
  return el;
}

function timedInfo(chk: Check) {
  const T = TIMING;
  const every = chk.timed === 'mana' ? T.manaEvery : chk.timed === 'hp' ? T.hpEvery : 1;
  const secs = every * T.checkSeconds;
  const gain = chk.timed === 'mana' ? 'a success gives +1 mana and a critical success +2' : chk.timed === 'hp' ? 'a success or critical success gives +1 HP' : 'see the rule above';
  const note = chk.timed === 'mana' ? T.manaNote : chk.timed === 'hp' ? T.hpNote : undefined;
  return h('div', { class: 'timed-info' },
    h('p', {}, h('b', {}, 'When: '), `every ${every === 1 ? '' : `${every}${every === 2 ? 'nd' : every === 3 ? 'rd' : 'th'} `}duration check, i.e. every ${secs >= 120 ? `${secs / 60} minutes` : `${secs} seconds`} of game time; ${gain}.`),
    h('p', { class: 'hint' }, T.source + (note ? ' ' + note : '')),
    tex(String.raw`\Delta t = ${every} \times ${T.checkSeconds}\,\text{s} = ${secs}\,\text{s}`));
}

function gradeCard(value: number, target: number, pinned: { label: string; value: number; target: number }[]) {
  const el = withHelp(card('Grade odds', h('span', {}, 'one roll of skill_check(', val(value), ', ', tgt(target), ')')),
    'Each bar is the chance of one grade on a single roll, with the value and target set above. Pinned scenarios get their own bars next to the current one. The table gives the exact counts out of the 32768 values rand() can return; the line under it says which of the 31 possible rolls r = rand() % 31 land in each grade.');
  const gbar = h('div');
  const scen = [...pinned, { label: 'current', value, target }];
  groupedBars(gbar, GRADE_LABELS, scen.map((s, i) => ({ name: s.label, color: i === scen.length - 1 ? C.accent : C.series[i % C.series.length],
    values: gradeProbs(s.value, s.target) })), { yfmt: (v) => pct(v, 1), labels: true, yMax: 1 });
  const real = gradeCounts(value, target, 'game');
  const tbl = h('table', { class: 'mini wide' }, h('tr', {}, ...GRADE_LABELS.map((g) => h('th', {}, g))),
    h('tr', {}, ...real.counts.map((n) => h('td', {}, `${n}/32768 = ${pct(n / 32768, 3)}`))));
  const rr = residueRanges(value - target);
  const res = h('p', { class: 'hint' }, 'Rolls r = rand() % 31 in each grade: ', ...rr.flatMap((x, i) => [i ? ' · ' : '',
    h('span', { style: `color:${GRADE_COLORS[i]}` }, GRADE_LABELS[i].replace(/^\S+ /, '')), ' ', x ? (x[0] === x[1] ? `r = ${x[0]}` : `r = ${x[0]}..${x[1]}`) : 'none']),
  '. Residue 0 comes up 1058 times in 32768, the others 1057.');
  el.append(gbar, tbl, res);
  return el;
}

function curveCard(value: number, target: number) {
  const el = withHelp(card('P(grade) against the value', h('span', {}, 'target held at ', tgt(target), '; the dotted line is the current value ', val(value))),
    'Across: the value (blue), with the target fixed. Each solid line is the chance of one grade. The dashed lines add grades together: success or better (1 or 2) and failure or worse (0 or −1); those two always sum to 100%. Every point of value moves one of the 31 rolls (about 3.2%) to the next grade up, so the lines are straight ramps between the thresholds at value − target = −14, −1, 3, 16 and 29.');
  const cv = h('div');
  const lo = Math.min(target - 16, value - 2), hi = Math.max(target + 31, value + 2);
  const xs = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const gp = xs.map((x) => gradeProbs(x, target));
  const series = [
    ...GRADE_LABELS.map((name, g) => ({ name, color: GRADE_COLORS[g], points: xs.map((x, i) => [x, gp[i][g]] as [number, number]) })),
    { name: 'success or better', color: C.teal, dashed: '7 4', width: 2.4, points: xs.map((x, i) => [x, gp[i][2] + gp[i][3]] as [number, number]) },
    { name: 'failure or worse', color: C.pink, dashed: '2 4', width: 2.4, points: xs.map((x, i) => [x, gp[i][0] + gp[i][1]] as [number, number]) },
  ];
  lineChart(cv, series, { yDomain: [0, 1], marker: value, xLabel: 'value', yfmt: (v) => pct(v, 0), xClass: 'val', height: 240 });
  el.append(cv, h('ul', { class: 'legend' }, ...series.map((s) => h('li', {},
    h('span', { class: `sw-line ${'dashed' in s ? 'dash' : ''}`, style: `border-color:${s.color}` }), s.name))));
  return el;
}

interface Goal { label: string; d: number | null; pAt: (v: number) => number }
function goals(target: number): Goal[] {
  const first = (f: (d: number) => boolean) => { for (let d = -40; d <= 40; d++) if (f(d)) return d; return null; };
  const P = (v: number) => gradeProbs(v, target);
  return [
    { label: 'critical success possible at all', d: -1, pAt: (v) => P(v)[3] },
    { label: 'no critical failure', d: 3, pAt: (v) => 1 - P(v)[0] },
    { label: 'success or better ≥ 50%', d: first((d) => pPass(d, 0) >= 0.5), pAt: (v) => pPass(v, target) },
    { label: 'success or better ≥ 90%', d: first((d) => pPass(d, 0) >= 0.9), pAt: (v) => pPass(v, target) },
    { label: 'never fails (always success or better)', d: 16, pAt: (v) => pPass(v, target) },
    { label: 'critical success ≥ 50%', d: first((d) => gradeProbs(d, 0)[3] >= 0.5), pAt: (v) => P(v)[3] },
    { label: 'always a critical success', d: 29, pAt: (v) => P(v)[3] },
  ];
}

function thresholdCard(chk: Check, value: number, target: number) {
  const cap = chk.vCap;
  const el = withHelp(card('Threshold values', h('span', {}, 'the lowest value for each goal against target ', tgt(target), cap !== null ? h('span', {}, '; the value stops at ', val(cap)) : null)),
    'Each row is a goal and the lowest value that reaches it against the current target. The roll only depends on value − target, so each goal sits at a fixed distance above the target. The "now" column is the chance for your value, and "at the cap" the chance at the highest value the character can reach: skills and attributes stop at 30 (attributes are set at character creation), so some goals, often an assured critical success, are out of reach.');
  const t = h('table', { class: 'mini wide' }, h('tr', {}, ...['Goal', 'value − target', 'Needs value', `Now (${value})`, cap !== null ? `At the cap (${cap})` : null].filter(Boolean).map((x) => h('th', {}, x!))));
  for (const g of goals(target)) {
    if (g.d === null) continue;
    const need = target + g.d;
    const ok = value >= need;
    const reach = cap === null ? null : cap >= need;
    t.append(h('tr', {}, h('td', {}, g.label), h('td', {}, `≥ ${g.d}`), h('td', { class: 'val' }, `${need}${reach === false ? ' (out of reach)' : ''}`),
      h('td', { class: ok ? 'good' : '' }, `${ok ? '✓ ' : ''}${pct(g.pAt(value), 1)}`),
      cap !== null ? h('td', { class: reach ? 'good' : 'warn' }, pct(g.pAt(cap), 1)) : null));
  }
  el.append(t);
  const pc = gradeProbs(value, target)[3];
  const pcCap = cap !== null ? gradeProbs(cap, target)[3] : null;
  el.append(h('p', { class: 'hint' }, `Critical success: ${pct(pc, 1)} now`, pcCap !== null ? `, ${pct(pcCap, 1)} at most (value ${cap})` : '',
    '. Between value − target = −1 and 29, each extra point of value adds 1057/32768 ≈ 3.2% to it.'));
  return el;
}

function heatCard(value: number, target: number, onPick: (v: number, t: number) => void) {
  const el = withHelp(card('P(success or better): value × target', h('span', {}, 'across ', val('value'), ', up ', tgt('target'), '; click a cell to load it')),
    'Each cell is the chance of success or better (grade ≥ 1) for one value (across, blue) and one target (up, red): dark is unlikely, bright is likely. Cells on the same diagonal share value − target and so have the same odds. The outlined cell is the current pair.');
  const hm = h('div');
  const vs = Array.from({ length: 51 }, (_, i) => i), ts = Array.from({ length: 51 }, (_, i) => i);
  heatmap(hm, vs, ts, (v, t) => pPass(v, t), { xLabel: 'value', yLabel: 'target', mark: [value, target], fmt: (x) => pct(x, 1), onClick: onPick, xClass: 'val', yClass: 'tgt' });
  el.append(hm);
  return el;
}
