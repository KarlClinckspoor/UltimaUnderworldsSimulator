// Character creation tab: what each class comes out with (histograms of attributes and
// skills over every roll and every menu pick), and the odds of a wanted design.
import { CHARGEN_CLASSES, CHARGEN_GAME, type ChargenClass } from '../data/chargenData';
import { SKILLS } from '../data/gameData';
import {
  ATTR_NAMES, attrConditional, attrCorrelation, attrDist, attrHist, bestRoute, designFields, emptyDesign, hpHist, manaHist, menus, only, pDesign, routes,
  skillHist, timesRange, without, type AttrOutcome, type Design, type Route,
} from '../core/chargen';
import { setRandModel } from '../core/randdist';
import { card, clear, h, pct } from './dom';
import { C, heatmap, histogram, lineChart } from './charts';
import { withHelp } from './help';
import { formula } from './formula';

const KEY = `${CHARGEN_GAME.toLowerCase()}sim.chargen.v1`;
interface Ui { cls: number; design: Design }
function load(): Ui {
  try { const s = localStorage.getItem(KEY); if (s) { const u = JSON.parse(s); return { cls: u.cls ?? 0, design: { ...emptyDesign(), ...u.design } }; } } catch { /* storage unavailable */ }
  return { cls: 0, design: emptyDesign() };
}
const ui = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(ui)); } catch { /* ignore */ } };

const attrCache = new Map<number, AttrOutcome[]>();
const routeCache = new Map<number, Route[]>();
const attrsOf = (i: number) => { let a = attrCache.get(i); if (!a) { a = attrDist(CHARGEN_CLASSES[i]); attrCache.set(i, a); } return a; };
const routesOf = (i: number) => { let r = routeCache.get(i); if (!r) { r = routes(CHARGEN_CLASSES[i]); routeCache.set(i, r); } return r; };

const TIMES_COLORS = [C.timeout, C.accent, C.purple, C.pink];
const TIMES_LABEL = ['not taken', 'taken once', 'taken twice', 'taken three times'];
const IMPROBABLE = 0.05, UNLIKELY = 0.25;

const RULE_TEX = String.raw`\begin{gathered}
\textbf{attributes:}\ \ \text{base} + \text{lumps } n = \min(\texttt{rand()}\,\&\,3 + 1,\ \text{left}) \text{ to attribute } \texttt{rand()} \bmod 3,\ \text{none above } 30\\[6pt]
\textbf{skill, first time:}\ \ 3 + \lfloor s/9 \rfloor + \lfloor 3\,\texttt{rand()}/32768 \rfloor + \sum_{i=1}^{3} \operatorname{check}(s, 20)\\[4pt]
\textbf{skill, second time:}\ \ {+}\,1 + \lfloor s/13 \rfloor + \lfloor 2\,\texttt{rand()}/32768 \rfloor + \sum_{i=1}^{2} \operatorname{check}(s, 20),\qquad \text{capped at } 30\\[6pt]
s = \begin{cases}\text{STR} & \text{Attack} \dots \text{Missile}\\ \text{INT} & \text{Mana, Lore, Casting}\\ \text{DEX} & \text{Traps} \dots \text{Swimming}\end{cases}\qquad
\text{max HP} = 30 + \lfloor \text{STR}/5 \rfloor,\qquad \text{max mana} = \lfloor (\text{Mana} + 1)\,\text{INT} / 8 \rfloor
\end{gathered}`;
const RULE_PY = `def roll_stats(cls):                       # CHARGEN.C
    attr = list(cls.base)                    # STR, DEX, INT from SKILLS.DAT
    left = cls.points
    while left > 0:
        n = min((rand() & 3) + 1, left)
        a = rand() % 3
        n = min(n, 30 - attr[a])             # nothing above 30
        attr[a] += n
        left -= n
    return attr

def add_to_skill(skills, skill, attr):        # SKILLS.C
    s = attr[prime(skill)]                   # 0 STR, 1 DEX, 2 INT
    if skills[skill]:                        # already held
        base, div, rolls = 1, 13, 2
    else:
        base, div, rolls = 3, 9, 3
    skills[skill] += base + s // div + rand() * rolls // 0x8000
    for _ in range(rolls):
        skills[skill] += skill_check(s, 20)
    skills[skill] = min(skills[skill], 30)

def prime(skill):                             # Attack..Missile STR, Mana..Casting INT, rest DEX
    return 0 if skill < 7 else 2 if skill < 10 else 1`;

