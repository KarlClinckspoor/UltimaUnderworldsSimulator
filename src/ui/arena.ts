// The Combat tab's Arena (plan Part C): every monster against every other, a Melee and a Ranged ladder.
import * as d3 from 'd3';
import { creatures, itemName, resistOf as resistOfId } from '../data/gameData';
import { defaultDuelSettings, entrantProfile, type DuelSettings, type DuelStats } from '../combat/duel';
import { runJobs, type RunHandle } from '../combat/pool';
import type { DuelJob } from '../combat/worker';
import { wilson } from '../combat/stats';
import {
  ARENA_ENGINE, arenaEntrants, entrantLabel, namedOf, pairFromStats, pairN, rangedLeftOut, rate, unpackRun,
  type ArenaRun, type EntrantSummary, type PackedRun, type PairRec,
} from '../arena/arena';
import { expected, upsets, type RatingResult, type Scoring } from '../arena/rating';
import { changed, defaultArena, state, type ArenaUi } from '../state';
import { card, clear, fmt, h, numInput, pct, select, toggle } from './dom';
import { C, chart, histogram, shareBar } from './charts';

let running: RunHandle<DuelStats> | null = null;
let reference: Record<'melee' | 'ranged', ArenaRun> | null = null;
let referenceLoading: Promise<void> | null = null;
const live: Partial<Record<'melee' | 'ranged', ArenaRun>> = {};

/** What a run depends on; the reference also stands for any N (it is the same thing measured more precisely). */
const runKey = (r: Pick<ArenaRun, 'mode' | 'n' | 'seed' | 'rand' | 'settings'> & { powerful: boolean }, withN = true) =>
  JSON.stringify([r.mode, withN ? r.n : 0, r.seed, r.rand, r.settings.hpMode, r.settings.timeLimit, r.mode === 'ranged' ? r.settings.distance : 0, r.powerful]);
const runPowerful = (r: ArenaRun) => r.entrants.some((e) => e.powerful);

function wanted(u: ArenaUi) {
  const settings: DuelSettings = { ...defaultDuelSettings(u.mode), hpMode: u.hpMode, timeLimit: u.timeLimit, distance: u.distance };
  const n = u.mode === 'melee' ? u.nMelee : u.nRanged;
  return { mode: u.mode, n, seed: u.seed, rand: u.rand, settings, powerful: u.powerful };
}

function loadReference(rerender: () => void) {
  if (reference || referenceLoading) return;
  referenceLoading = import('../data/arena.json').then((m) => {
    const raw = (m.default ?? m) as unknown as Record<'melee' | 'ranged', PackedRun>;
    reference = { melee: unpackRun(raw.melee), ranged: unpackRun(raw.ranged) };
    rerender();
  });
}

const RES_BITS: [number, string][] = [[0x80, 'undead'], [0x08, 'fire'], [0x20, 'cold'], [0x10, 'poison'], [0x40, 'missiles'], [0x04, 'physical']];
function resistText(res: number) {
  const parts = RES_BITS.filter(([b]) => res & b).map(([, n]) => n);
  if (res & 3) parts.push(`magic ${res & 3}/3`);
  return parts.join(', ');
}

