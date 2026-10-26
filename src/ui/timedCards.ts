// Time-based checks (HP and mana regeneration, drowning): how long to full (or to 0 HP),
// as an exact distribution, and the value over time with its 50 / 65 / 95% ranges.
import type { Character } from '../core/character';
import { derive } from '../core/character';
import { BAND_LEVELS, doneStats, drowning, hpGain, manaGain, regen, type TimedResult } from '../core/timed';
import { card, h, numInput, pct } from './dom';
import { C, fanChart, histogram } from './charts';
import { withHelp } from './help';
import type { Check, GameTiming } from './checkTypes';

const ui: Record<string, { start?: number; max?: number; span?: number }> = {};

export const fmtMin = (m: number) => (m < 1 ? `${Math.round(m * 60)} s` : m < 120 ? `${Math.round(m * 10) / 10} min` : m < 48 * 60 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} days`);

/** One unit for a whole time axis, so the ticks fall on round numbers. */
const axisUnit = (maxMin: number) => (maxMin > 240 ? { div: 60, name: 'hours' } : maxMin < 3 ? { div: 1 / 60, name: 'seconds' } : { div: 1, name: 'minutes' });

export function renderTimed(cards: HTMLElement, chk: Check, c: Character, _p: number, value: number, target: number, T: GameTiming, rerender: () => void) {
  const kind = chk.timed!;
  const d = derive(c);
  const st = (ui[kind] ??= {});
  const every = kind === 'mana' ? T.manaEvery : kind === 'hp' ? T.hpEvery : 1;
  const stepMin = (every * T.checkSeconds) / 60;
  const unit = kind === 'mana' ? 'mana' : 'HP';
  const maxDef = kind === 'mana' ? d.maxMana : d.maxHp;
  const max = Math.max(1, st.max ?? maxDef);
  const start = Math.max(0, Math.min(max, st.start ?? (kind === 'mana' ? 0 : kind === 'hp' ? 1 : max)));
  const spanDef = kind === 'hp' ? 12 * 60 : 60;
  const span = st.span ?? spanDef;
  const horizon = Math.max(1, Math.ceil(span / stepMin));

  let res: TimedResult;
  let pOver: number[] | null = null;
  if (kind === 'drown') {
    const r = drowning(value, target, start, horizon);
    res = r; pOver = r.pOver;
  } else {
    const inc = kind === 'mana' ? manaGain(value) : hpGain(value);
    res = regen(start, max, inc, horizon);
  }

  const ctrl = h('div', { class: 'row wrap ctrls' },
    h('label', { class: 'lab' }, h('span', {}, kind === 'drown' ? 'HP on entering the water' : `Starting ${unit}`), numInput(start, 0, 255, (v) => { st.start = v; rerender(); })),
    kind === 'drown' ? null : h('label', { class: 'lab' }, h('span', {}, `Maximum ${unit} (character ${maxDef})`), numInput(max, 1, 255, (v) => { st.max = v; rerender(); })),
    h('label', { class: 'lab' }, h('span', {}, 'Chart span (game minutes)'), numInput(span, 1, 7 * 1440, (v) => { st.span = v; rerender(); })),
    h('button', { class: 'btn ghost', onclick: () => { delete ui[kind]; rerender(); } }, 'Reset'));

  // ---- time to the goal
  const s = doneStats(res.pDone);
  const hist = withHelp(card(kind === 'drown' ? 'Time to drown' : `Time to full ${unit}`,
    h('span', {}, `from ${start} ${kind === 'drown' ? 'HP' : `to ${max} ${unit}`}, one roll every ${fmtMin(stepMin)} · `, h('span', { class: 'val' }, `${chk.vName} ${value}`), ' vs ', h('span', { class: 'tgt' }, /^\d+$/.test(chk.tName) ? String(target) : `${chk.tName} ${target}`))),
    `The chance that ${kind === 'drown' ? 'you reach 0 HP' : `${unit} reaches its maximum`} at each roll, counted from a roll: the first roll comes ${fmtMin(stepMin)} after the start (in the game the first roll comes anywhere from 0 to ${fmtMin(stepMin)} in, so shift times down by half a step on average). The bars add up to 100% when the goal is certain. Dotted lines mark the median and the 95th percentile.`);
  hist.classList.add('span-all');
  hist.append(ctrl);
  if (res.pDone[0] >= 1) hist.append(h('p', {}, kind === 'drown' ? 'Starting at 0 HP.' : `Already at full ${unit}.`));
  else if (!res.possible) hist.append(h('p', { class: 'warn' }, kind === 'drown'
    ? `Never: a ${chk.vName} of ${value} against load ${target} always rolls a critical success, so swim_count never rises and the second roll never hurts.`
    : `Never: a ${chk.vName} of ${value} against ${target} cannot roll a success.`));
  else {
    const line = h('p', {}, `Median ${s.median === null ? 'beyond the computed range' : fmtMin(s.median * stepMin)}`,
      s.q05 !== null ? ` · 5%: ${fmtMin(s.q05 * stepMin)}` : '', s.q95 !== null ? ` · 95%: ${fmtMin(s.q95 * stepMin)}` : '',
      s.mean !== null ? ` · mean ${fmtMin(s.mean * stepMin)}` : '', ` · ${pct(res.reached, 2)} within ${fmtMin((res.pDone.length - 1) * stepMin)}.`);
    hist.append(line);
    if (pOver) {
      const k = pOver.findIndex((x) => x >= 0.5);
      hist.append(h('p', { class: 'hint' }, `swim_count passes 0x78 (damage starts) after a median of ${k < 0 ? 'more than the span' : fmtMin(k * stepMin)}; until then the water does no harm.`));
    }
    // bins: one per roll, merged when there are many
    const kEnd = res.pDone.findIndex((x) => x >= 0.9995);
    const K = kEnd > 0 ? kEnd : res.pDone.length - 1;
    const group = Math.max(1, Math.ceil(K / 120));
    const vals: number[] = [];
    for (let b = 0; b * group < K; b++) {
      const k0 = b * group, k1 = Math.min(K, (b + 1) * group);
      vals.push(res.pDone[k1] - res.pDone[k0]);
    }
    const box = h('div');
    const ax = axisUnit(K * stepMin);
    histogram(box, 0, group * stepMin / ax.div, [{ name: kind === 'drown' ? 'drowned' : 'full', color: kind === 'drown' ? C.death : C.win, values: vals }],
      { yfmt: (v) => pct(v, 1), xLabel: `game time (${ax.name})`, height: 200,
        marks: [s.median !== null ? { x: s.median * stepMin / ax.div, label: 'median' } : null, s.q95 !== null ? { x: s.q95 * stepMin / ax.div, label: '95%' } : null].filter(Boolean) as { x: number; label: string }[] });
    hist.append(box);
  }
  cards.append(hist);

  // ---- the value over time
  if (res.possible || kind !== 'drown') {
    const done = (b: { q: Record<string, number> }) => (kind === 'drown' ? b.q[0.975] <= 0 : b.q[0.025] >= max);
    let n = res.bands.findIndex(done);
    n = n < 0 ? res.bands.length : n + 1;
    const bands = res.bands.slice(0, Math.max(2, n));
    const xsMin = bands.map((b) => b.t * stepMin);
    const ax = axisUnit(xsMin[xsMin.length - 1]);
    const xs = xsMin.map((m) => m / ax.div);
    const qs = (lv: number) => bands.map((b) => b.q[lv]);
    const fan = withHelp(card(kind === 'drown' ? 'HP while swimming' : `${unit === 'HP' ? 'HP' : 'Mana'} over time`,
      `median, mean and 50 / 65 / 95% ranges · up to ${fmtMin(xsMin[xsMin.length - 1])}${n <= res.bands.length ? (kind === 'drown' ? ' (97.5% have drowned)' : ' (97.5% are full)') : ` (the span you set)`}`),
      `Across: game time. The solid line is the median ${unit}, the dashed line the mean; the shaded bands hold the middle 50%, 65% and 95% of outcomes (between the 25th and 75th, 17.5th and 82.5th, and 2.5th and 97.5th percentiles). The chart stops when 97.5% of runs ${kind === 'drown' ? 'have drowned' : 'are full'}, or at the span you set. ${kind === 'hp' ? 'HP is rolled only every 10 minutes, so the span starts at 12 hours.' : ''}`);
    fan.classList.add('span-all');
    const box = h('div');
    fanChart(box, xs, [
      { lo: qs(0.025), hi: qs(0.975), label: '95%', opacity: 0.16 },
      { lo: qs(0.175), hi: qs(0.825), label: '65%', opacity: 0.2 },
      { lo: qs(0.25), hi: qs(0.75), label: '50%', opacity: 0.26 },
    ], qs(0.5), bands.map((b) => b.mean), { color: kind === 'drown' ? C.death : C.accent, yMax: max, ref: kind === 'drown' ? undefined : { y: max, label: `max ${max}` },
      tipFmt: (x) => fmtMin(x * ax.div), xLabel: `game time (${ax.name})`, yLabel: unit, height: 250 });
    fan.append(box, h('ul', { class: 'legend' },
      h('li', {}, h('span', { class: 'sw-line', style: `border-color:${kind === 'drown' ? C.death : C.accent}` }), 'median'),
      h('li', {}, h('span', { class: 'sw-line dash', style: 'border-color:var(--text)' }), 'mean'),
      ...['50%', '65%', '95%'].map((l, i) => h('li', {}, h('span', { class: 'sw', style: `background:${kind === 'drown' ? C.death : C.accent};opacity:${[0.55, 0.4, 0.25][i]}` }), `middle ${l}`))));
    cards.append(fan);
  }
  void BAND_LEVELS;
}