export function renderChargen(root: HTMLElement) {
  clear(root);
  setRandModel('game');
  const cls = CHARGEN_CLASSES[ui.cls] ?? CHARGEN_CLASSES[0];
  const attrs = attrsOf(ui.cls);
  const rerender = () => { save(); renderChargen(root); };

  const picker = h('div', { class: 'row wrap class-picker' }, ...CHARGEN_CLASSES.map((c, i) =>
    h('button', { class: `wld ${i === ui.cls ? 'on' : ''}`, onclick: () => { ui.cls = i; rerender(); } }, c.name)));

  const cards = h('div', { class: 'cards' },
    howCard(cls),
    attributesCard(cls, attrs),
    togetherCard(cls, attrs, rerender),
    skillsCard(cls, attrs),
    designCard(cls, root, rerender));

  root.append(h('div', { class: 'chargen' },
    h('h2', { class: 'cg-title' }, 'Character creation'),
    h('p', { class: 'hint' }, `Exact odds of what each class starts with in ${CHARGEN_GAME}, over every roll and every pick in its skill menus, with the game's rand(). Pick a class:`),
    picker, cards));
}

function entriesList(cls: ChargenClass) {
  return h('ol', { class: 'cg-entries' }, ...cls.entries.map((e) => h('li', {},
    e.length === 0 ? 'nothing' : e.length === 1 ? h('span', {}, h('b', {}, SKILLS[e[0]]), ' (given)') : h('span', {}, 'pick one: ', e.map((s) => SKILLS[s]).join(', ')))));
}

function howCard(cls: ChargenClass) {
  const el = card('How the class is rolled', `${cls.name}: STR ${cls.attrs[0]}, DEX ${cls.attrs[1]}, INT ${cls.attrs[2]} plus ${cls.points} bonus points; five skill entries`);
  el.classList.add('span-all');
  el.append(
    h('p', {}, 'Choosing a class sets the three attributes to the class\'s bases and hands out its bonus points at random, a lump of 1 to 4 at a time to a random attribute (none goes above 30). Then all skills start at 0 and the class\'s five entries are worked through in order: a single skill is given outright, a list is a menu you pick one from. Each time a skill is added it grows by a base, a share of its attribute, a small random bonus and two or three skill checks of the attribute against 20; a skill added a second time (given and then picked, or picked in two menus) grows by the smaller "already held" amount. Answering No to "Keep this character?" starts over with new rolls, as often as you like.'),
    h('p', { class: 'hint' }, `CHARGEN.C (roll_stats, set_sklmnu, set_skills), SKILLS.C (add_to_skill, prime, player_compute); class table from DATA\\SKILLS.DAT.`),
    entriesList(cls),
    h('details', { class: 'roll' }, h('summary', {}, 'The rules as formulas'), formula(RULE_TEX, RULE_PY, { vNames: [], tNames: [] })));
  return el;
}

/** The [lo, hi] range where a histogram has mass. */
function span(hs: ArrayLike<number>[], pad = 0): [number, number] {
  let lo = 99, hi = -1;
  for (const a of hs) for (let v = 0; v < a.length; v++) if (a[v] > 1e-9) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return hi < 0 ? [0, 1] : [Math.max(0, lo - pad), hi + pad];
}
const fromMap = (m: Map<number, number>) => { const n = Math.max(0, ...m.keys()); const a = new Float64Array(n + 1); for (const [k, v] of m) a[k] = v; return a; };
const meanOf = (a: ArrayLike<number>) => { let s = 0; for (let v = 0; v < a.length; v++) s += v * a[v]; return s; };