export function renderArena(root: HTMLElement, rerender: () => void) {
  const u = state.arena;
  const set = (f: () => void) => { f(); changed('arena'); rerender(); };
  loadReference(rerender);
  const want = wanted(u);
  const wantKey = runKey(want);
  const ref = reference?.[u.mode] ?? null;
  const refStale = ref && ref.engine !== ARENA_ENGINE;
  const liveRun = live[u.mode];
  let run: ArenaRun | null = null, mismatch = false;
  if (liveRun && runKey({ ...liveRun, powerful: runPowerful(liveRun) }) === wantKey) run = liveRun;
  else if (ref && runKey({ ...ref, powerful: false }, false) === runKey(want, false)) run = ref;
  else { run = liveRun ?? ref; mismatch = !!run; }

  // ---- controls
  const modeTabs = h('div', { class: 'world-tabs arena-modes' },
    ...(['melee', 'ranged'] as const).map((m) => h('button', { class: `wld ${u.mode === m ? 'on' : ''}`, onclick: () => set(() => { u.mode = m; u.sel = ''; }) },
      m === 'melee' ? 'Melee rating' : 'Ranged rating')));
  const ctrls = h('div', { class: 'ctrl-grid' },
    lab('Fights per pair', numInput(want.n, 10, 20000, (v) => set(() => { if (u.mode === 'melee') u.nMelee = v; else u.nRanged = v; }))),
    lab('Monster HP', select(u.hpMode, [['roll', 'rolled fresh each fight'], ['avg', 'exactly its average']], (v) => set(() => (u.hpMode = v)))),
    u.mode === 'ranged' ? lab('Distance (tiles)', numInput(u.distance, 2, 7, (v) => set(() => (u.distance = v)))) : null,
    lab('Time limit (s)', numInput(u.timeLimit, 10, 600, (v) => set(() => (u.timeLimit = v)))),
    lab('Random numbers', select(u.rand, [['game', "the game's rand()"], ['ideal', 'ideal (uniform)']], (v) => set(() => (u.rand = v)))),
    lab('Seed', numInput(u.seed, 0, 2 ** 31 - 1, (v) => set(() => (u.seed = v)))),
    toggle('Powerful variants', u.powerful, (v) => set(() => (u.powerful = v)), 'add a powerful copy of every type (+7..12 to hit, +4..15 damage, armour ×5/3)'),
  );
  const scoring = h('div', { class: 'row wrap all-ctrls' },
    lab('Fleeing counts as', select(u.flee, [['loss', 'a loss for the one who fled'], ['draw', 'a draw']], (v) => set(() => (u.flee = v)))),
    lab('A timeout counts as', select(u.timeout, [['draw', 'a draw'], ['ignore', 'nothing (left out)']], (v) => set(() => (u.timeout = v)))),
    h('button', { class: 'btn ghost', title: 'back to the settings of the reference run', onclick: () => set(() => { const d = defaultArena(); Object.assign(u, { ...d, view: 'arena', mode: u.mode }); }) }, 'Reset'));

  const progress = h('div', { class: 'progress' }, h('i'));
  const progText = h('span', { class: 'prog-text' });
  const runBtn = h('button', { class: 'btn primary' }, 'Run round robin');
  const cancelBtn = h('button', { class: 'btn ghost', disabled: true }, 'Cancel');
  const setRunning = (on: boolean) => { runBtn.disabled = on; cancelBtn.disabled = !on; if (!on) progress.classList.remove('on'); };
  cancelBtn.onclick = () => { running?.cancel(); running = null; setRunning(false); progText.textContent = 'Cancelled.'; };
  runBtn.onclick = async () => {
    const entrants = arenaEntrants(want.mode, want.powerful);
    const profs = entrants.map((e) => entrantProfile(e, creatures));
    const idx: [number, number][] = [];
    for (let i = 0; i < entrants.length; i++) for (let j = i + 1; j < entrants.length; j++) idx.push([i, j]);
    const jobs: DuelJob[] = idx.map(([i, j], k) => ({ kind: 'duel', key: `${i}-${j}`, A: profs[i], B: profs[j], S: want.settings, rand: want.rand,
      n: want.n, seed: want.seed, stream: k, streams: idx.length }));
    setRunning(true);
    const t0 = performance.now();
    running = runJobs<DuelStats>(jobs, (d, t) => {
      progress.classList.add('on'); (progress.firstChild as HTMLElement).style.width = `${(100 * d) / t}%`;
      progText.textContent = `${d.toLocaleString()} / ${t.toLocaleString()} fights`;
    });
    const res = await running.done;
    running = null;
    setRunning(false);
    if (!res) return;
    const seconds = (performance.now() - t0) / 1000;
    live[want.mode] = { engine: ARENA_ENGINE, mode: want.mode, settings: want.settings, n: want.n, seed: want.seed, rand: want.rand, entrants,
      pairs: idx.map(([i, j]) => pairFromStats(i, j, res.get(`${i}-${j}`)!)), source: 'live', seconds };
    u.sel = '';
    rerender();
  };

  root.append(h('div', { class: 'arena' },
    h('div', { class: 'enemy-head' }, h('h2', {}, 'Arena', h('small', {}, ' every monster against every other, one on one')),
      h('p', { class: 'derived' }, 'Each pair fights many times with the same rules as the player fights (COMBAT.C, AI.C): the to-hit roll against the defender\'s defence, its armour at the zone struck (×5/3 if powerful), its resistances. ' +
        'Critters only fight each other when one is the player\'s ally, so one side is taken as an ally (like a charmed creature); both can flee as they do from the player. Nobody moves. ' +
        'The rating is a Bradley–Terry fit on the Elo scale: a 400-point gap means 10 to 1 odds.')),
    modeTabs, ctrls, scoring,
    h('div', { class: 'row wrap run-row' }, runBtn, cancelBtn, progress, progText)));

  const out = h('div', { class: 'results' });
  root.append(out);
  if (!run) { out.append(h('p', { class: 'hint' }, 'Loading the reference ratings…')); return; }
  const sc: Scoring = { flee: u.flee, timeout: u.timeout };
  renderResults(out, run, sc, mismatch, !!refStale, set);
}