function mini(title: string | Node, series: { name: string; color: string; values: ArrayLike<number>; opacity?: number }[], note?: string) {
  const [lo, hi] = span(series.map((s) => s.values), 1);
  const box = h('div');
  histogram(box, lo, 1, series.map((s) => ({ name: s.name, color: s.color, opacity: s.opacity, values: Array.from(s.values).slice(lo, hi + 1) })),
    { height: 130, yfmt: (v) => pct(v, 0), overlay: true, centred: true, xfmt: (v) => (Number.isInteger(v) ? String(v) : '') });
  return h('div', { class: 'mini-hist' }, h('div', { class: 'mini-title' }, title),
    note ? h('div', { class: 'mini-note' }, note) : null, box);
}

function attributesCard(cls: ChargenClass, attrs: AttrOutcome[]) {
  const el = withHelp(card('Attributes', `${cls.name} · ${attrs.length} possible STR/DEX/INT combinations`),
    'Each chart is the chance of each value at creation, over every roll of the bonus points. The attributes never change after creation, so this is what the character keeps. Max HP follows STR; max mana follows INT and the Mana skill, so it is drawn once for each number of times the class can take Mana.');
  el.classList.add('span-all');
  const grid = h('div', { class: 'mini-grid' });
  ATTR_NAMES.forEach((n, i) => {
    const a = attrHist(attrs, i);
    grid.append(mini(n, [{ name: n, color: C.accent, values: a }], `base ${cls.attrs[i]} · mean ${meanOf(a).toFixed(1)}`));
  });
  const hp = fromMap(hpHist(attrs));
  grid.append(mini('Max HP', [{ name: 'max HP', color: C.win, values: hp }], `30 + STR / 5 · mean ${meanOf(hp).toFixed(1)}`));
  const { min, max } = timesRange(cls);
  const manaSeries = [];
  for (let k = min[7]; k <= max[7]; k++) manaSeries.push({ name: `Mana ${TIMES_LABEL[k]}`, color: TIMES_COLORS[k], values: fromMap(manaHist(attrs, k)), opacity: 0.55 });
  grid.append(mini('Max mana', manaSeries, manaSeries.map((s) => `${s.name.replace('Mana ', '')}: mean ${meanOf(s.values).toFixed(1)}`).join(' · ')));
  el.append(grid);
  const lg = legend(min[7], max[7]);
  if (lg) el.append(lg);
  return el;
}