function lab(t: string, el: HTMLElement | null) { return el ? h('label', { class: 'lab' }, h('span', {}, t), el) : null; }

function runDesc(run: ArenaRun) {
  const s = run.settings;
  return `${run.source === 'reference' ? 'Reference run' : 'Your run'}: ${run.entrants.length} entrants, ${run.pairs.length.toLocaleString()} pairs × ${run.n.toLocaleString()} fights` +
    ` · HP ${s.hpMode === 'roll' ? 'rolled' : 'average'} · ${run.mode === 'ranged' ? `${s.distance} tiles · ` : ''}limit ${s.timeLimit} s · ${run.rand === 'game' ? "game's rand()" : 'ideal random numbers'} · seed ${run.seed}` +
    `${run.seconds ? ` · ${run.seconds.toFixed(1)} s` : ''}`;
}

/** Wins, draws and losses of one entrant under the scoring rules. */
function wdl(s: EntrantSummary, sc: Scoring) {
  let w = s.wins, l = s.losses, d = 0;
  if (sc.flee === 'loss') { w += s.theyFled; l += s.fled; } else d += s.fled + s.theyFled;
  if (sc.timeout === 'draw') d += s.timeouts;
  const g = w + d + l || 1;
  return { w: w / g, d: d / g, l: l / g };
}