let condAttr = 0;
function togetherCard(cls: ChargenClass, attrs: AttrOutcome[], rerender: () => void) {
  const total = cls.attrs[0] + cls.attrs[1] + cls.attrs[2] + cls.points;
  const r = attrCorrelation(attrs);
  const el = withHelp(card('Attributes together', `STR + DEX + INT is always ${total} for a ${cls.name} (${cls.attrs.join(' + ')} + ${cls.points} bonus points)`),
    'The bonus points are shared out among the three attributes, so the three always add up to the same total and are not independent: every point one gets is a point the other two do not. Left: every STR/DEX outcome, coloured by its chance, with INT fixed by the other two (the diagonals). Right: pick an attribute; for each value it can take, the lines show what the other two average (solid) and their 10th to 90th percentile (dashed). The chances in the "desired stats" form already account for this.');
  el.classList.add('span-all');
  const pair = (i: number, j: number) => `${ATTR_NAMES[i]}–${ATTR_NAMES[j]} ${r[i][j].toFixed(2)}`;
  el.append(h('p', {}, 'Correlations: ', h('b', {}, [pair(0, 1), pair(0, 2), pair(1, 2)].join(' · ')),
    '. A correlation of −0.5 between each pair is what an even share of a fixed total gives; the 30 cap and the uneven rand() % 3 move it a little.'));
  // joint STR x DEX
  const joint = new Map<string, number>();
  let pmax = 0;
  for (const o of attrs) { const k = `${o.a[0]},${o.a[1]}`; const v = (joint.get(k) ?? 0) + o.p; joint.set(k, v); pmax = Math.max(pmax, v); }
  const rng = (i: number) => { let lo = 99, hi = 0; for (const o of attrs) { lo = Math.min(lo, o.a[i]); hi = Math.max(hi, o.a[i]); } return Array.from({ length: hi - lo + 1 }, (_, k) => lo + k); };
  const xs = rng(0), ys = rng(1);
  const left = h('div');
  heatmap(left, xs, ys, (x, y) => joint.get(`${x},${y}`) ?? 0, {
    xLabel: 'STR', yLabel: 'DEX', max: pmax, skipZero: true, tickEvery: 2, height: 280,
    tip: (x, y, v) => `STR ${x}, DEX ${y}, INT ${total - x - y}: ${pctS(v)}`,
    after: (svg, x, y) => {
      const ints = attrs.map((o) => o.a[2]);
      const i0 = Math.min(...ints), i1 = Math.max(...ints);
      for (let int = i0 + ((i1 - i0) % 2); int <= i1; int += 2) {
        const pts = xs.filter((xv) => joint.has(`${xv},${total - int - xv}`));
        if (pts.length < 2) continue;
        const cx = (v: number) => x(v)! + x.bandwidth() / 2, cy = (v: number) => y(v)! + y.bandwidth() / 2;
        const a = pts[0], b = pts[pts.length - 1];
        svg.append('line').attr('class', 'iso').attr('x1', cx(a)).attr('y1', cy(total - int - a)).attr('x2', cx(b)).attr('y2', cy(total - int - b));
        svg.append('text').attr('class', 'iso-label').attr('x', cx(b) + x.bandwidth() / 2 + 2).attr('y', cy(total - int - b) + 3).text(`INT ${int}`);
      }
    },
  });
  // conditional means
  const right = h('div');
  const cond = attrConditional(attrs, condAttr);
  const cols = [C.accent, C.purple, C.win];
  const series = cond[0].others.flatMap((o, k) => [
    { name: `${ATTR_NAMES[o.j]} mean`, color: cols[k], points: cond.map((c) => [c.v, c.others[k].mean] as [number, number]) },
    { name: `${ATTR_NAMES[o.j]} 10th`, color: cols[k], dashed: '3 3', width: 1.2, points: cond.map((c) => [c.v, c.others[k].lo] as [number, number]) },
    { name: `${ATTR_NAMES[o.j]} 90th`, color: cols[k], dashed: '3 3', width: 1.2, points: cond.map((c) => [c.v, c.others[k].hi] as [number, number]) },
  ]);
  lineChart(right, series, { xLabel: `${ATTR_NAMES[condAttr]} rolled`, yLabel: 'the other two', height: 250, yfmt: (v) => v.toFixed(0) });
  const pick = h('div', { class: 'row class-picker' }, h('span', { class: 'muted' }, 'If I roll this much'), ...ATTR_NAMES.map((n, i) =>
    h('button', { class: `wld ${i === condAttr ? 'on' : ''}`, onclick: () => { condAttr = i; rerender(); } }, n)));
  el.append(h('div', { class: 'cg-two' },
    h('div', {}, h('div', { class: 'mini-title' }, 'Every STR / DEX outcome (INT on the diagonals)'), left),
    h('div', {}, pick, right, h('ul', { class: 'legend' }, ...cond[0].others.map((o, k) => h('li', {}, h('span', { class: 'sw-line', style: `border-color:${cols[k]}` }), `${ATTR_NAMES[o.j]}: mean, dashed 10th–90th percentile`))))));
  return el;
}

function legend(lo: number, hi: number) {
  const items = [];
  for (let k = Math.max(lo, 0); k <= hi; k++) items.push(h('li', {}, h('span', { class: 'sw', style: `background:${TIMES_COLORS[k]};opacity:.7` }), TIMES_LABEL[k]));
  return items.length > 1 ? h('ul', { class: 'legend' }, ...items) : null;
}

function skillsCard(cls: ChargenClass, attrs: AttrOutcome[]) {
  const { min, max } = timesRange(cls);
  const el = withHelp(card('Skills', `${cls.name} · every skill the class can get, by how many times it is added`),
    'One chart per skill this class can end up with. A skill given outright is always there; a skill in a menu only if you pick it. When a skill can be added twice (given and picked again, or picked in two menus) both cases are drawn on top of each other, semi-transparent: the second add is smaller, so the two humps overlap. Skills the class cannot get start at 0.');
  el.classList.add('span-all');
  const grid = h('div', { class: 'mini-grid' });
  let anyTwice = false;
  for (let s = 0; s < SKILLS.length; s++) {
    if (!max[s]) continue;
    const series = [];
    for (let k = Math.max(1, min[s]); k <= max[s]; k++) series.push({ name: TIMES_LABEL[k], color: TIMES_COLORS[k], values: skillHist(attrs, s, k), opacity: max[s] > Math.max(1, min[s]) ? 0.55 : 1 });
    if (series.length > 1) anyTwice = true;
    const how = min[s] ? (max[s] > min[s] ? `given, can be picked again` : 'given') : max[s] > 1 ? 'in two menus' : 'in a menu';
    const attr = ATTR_NAMES[s < 7 ? 0 : s < 10 ? 2 : 1];
    grid.append(mini(h('span', {}, SKILLS[s], h('small', {}, ` ${how} · ${attr}`)), series, series.map((x) => `${x.name}: mean ${meanOf(x.values).toFixed(1)}`).join(' · ')));
  }
  el.append(grid);
  if (anyTwice) el.append(h('ul', { class: 'legend' }, ...[1, 2].map((k) => h('li', {}, h('span', { class: 'sw', style: `background:${TIMES_COLORS[k]};opacity:.7` }), TIMES_LABEL[k]))));
  const none = SKILLS.filter((_, s) => !max[s]);
  if (none.length) el.append(h('p', { class: 'hint' }, `Not available to the ${cls.name} at creation (they start at 0): ${none.join(', ')}.`));
  return el;
}

// ---- the design

type Field = { kind: 'attr' | 'hp' | 'mana' | 'skill'; i: number };
const fieldName = (f: Field) => (f.kind === 'attr' ? ATTR_NAMES[f.i] : f.kind === 'hp' ? 'Max HP' : f.kind === 'mana' ? 'Max mana' : SKILLS[f.i]);
const getV = (d: Design, f: Field) => (f.kind === 'attr' ? d.attrs[f.i] : f.kind === 'hp' ? d.hp : f.kind === 'mana' ? d.mana : d.skills[f.i]);
function setV(d: Design, f: Field, v: number | null) {
  if (f.kind === 'attr') d.attrs[f.i] = v; else if (f.kind === 'hp') d.hp = v; else if (f.kind === 'mana') d.mana = v; else d.skills[f.i] = v;
}
const fkey = (f: Field) => `${f.kind}${f.i}`;
const tries = (p: number) => (p <= 0 ? 'never' : p >= 0.9995 ? '1' : 1 / p < 1e6 ? `${Math.round(1 / p).toLocaleString()}` : `${(1 / p).toExponential(1)}`);
const pctS = (p: number) => (p <= 0 ? '0%' : p < 1e-4 ? `${(100 * p).toExponential(1)}%` : p < 0.01 ? pct(p, 3) : pct(p, 1));
const level = (p: number) => (p <= 0 ? 'impossible' : p < IMPROBABLE ? 'improbable' : p < UNLIKELY ? 'unlikely' : '');