function attackText(e: { creature: number; powerful: boolean }, mode: 'melee' | 'ranged') {
  const cr = creatures[e.creature];
  const M = entrantProfile(e, creatures);
  if (mode === 'ranged') {
    if (M.caster > 0) {
      const sp = M.spells.slice(0, 2).map((s) => s.name.replace(/ \(.*$/, ''));
      return `${[...new Set(sp)].join(' / ')} (casts ${M.caster}/128 a step)`;
    }
    return M.missile ? `${M.missile.name.replace(/ \(0x.*\)$/, '')}, ${M.missile.damage} (DEX ${M.dex}: ${M.dex + 1}/192 a step)` : '–';
  }
  let best = { th: 0, dmg: 0, p: 0 };
  for (const a of cr.attacks) if (a.prob > 0 && a.damage * a.prob > best.dmg * best.p) best = { th: a.chance + (cr.equip >> 1), dmg: a.damage, p: a.prob };
  return `to-hit ${best.th}${e.powerful ? '+7..12' : ''}, damage ${best.dmg}${e.powerful ? '+4..15' : ''}`;
}

function renderResults(out: HTMLElement, run: ArenaRun, sc: Scoring, mismatch: boolean, stale: boolean, set: (f: () => void) => void) {
  clear(out);
  const u = state.arena;
  const { r, sum } = rate(run, sc);
  const k = run.entrants.length;
  const order = [...Array(k).keys()].sort((a, b) => (r.rated[b] ? r.rating[b] : -1e9) - (r.rated[a] ? r.rating[a] : -1e9));
  const rank = new Map(order.map((e, i) => [e, i]));
  const label = (i: number) => entrantLabel(run.entrants[i]);
  const pairOf = new Map(run.pairs.map((p) => [`${p.i}-${p.j}`, p]));
  const ups = upsets(r, 12);
  const sel = u.sel && pairOf.has(u.sel) ? u.sel : ups.length ? `${Math.min(ups[0].i, ups[0].j)}-${Math.max(ups[0].i, ups[0].j)}` : '';
  const select2 = (i: number, j: number) => set(() => { u.sel = `${Math.min(i, j)}-${Math.max(i, j)}`; });

  out.append(h('p', { class: 'hint' }, runDesc(run)));
  if (mismatch) out.append(h('p', { class: 'warn' }, 'These results are for other settings than the ones above (only the scoring rules apply without a new run). Press Run round robin for the current settings.'));
  if (stale) out.append(h('p', { class: 'warn' }, 'The reference run was made by an older version of the engine; run it again (npm run arena).'));
  const cards = h('div', { class: 'cards' });

  // ---- ladder
  const lc = card(run.mode === 'melee' ? 'Melee ladder' : 'Ranged ladder',
    `rating ± 95% interval · score with draws as half · win / draw / loss under the scoring rules · ${run.mode === 'melee' ? 'face to face in reach' : `held ${run.settings.distance} tiles apart`}`);
  lc.classList.add('span-all');
  const heads = ['#', 'Creature', 'Rating', '±', 'Score', 'Win / draw / loss', 'Fled', 'Fight', 'HP', 'Defence', run.mode === 'melee' ? 'Main attack' : 'Ranged attack', 'Armour', 'Resists', 'XP'];
  const tbl = h('table', { class: 'mini wide ladder' }, h('tr', {}, ...heads.map((x) => h('th', {}, x))));
  for (const i of order) {
    const e = run.entrants[i], cr = creatures[e.creature], s = sum[i];
    const x = wdl(s, sc);
    const named = namedOf(e.creature);
    const isSel = sel.split('-').map(Number).includes(i);
    tbl.append(h('tr', { class: isSel ? 'on' : '' },
      h('td', {}, r.rated[i] ? String(rank.get(i)! + 1) : '–'),
      h('td', { title: named.length ? `named: ${named.join(', ')}` : '' }, label(i), named.length ? h('small', { class: 'muted' }, ` · ${named.slice(0, 3).join(', ')}${named.length > 3 ? ` +${named.length - 3}` : ''}`) : ''),
      h('td', { class: 'num-strong' }, r.rated[i] ? String(Math.round(r.rating[i])) : 'unrated'),
      h('td', { class: 'muted' }, r.rated[i] ? String(Math.round(r.ci[i])) : ''),
      h('td', {}, r.games[i] ? pct(r.score[i] / r.games[i], 0) : '–'),
      h('td', {}, h('span', { class: 'wdl', title: `win ${pct(x.w)} · draw ${pct(x.d)} · loss ${pct(x.l)}` },
        h('i', { style: `width:${x.w * 100}%;background:${C.win}` }), h('i', { style: `width:${x.d * 100}%;background:${C.timeout}` }), h('i', { style: `width:${x.l * 100}%;background:${C.death}` }))),
      h('td', { title: 'share of its fights in which it fled' }, pct(s.fled / Math.max(1, s.fights), 0)),
      h('td', { title: 'mean fight length' }, `${fmt(s.dur / Math.max(1, s.fights), 0)} s`),
      h('td', {}, String(cr.avghit)),
      h('td', {}, String(cr.defence)),
      h('td', {}, attackText(e, run.mode)),
      h('td', { title: 'torso / arms / legs / head' }, cr.armour.map((a) => (a === 255 ? '—' : e.powerful ? Math.trunc((a * 5) / 3) : a)).join('/')),
      h('td', {}, resistText(resistOfId(cr.id))),
      h('td', { title: 'kill XP the player gets: (exp × 4 + 2d exp) / 2' }, String(cr.exp))));
  }
  lc.append(h('div', { class: 'scroll' }, tbl));
  cards.append(lc);

  // ---- matchup heatmap
  const hc = card('Who beats whom', 'row against column: its score (draws as half) · ordered by rating · click a cell for the head-to-head');
  hc.classList.add('span-all');
  const hBox = h('div');
  matchupHeatmap(hBox, order, r, label, sel, select2);
  hc.append(hBox, h('div', { class: 'heat-legend' }, h('span', {}, 'row loses'), h('i', { class: 'grad' }), h('span', {}, 'row wins')));
  cards.append(hc);

  // ---- head-to-head
  if (sel) cards.append(headToHead(pairOf.get(sel)!, run, r, label));

  // ---- upsets
  const uc = card('Upsets', 'pairs furthest from what the ratings predict (by z-score): one number cannot hold rock-paper-scissors');
  const ut = h('table', { class: 'mini wide sortable' }, h('tr', {}, ...['Winner', 'Over', 'Observed', 'Predicted', 'z'].map((x) => h('th', {}, x))));
  for (const x of ups) ut.append(h('tr', { class: 'pick', onclick: () => select2(x.i, x.j) },
    h('td', {}, label(x.i)), h('td', {}, label(x.j)), h('td', {}, pct(x.observed, 0)), h('td', {}, pct(x.predicted, 0)), h('td', {}, fmt(x.z, 1))));
  uc.append(ut, h('p', { class: 'hint' }, 'Typical causes: a resistance that cancels an attack type (Fireball on the fire-resistant), or flight. A monster whose rolled HP starts below 3/4 of its average runs the flee test every time it is attacked, ' +
    'even on a miss (do_attack calls damage_item with 0, which records the attacker), so even a harmless opponent can put it to flight.'));
  cards.append(uc);

  // ---- rating against XP
  const xc = card('Rating against the game\'s kill XP', 'does the experience a monster gives track how strong it is? (log scale)');
  const xBox = h('div');
  xc.append(xBox, ratingScatter(xBox, run, r, label));
  cards.append(xc);

  // ---- unrated / left out
  const never = order.filter((i) => !r.rated[i]);
  const left = run.mode === 'ranged' ? rangedLeftOut() : [];
  if (never.length || left.length) {
    const nc = card('Not rated', run.mode === 'ranged' ? 'no ranged attack that can hurt another critter, or never damaged anyone' : 'never damaged anyone');
    if (never.length) nc.append(h('p', {}, h('b', {}, 'Never damaged an opponent: '), never.map(label).join(', ')));
    if (left.length) nc.append(h('p', {}, h('b', {}, 'No ranged attack: '), `${left.length} types, including ${left.slice(0, 12).map((c) => creatures[c].name).join(', ')}${left.length > 12 ? '…' : ''}`),
      h('p', { class: 'hint' }, 'A caster whose spells only heal or do something else, or a creature without a missile weapon, cannot score at range (nobody moves), so it is left off this ladder.'));
    cards.append(nc);
  }
  out.append(cards);
}

function matchupHeatmap(el: HTMLElement, order: number[], r: RatingResult, label: (i: number) => string, sel: string, onPick: (i: number, j: number) => void) {
  const n = order.length;
  const height = Math.min(980, 70 + n * 14);
  const [si, sj] = sel ? sel.split('-').map(Number) : [-1, -1];
  chart(el, height, (svg, w, hgt) => {
    const showNames = w > 640;
    const L = showNames ? 150 : 34, T = 8, R = 8, B = 26;
    const x = d3.scaleBand<number>().domain(d3.range(n)).range([L, w - R]);
    const y = d3.scaleBand<number>().domain(d3.range(n)).range([T, hgt - B]);
    const col = d3.scaleDiverging(d3.interpolateRdBu).domain([0, 0.5, 1]);
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      if (a === b) continue;
      const i = order[a], j = order[b];
      const g = r.G[i][j];
      if (!g) continue;
      const v = r.W[i][j] / g;
      const pred = r.rated[i] && r.rated[j] ? expected(r.rating[i], r.rating[j]) : NaN;
      svg.append('rect').attr('x', x(b)!).attr('y', y(a)!).attr('width', x.bandwidth() + 0.4).attr('height', y.bandwidth() + 0.4).attr('fill', col(v))
        .style('cursor', 'pointer').on('click', () => onPick(i, j))
        .append('title').text(`${label(i)} vs ${label(j)}: ${pct(v)} over ${g.toLocaleString()} fights${Number.isFinite(pred) ? ` (rating predicts ${pct(pred)})` : ''}`);
    }
    for (const [a, b] of [[order.indexOf(si), order.indexOf(sj)], [order.indexOf(sj), order.indexOf(si)]])
      if (a >= 0 && b >= 0) svg.append('rect').attr('class', 'heat-mark').attr('x', x(b)!).attr('y', y(a)!).attr('width', x.bandwidth()).attr('height', y.bandwidth());
    const fs = Math.max(7, Math.min(11, y.bandwidth() - 2));
    for (let a = 0; a < n; a++) {
      svg.append('text').attr('class', 'heat-lab').attr('x', L - 4).attr('y', y(a)! + y.bandwidth() / 2).attr('dy', '0.35em').attr('text-anchor', 'end')
        .style('font-size', `${fs}px`).text(showNames ? `${a + 1}. ${label(order[a])}`.slice(0, 26) : String(a + 1));
    }
    const every = Math.max(1, Math.ceil(n / Math.max(4, (w - L - R) / 18)));
    for (let b = 0; b < n; b += every) svg.append('text').attr('class', 'heat-lab').attr('x', x(b)! + x.bandwidth() / 2).attr('y', hgt - B + 14).attr('text-anchor', 'middle')
      .style('font-size', '10px').text(String(b + 1));
    svg.append('text').attr('class', 'axis-label').attr('x', (L + w - R) / 2).attr('y', hgt - 2).attr('text-anchor', 'middle').text('opponent (by rank)');
  });
}

/** Draws the scatter into el and returns a line with the rank correlation. */
function ratingScatter(el: HTMLElement, run: ArenaRun, r: RatingResult, label: (i: number) => string): HTMLElement {
  const pts = run.entrants.map((e, i) => ({ i, x: Math.max(1, creatures[e.creature].exp), y: r.rating[i] })).filter((p) => r.rated[p.i]);
  chart(el, 280, (svg, w, hgt) => {
    const M = { t: 12, r: 14, b: 36, l: 50 };
    const x = d3.scaleLog().domain(d3.extent(pts, (p) => p.x) as [number, number]).nice().range([M.l, w - M.r]);
    const y = d3.scaleLinear().domain(d3.extent(pts, (p) => p.y) as [number, number]).nice().range([hgt - M.b, M.t]);
    svg.append('g').attr('class', 'grid').attr('transform', `translate(${M.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(w - M.l - M.r)).tickFormat(() => '') as any);
    svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${hgt - M.b})`).call(d3.axisBottom(x).ticks(5, '~s') as any);
    svg.append('g').attr('class', 'axis').attr('transform', `translate(${M.l},0)`).call(d3.axisLeft(y).ticks(5) as any);
    svg.append('text').attr('class', 'axis-label').attr('x', (M.l + w - M.r) / 2).attr('y', hgt - 4).attr('text-anchor', 'middle').text('creature exp value (kill XP)');
    svg.append('text').attr('class', 'axis-label').attr('transform', `translate(11,${(M.t + hgt - M.b) / 2}) rotate(-90)`).attr('text-anchor', 'middle').text('rating');
    for (const p of pts) svg.append('circle').attr('cx', x(p.x)).attr('cy', y(p.y)).attr('r', 4).attr('fill', run.entrants[p.i].powerful ? C.purple : C.accent).attr('opacity', 0.8)
      .append('title').text(`${label(p.i)}: rating ${Math.round(p.y)}, exp ${creatures[run.entrants[p.i].creature].exp}`);
  });
  // rank correlation, so the card says it in words
  const rx = rankOf(pts.map((p) => p.x)), ry = rankOf(pts.map((p) => p.y));
  const n = pts.length, mx = d3.mean(rx)!, my = d3.mean(ry)!;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (rx[i] - mx) * (ry[i] - my); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - my) ** 2; }
  return h('p', { class: 'hint' }, `Spearman rank correlation ${fmt(sxy / Math.sqrt(sxx * syy), 2)} over ${n} entrants.`);
}
function rankOf(v: number[]) {
  const idx = v.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array(v.length);
  for (let a = 0; a < idx.length;) { let b = a; while (b + 1 < idx.length && idx[b + 1][0] === idx[a][0]) b++; for (let c = a; c <= b; c++) r[idx[c][1]] = (a + b) / 2; a = b + 1; }
  return r;
}