function designCard(cls: ChargenClass, _root: HTMLElement, rerender: () => void) {
  const el = withHelp(card('Desired stats on creation', 'type the lowest value you would accept; leave a field empty if you do not mind'),
    `The probability that one roll of the class meets every minimum at once (that value or higher), with the best picks in the menus. A field is marked red when it is improbable (under ${IMPROBABLE * 100}%) on its own, or when it is the one dragging the design down: dropping it would make the whole design more than 20 times likelier. Orange marks under ${UNLIKELY * 100}%. Because you can answer No and roll again, the expected number of tries is 1 / probability. The table at the bottom compares every class for the same design.`);
  el.classList.add('span-all');
  const inputs = new Map<string, HTMLInputElement>();
  const notes = new Map<string, HTMLElement>();
  const out = h('div', { class: 'cg-result' });
  const classes = h('div');
  const { max } = timesRange(cls);

  const field = (f: Field, maxV: number, extra?: string) => {
    const v = getV(ui.design, f);
    const inp = h('input', { type: 'number', min: 0, max: maxV, step: 1, class: 'num cg-in', placeholder: '–', value: v === null ? '' : String(v) }) as HTMLInputElement;
    inp.addEventListener('input', () => {
      const t = inp.value.trim();
      const n = t === '' ? null : Math.max(0, Math.min(maxV, Math.round(Number(t))));
      setV(ui.design, f, Number.isFinite(n as number) || n === null ? n : null);
      schedule();
    });
    inputs.set(fkey(f), inp);
    const note = h('small', { class: 'cg-note' });
    notes.set(fkey(f), note);
    const unavailable = f.kind === 'skill' && !max[f.i];
    return h('label', { class: `cg-field ${unavailable ? 'na' : ''}`, title: unavailable ? `${cls.name}s cannot take ${SKILLS[f.i]} at creation` : extra ?? '' },
      h('span', {}, fieldName(f)), inp, note);
  };
  const attrRow = h('div', { class: 'cg-fields' }, ...[0, 1, 2].map((i) => field({ kind: 'attr', i }, 30)),
    field({ kind: 'hp', i: 0 }, 36, '30 + STR / 5'), field({ kind: 'mana', i: 0 }, 100, '(Mana + 1) × INT / 8'));
  const skillRow = h('div', { class: 'cg-fields' }, ...SKILLS.map((_, i) => field({ kind: 'skill', i }, 30)));
  const clearBtn = h('button', { class: 'btn ghost', onclick: () => { ui.design = emptyDesign(); rerender(); } }, 'Clear');
  el.append(h('h4', { class: 'cg-h' }, 'Attributes'), attrRow, h('h4', { class: 'cg-h' }, 'Skills'), skillRow, h('div', { class: 'row' }, clearBtn), out, classes);

  let timer = 0;
  function schedule() { clearTimeout(timer); timer = window.setTimeout(update, 120); }
  function update() {
    save();
    const d = ui.design;
    const attrs = attrsOf(ui.cls);
    const rs = routesOf(ui.cls);
    const fields = designFields(d) as Field[];
    for (const [k, inp] of inputs) { inp.classList.remove('improbable', 'unlikely'); notes.get(k)!.textContent = ''; void inp; }
    clear(out); clear(classes);
    if (!fields.length) { out.append(h('p', { class: 'hint' }, 'Type a minimum in any field to see the odds.')); return; }
    const best = bestRoute(cls, attrs, d, rs);
    const ms = menus(cls);
    // which picks reach the best probability, menu by menu
    const good = ms.map(() => new Set<number>());
    const pr = new Map<string, number>();
    for (const r of rs) {
      const key = r.counts.join(',');
      let p = pr.get(key);
      if (p === undefined) { p = pDesign(attrs, r.counts, d); pr.set(key, p); }
      if (best.p > 0 && p >= best.p * (1 - 1e-9)) r.picks.forEach((s, m) => good[m].add(s));
    }
    out.append(h('p', { class: 'cg-big' }, h('b', { class: level(best.p) }, pctS(best.p)), ` chance that one roll of a ${cls.name} meets every minimum`,
      best.p > 0 ? ` · about ${tries(best.p)} tr${tries(best.p) === '1' ? 'y' : 'ies'} on average` : ''));
    if (best.p <= 0) {
      const alone = fields.map((f) => bestRoute(cls, attrs, only(d, f), rs).p);
      if (alone.every((p) => p > 0)) out.append(h('p', { class: 'improbable' }, 'Each minimum is possible on its own, but no single set of menu picks reaches them all: some of these skills share a menu, or a skill needs to be taken more times than the menus allow.'));
    }
    if (best.p > 0) out.append(h('p', {}, 'Best picks: ', ...ms.flatMap((m, i) => [i ? ' · ' : '', `menu ${cls.entries.indexOf(m) + 1}: `,
      h('b', {}, good[i].size === m.length ? 'any' : [...good[i]].map((s) => SKILLS[s]).join(' or '))])));
    const t = h('table', { class: 'mini wide' }, h('tr', {}, ...['Field', 'At least', 'Alone', 'Everything else', 'Effect of this field'].map((x) => h('th', {}, x))));
    for (const f of fields) {
      const alone = bestRoute(cls, attrs, only(d, f), rs).p;
      const rest = bestRoute(cls, attrs, without(d, f), rs).p;
      const factor = rest > 0 ? best.p / rest : 0;
      const lv = alone <= 0 ? 'impossible' : alone < IMPROBABLE || factor < IMPROBABLE ? 'improbable' : alone < UNLIKELY || factor < UNLIKELY ? 'unlikely' : '';
      const inp = inputs.get(fkey(f))!;
      if (lv) inp.classList.add(lv === 'unlikely' ? 'unlikely' : 'improbable');
      const note = notes.get(fkey(f))!;
      note.textContent = pctS(alone);
      note.className = `cg-note ${lv}`;
      t.append(h('tr', { class: lv ? `row-${lv}` : '' }, h('td', {}, fieldName(f)), h('td', {}, String(getV(d, f))), h('td', { class: lv && alone < UNLIKELY ? lv : '' }, pctS(alone)),
        h('td', {}, pctS(rest)), h('td', { class: lv && factor < UNLIKELY ? lv : '' }, rest > 0 ? (factor >= 0.9995 ? 'none' : `× ${factor < 0.01 ? factor.toExponential(1) : factor.toFixed(2)}`) : '–')));
    }
    out.append(t, h('p', { class: 'hint' }, '"Alone" is the chance of this minimum by itself (with the best picks for it); "Everything else" the chance of the design without it; "Effect" how much this field multiplies the whole design\'s chance.'));
    // every class
    const ct = h('table', { class: 'mini wide cg-classes' }, h('tr', {}, ...['Class', 'Chance', 'Tries on average', 'Best picks'].map((x) => h('th', {}, x))));
    const rows = CHARGEN_CLASSES.map((c, i) => ({ c, i, e: bestRoute(c, attrsOf(i), d, routesOf(i)) })).sort((a, b) => b.e.p - a.e.p);
    for (const r of rows) ct.append(h('tr', { class: r.i === ui.cls ? 'on' : '', style: 'cursor:pointer', onclick: () => { ui.cls = r.i; rerender(); } },
      h('td', {}, r.c.name), h('td', { class: level(r.e.p) }, pctS(r.e.p)), h('td', {}, tries(r.e.p)),
      h('td', { class: 'muted' }, r.e.p > 0 ? r.e.route.picks.map((s) => SKILLS[s]).join(', ') : '–')));
    classes.append(h('h4', { class: 'cg-h' }, 'The same design for every class'), ct, h('p', { class: 'hint' }, 'Click a class to switch to it. Best picks shows one route that reaches the best chance.'));
  }
  update();
  return el;
}