function headToHead(p: PairRec, run: ArenaRun, r: RatingResult, label: (i: number) => string) {
  const n = pairN(p);
  const A = label(p.i), B = label(p.j);
  const el = card(`${A} vs ${B}`, `${n.toLocaleString()} fights · half with each side acting first on a shared tick · 95% Wilson intervals`);
  const names = [`${A} kills`, `${B} kills`, `${A} flees`, `${B} flees`, 'Time runs out'];
  const colors = [C.win, C.death, C.flee, '#d9a441', C.timeout];
  const sb = h('div');
  shareBar(sb, p.o.map((v, x) => ({ label: names[x], value: v, color: colors[x] })));
  const t = h('table', { class: 'mini wide' }, h('tr', {}, ...['', 'Count', '%', '95% interval'].map((x) => h('th', {}, x))));
  p.o.forEach((v, x) => { const [lo, hi] = wilson(v, n); t.append(h('tr', {}, h('td', {}, h('i', { class: 'sw', style: `background:${colors[x]}` }), names[x]), h('td', {}, v.toLocaleString()), h('td', {}, pct(v / n)), h('td', {}, `${pct(lo)} – ${pct(hi)}`))); });
  const g = r.G[p.i][p.j], obs = g ? r.W[p.i][p.j] / g : NaN;
  const pred = r.rated[p.i] && r.rated[p.j] ? expected(r.rating[p.i], r.rating[p.j]) : NaN;
  el.append(h('p', { class: 'lead' }, `${A} scores ${pct(obs)}`, h('small', { class: 'muted' }, Number.isFinite(pred) ? ` · the ratings (${Math.round(r.rating[p.i])} vs ${Math.round(r.rating[p.j])}) predict ${pct(pred)}` : '')), sb, t);
  const sides = h('table', { class: 'mini wide' }, h('tr', {}, h('th', {}, 'Per fight'), h('th', {}, A), h('th', {}, B)));
  const row = (name: string, f: (s: PairRec['side'][0], x: number) => string) => sides.append(h('tr', {}, h('td', {}, name), h('td', {}, f(p.side[0], 0)), h('td', {}, f(p.side[1], 1))));
  row('starting HP', (s) => fmt(s.hpStart / n, 1));
  row('blows and casts', (s) => fmt(s.att / n, 1));
  row('of which land', (s) => (s.att ? pct(s.hit / s.att, 0) : '–'));
  row('criticals', (s) => (s.att ? pct(s.crit / s.att, 1) : '–'));
  row('HP dealt', (s) => fmt(s.dealt / n, 1));
  row('stopped by the other\'s armour', (s) => fmt(s.absorbed / n, 1));
  row('stopped by the other\'s resistances', (s) => fmt(s.resisted / n, 1));
  row('HP left when it wins', (s, x) => (p.o[x] ? fmt(s.hpLeft / p.o[x], 1) : '–'));
  const dh = h('div');
  histogram(dh, 0, 1, [{ name: 'fights', color: C.accent, values: p.hist }], { xLabel: 'seconds', height: 150 });
  el.append(sides, h('p', { class: 'sub' }, `Fight length, mean ${fmt(p.dur / n, 1)} s`), dh);
  const ea = run.entrants[p.i], eb = run.entrants[p.j];
  const line = (e: typeof ea) => { const cr = creatures[e.creature]; return `${entrantLabel(e)}: HP ${cr.avghit}, defence ${cr.defence}, armour ${cr.armour.map((a) => (a === 255 ? '—' : a)).join('/')}, ${attackText(e, run.mode)}${resistOfId(cr.id) ? `, resists ${resistText(resistOfId(cr.id))}` : ''}${cr.arms[0]?.item ? `, carries ${itemName(cr.arms[0].item)}` : ''}`; };
  el.append(h('p', { class: 'hint' }, line(ea)), h('p', { class: 'hint' }, line(eb)));
  return el;
}
