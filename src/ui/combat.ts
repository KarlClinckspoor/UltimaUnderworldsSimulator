// Combat tab (plan Part B): one enemy N times, or every enemy in the game.
import { ATTACK_SPELLS, derive, spellLabel, spellStatus, ZONE_NAMES } from '../core/character';
import { ATTITUDES, creatures, levels, type EnemyRow } from '../data/gameData';
import { combatCapable, monsterProfile, playerProfile, type FightSettings, type MonsterProfile, type PlayerProfile } from '../combat/setup';
import { runJobs, splitJob, type RunHandle } from '../combat/pool';
import type { Job } from '../combat/worker';
import { DEALT_PARTS, DUR_BIN, OUTCOMES, SOURCES, wilson, type Stats } from '../combat/stats';
import { monsterBlowDist, monsterExpectedBlow, playerBlowDist } from '../combat/exact';
import type { HpMode } from '../combat/fight';
import { changed, state } from '../state';
import { card, clear, fmt, h, numInput, pct, select, toggle } from './dom';
import { C, groupedBars, histogram, lineChart, OUTCOME_COLORS, shareBar, stackedBars, stripChart } from './charts';

const OUT_LABEL = ['Victory', 'Death', 'Monster flees', 'Timeout'];
let running: RunHandle | null = null;
let lastSingle: { stats: Stats; P: PlayerProfile; M: MonsterProfile; S: FightSettings; key: string } | null = null;
let lastAll: { results: AllResult[]; key: string } | null = null;

interface EnemyRef { level: number; rowIndex: number; row: EnemyRow }
interface AllResult extends EnemyRef { stats: Stats; M: MonsterProfile }

const rowName = (r: EnemyRow) => `${creatures[r.c].name}${r.pw ? ' ★' : ''}`;
const rowDesc = (r: EnemyRow) => `${rowName(r)} · HP ${r.hp} · ${ATTITUDES[r.att]}${r.n > 1 ? ` · ×${r.n}` : ''}${r.trap ? ` · ${r.trap} from traps` : ''}`;

function hpMode(): HpMode {
  const u = state.combat;
  return u.hpMode === 'set' ? { kind: 'set', value: u.hpSet } : { kind: u.hpMode };
}
function settings(): FightSettings {
  const u = state.combat;
  return { mode: u.mode, distance: u.distance, hitangle: u.hitangle, swing: u.swing, timeLimit: u.timeLimit,
    rangedHitChance: u.rangedHitChance, aimTicks: u.aimTicks };
}
const configKey = () => { const { threshold, fleeCounts, ...rest } = state.combat; void threshold; void fleeCounts; return JSON.stringify([state.character, rest]); };

export function renderCombat(root: HTMLElement) {
  clear(root);
  const u = state.combat;
  const c = state.character;
  const rerender = () => renderCombat(root);
  const set = (f: () => void) => { f(); changed('combat'); rerender(); };
  const L = levels.find((x) => x.level === u.level) ?? levels[0];
  if (u.row >= L.rows.length) u.row = 0;
  const row = L.rows[u.row];

  // ---- enemy picker
  const picker = h('div', { class: 'enemy-list' });
  L.rows.forEach((r, i) => {
    const cr = creatures[r.c];
    const ok = combatCapable(cr, r.hp);
    picker.append(h('button', { class: `enemy ${i === u.row ? 'on' : ''} ${ok ? '' : 'inert'}`, title: ok ? rowDesc(r) : 'no hit points or attacks: not combat-capable',
      onclick: () => set(() => { u.row = i; }) },
      h('span', { class: 'en-name' }, rowName(r)), h('span', { class: 'en-hp' }, `HP ${r.hp}`),
      h('span', { class: `en-att att${r.att}` }, ATTITUDES[r.att]), r.n > 1 ? h('span', { class: 'en-n' }, `×${r.n}`) : null,
      r.trap ? h('span', { class: 'en-trap', title: `held by create-object traps (spawn chance ${r.spawnP?.map((p) => pct(p, 0)).join(', ')})` }, 'trap') : null));
  });
  const levelTabs = h('div', { class: 'level-tabs' }, ...levels.map((x) => h('button', { class: `lvl ${x.level === u.level ? 'on' : ''}`,
    onclick: () => set(() => { u.level = x.level; u.row = 0; }) }, String(x.level))));

  // ---- controls
  const st = spellStatus(c);
  const attackOpts: [number, string][] = [[-1, 'none']];
  for (const i of ATTACK_SPELLS) attackOpts.push([i, `${spellLabel(i)}${st[i]?.castable ? '' : ' (not castable: ' + st[i]?.reasons.join(', ') + ')'}`]);
  const swingOpts: [number, string][] = [[0, 'best swing'], ...[1, 2, 3].map((i) => [i, `cell ${i}: stab`] as [number, string]),
    ...[4, 5, 6].map((i) => [i, `cell ${i}: slash`] as [number, string]), ...[7, 8, 9].map((i) => [i, `cell ${i}: bash`] as [number, string])];
  const ctrls = h('div', { class: 'ctrl-grid' },
    lab('Engagement', select(u.mode, [['melee', 'Melee (in reach)'], ['ranged', 'Ranged (held at a distance)']], (v) => set(() => (u.mode = v)))),
    u.mode === 'ranged' ? lab('Distance (tiles)', numInput(u.distance, 1, 8, (v) => set(() => (u.distance = v)))) : null,
    u.mode === 'melee' ? lab('Swing', select(u.swing, swingOpts, (v) => set(() => (u.swing = v)))) : null,
    u.mode === 'melee' ? lab('Attack from (hitangle)', select(u.hitangle, [[0, 'the front (0)'], [1, '1/8 turn (1)'], [2, 'the side (2)'], [3, '3/8 turn (3)'], [4, 'behind (4)']], (v) => set(() => (u.hitangle = v)))) : null,
    u.mode === 'ranged' ? lab('Attack spell', select(u.attackSpell ?? -1, attackOpts, (v) => set(() => (u.attackSpell = v === -1 ? null : v)))) : null,
    u.mode === 'ranged' ? lab('Player missile hit chance %', numInput(Math.round(u.rangedHitChance * 100), 0, 100, (v) => set(() => (u.rangedHitChance = v / 100)))) : null,
    lab('Enemy HP', select(u.hpMode, [['stored', 'stored in LEV.ARK'], ['roll', 'rolled fresh each fight'], ['set', 'set to…']], (v) => set(() => (u.hpMode = v)))),
    u.hpMode === 'set' ? lab('HP', numInput(u.hpSet, 1, 255, (v) => set(() => (u.hpSet = v)))) : null,
    lab('Fights (N)', numInput(u.n, 10, 1_000_000, (v) => set(() => (u.n = v)))),
    lab('Time limit (s)', numInput(u.timeLimit, 5, 600, (v) => set(() => (u.timeLimit = v)))),
    lab('Seed', numInput(u.seed, 0, 2 ** 31 - 1, (v) => set(() => (u.seed = v)))),
  );
  const progress = h('div', { class: 'progress' }, h('i'));
  const progText = h('span', { class: 'prog-text' });
  const out = h('div', { class: 'results' });
  const runBtn = h('button', { class: 'btn primary', disabled: !row || !combatCapable(creatures[row.c], row.hp) }, 'Simulate');
  const cancelBtn = h('button', { class: 'btn ghost', disabled: true }, 'Cancel');
  const allBtn = h('button', { class: 'btn', title: 'Every combat-capable monster on levels 1-9' }, 'All enemies');
  const setRunning = (on: boolean) => { runBtn.disabled = on; allBtn.disabled = on; cancelBtn.disabled = !on; if (!on) progress.classList.remove('on'); };
  const onProg = (d: number, t: number) => { progress.classList.add('on'); (progress.firstChild as HTMLElement).style.width = `${(100 * d) / t}%`; progText.textContent = `${d.toLocaleString()} / ${t.toLocaleString()} fights`; };
  cancelBtn.onclick = () => { running?.cancel(); running = null; setRunning(false); progText.textContent = 'Cancelled.'; };

  runBtn.onclick = async () => {
    if (!row) return;
    const P = playerProfile(c, u.mode === 'ranged' ? u.attackSpell : null);
    const M = monsterProfile(row.c, row.hp, !!row.pw, row.att);
    const S = settings();
    const jobs = splitJob({ key: 'one', P, M, S, hpMode: hpMode(), seed: u.seed }, u.n);
    setRunning(true);
    const t0 = performance.now();
    running = runJobs(jobs, onProg);
    const res = await running.done;
    running = null;
    setRunning(false);
    if (!res) return;
    progText.textContent = `${u.n.toLocaleString()} fights in ${((performance.now() - t0) / 1000).toFixed(1)} s · seed ${u.seed}`;
    lastSingle = { stats: res.get('one')!, P, M, S, key: configKey() };
    renderSingle(out, lastSingle.stats, P, M, S);
  };
  allBtn.onclick = async () => {
    const S = settings();
    const P = playerProfile(c, u.mode === 'ranged' ? u.attackSpell : null);
    const refs = allEnemies();
    const jobs: Job[] = refs.map((r, i) => ({ key: String(i), P, M: monsterProfile(r.row.c, r.row.hp, !!r.row.pw, r.row.att), S,
      hpMode: hpMode(), n: u.allN, seed: u.seed, stream: 1000 + i }));
    setRunning(true);
    const t0 = performance.now();
    running = runJobs(jobs, onProg);
    const res = await running.done;
    running = null;
    setRunning(false);
    if (!res) return;
    progText.textContent = `${refs.length} enemies × ${u.allN} fights in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
    lastAll = { results: refs.map((r, i) => ({ ...r, stats: res.get(String(i))!, M: jobs[i].M })), key: configKey() };
    renderAll(out, lastAll.results, rerender);
  };

  const allCtrls = h('div', { class: 'row wrap all-ctrls' },
    lab('Fights per enemy', numInput(u.allN, 20, 20000, (v) => set(() => (u.allN = v)))),
    lab('Win threshold %', numInput(Math.round(u.threshold * 100), 1, 100, (v) => { u.threshold = v / 100; changed('combat'); if (lastAll) renderAll(out, lastAll.results, rerender); })),
    toggle('Trap-spawned', u.inclTrap, (v) => set(() => (u.inclTrap = v))),
    toggle('Non-hostile', u.inclPeaceful, (v) => set(() => (u.inclPeaceful = v)), 'mellow and friendly creatures fight back when attacked'),
    toggle('Count flights as beaten', u.fleeCounts, (v) => { u.fleeCounts = v; changed('combat'); if (lastAll) renderAll(out, lastAll.results, rerender); }));

  const d = derive(c);
  const notes = h('p', { class: 'hint' }, `Player: HP ${d.startHp}/${d.maxHp}, defence ${d.defence}, armour ${d.armour.join('/')} (torso/arms/legs/head)${d.activeBuffs.length ? ', buffs: ' + d.activeBuffs.map(spellLabel).join(', ') : ''}. Edit the character on the left.`);

  root.append(h('div', { class: 'combat-layout' },
    h('div', { class: 'picker' }, h('h3', {}, 'Enemy'), h('p', { class: 'hint' }, 'Dungeon level'), levelTabs, picker),
    h('div', { class: 'combat-main' },
      row ? h('div', { class: 'enemy-head' }, enemySummary(row)) : null,
      ctrls, notes,
      h('div', { class: 'row wrap run-row' }, runBtn, cancelBtn, allBtn, progress, progText), allCtrls, out)));

  if (lastSingle && lastSingle.key === configKey()) renderSingle(out, lastSingle.stats, lastSingle.P, lastSingle.M, lastSingle.S);
  else if (lastAll && lastAll.key === configKey()) renderAll(out, lastAll.results, rerender);
  else if (row && combatCapable(creatures[row.c], row.hp)) renderPreview(out);
}

function lab(t: string, el: HTMLElement | null) { return el ? h('label', { class: 'lab' }, h('span', {}, t), el) : null; }

function allEnemies(): EnemyRef[] {
  const u = state.combat;
  const out: EnemyRef[] = [];
  for (const L of levels) L.rows.forEach((row, rowIndex) => {
    if (!combatCapable(creatures[row.c], row.hp)) return;
    if (!u.inclTrap && row.placed === 0) return;
    if (!u.inclPeaceful && row.att !== 0) return;
    out.push({ level: L.level, rowIndex, row });
  });
  return out;
}

function enemySummary(r: EnemyRow) {
  const cr = creatures[r.c];
  const M = monsterProfile(r.c, r.hp, !!r.pw, r.att);
  const atk = cr.attacks.map((a, i) => (a.prob ? `slot ${i + 1}: to-hit ${a.chance + (cr.equip >> 1)}, damage ${a.damage} (${a.prob}%)` : '')).filter(Boolean).join(' · ');
  const extra = [M.missile ? `fires ${M.missile.name} (${M.missile.damage})` : '',
    M.caster ? `caster ${M.caster}${M.offensive ? '' : ' (no attack spells)'}: ${M.spells.map((s) => s.name).filter((n) => n !== '-').join(', ')}` : '',
    M.resist ? `resist 0x${M.resist.toString(16)}` : '', r.pw ? 'powerful: +7..12 to hit, +4..15 damage, armour ×5/3' : ''].filter(Boolean).join(' · ');
  return h('div', {},
    h('h2', {}, rowName(r), h('small', {}, ` level ${state.combat.level} · ${ATTITUDES[r.att]} · stored HP ${r.hp} (average ${cr.avghit})`)),
    h('p', { class: 'derived' }, `Defence ${cr.defence} · armour ${cr.armour.map((a) => (a === 255 ? '—' : a)).join('/')} · height ${M.height} · nerve ${cr.nerve} · XP ${cr.exp * 4}+2d${cr.exp}`),
    h('p', { class: 'derived' }, atk), extra ? h('p', { class: 'derived' }, extra) : null);
}

/** Exact one-blow numbers shown before any simulation. */
function renderPreview(out: HTMLElement) {
  const u = state.combat;
  const L = levels.find((x) => x.level === u.level)!;
  const r = L.rows[u.row];
  const P = playerProfile(state.character, null);
  const M = monsterProfile(r.c, r.hp, !!r.pw, r.att);
  clear(out);
  out.append(h('div', { class: 'cards' }, exactCard(P, M, settings())));
}

function exactCard(P: PlayerProfile, M: MonsterProfile, S: FightSettings) {
  const pb = playerBlowDist(P, M, S);
  const mb = monsterExpectedBlow(M, P);
  const el = card('One blow, exact', 'no simulation: the to-hit grade, dice, charge, armour and resistance convolved');
  const box = h('div');
  const maxV = Math.min(pb.dist.length, 60);
  const cats = Array.from({ length: maxV }, (_, i) => String(i));
  stackedBars(box, cats, [{ name: 'P(damage)', color: C.accent, values: pb.dist.slice(0, maxV) }], { height: 170, yfmt: (v) => pct(v, 0) });
  const m0 = monsterBlowDist(M, 0, P, 0);
  el.append(h('p', {}, `Your swing (${P.melee.name}, full charge ×${(P.melee.maxCharge / 128).toFixed(2)}): hits ${pct(1 - pb.pMiss)}, critical ${pct(pb.pCrit)}, mean damage ${fmt(pb.mean, 2)} per swing.`),
    box, h('p', {}, `Its melee attack: hits you ${pct(mb.pHit)} of the time, mean ${fmt(mb.mean, 2)} damage per attack (attack frame and slot averaged; the weakest wind-up alone: ${fmt(m0.mean, 2)}).`));
  return el;
}

// ------------------------------------------------------------------ single enemy
function renderSingle(out: HTMLElement, s: Stats, P: PlayerProfile, M: MonsterProfile, S: FightSettings) {
  clear(out);
  const n = s.n;
  const cards = h('div', { class: 'cards' });
  const meleeOnlyAtRange = S.mode === 'ranged' && !M.missile && !(M.caster && M.offensive && S.distance ** 2 < 64);

  // outcomes
  const oc = card('Outcome', `${n.toLocaleString()} fights, 95% Wilson intervals`);
  const sb = h('div');
  shareBar(sb, OUTCOMES.map((_, i) => ({ label: OUT_LABEL[i], value: s.outcomes[i], color: OUTCOME_COLORS[i] })));
  const t = h('table', { class: 'mini wide' }, h('tr', {}, ...['', 'Count', '%', '95% interval', 'Mean length'].map((x) => h('th', {}, x))));
  OUTCOMES.forEach((_, i) => {
    const [lo, hi] = wilson(s.outcomes[i], n);
    t.append(h('tr', {}, h('td', {}, h('i', { class: 'sw', style: `background:${OUTCOME_COLORS[i]}` }), OUT_LABEL[i]), h('td', {}, s.outcomes[i].toLocaleString()),
      h('td', {}, pct(s.outcomes[i] / n)), h('td', {}, `${pct(lo)} – ${pct(hi)}`), h('td', {}, s.outcomes[i] ? `${fmt(s.durSum[i] / s.outcomes[i])} s` : '–')));
  });
  const wins = s.outcomes[0];
  const lead = meleeOnlyAtRange
    ? h('p', { class: 'lead' }, `${M.name} cannot reach you at ${S.distance} tiles. Damage per second ${fmt(s.dps / n, 2)}; killed within the limit in ${pct(wins / n)} of fights${wins ? `, mean time to kill ${fmt(s.ttkSum / wins)} s` : ''}.`)
    : h('p', { class: 'lead' }, `Win ${pct(wins / n)}${wins ? ` · mean time to kill ${fmt(s.ttkSum / wins)} s · HP left ${fmt(meanOfHist(s.hpLeftHist), 1)} · XP per win ${fmt(s.xp / wins / 10, 1)}` : ''}`);
  const noRanged = S.mode === 'ranged' && !P.launcher && !P.attackSpell
    ? h('p', { class: 'warn' }, 'You have no ranged attack: equip a sling, bow or crossbow in the weapon hand, or choose a castable attack spell.') : null;
  oc.append(lead, noRanged ?? '', sb, t);
  cards.append(oc);

  // durations
  const dc = card('Fight length', 'seconds of game time, stacked by outcome');
  const dh = h('div');
  const last = Math.max(1, lastNonZero(s.durHist.flat().length ? s.durHist : [[0]]));
  histogram(dh, 0, DUR_BIN, OUTCOMES.map((_, i) => ({ name: OUT_LABEL[i], color: OUTCOME_COLORS[i], values: s.durHist[i].slice(0, last + 1) })), { xLabel: 'seconds' });
  dc.append(dh);
  cards.append(dc);

  // HP left
  const hc = card('Hit points left', 'yours after a victory; the monster\'s after your death, its flight or the time limit');
  const hpBox = h('div'), mBox = h('div');
  if (wins) histogram(hpBox, 0, 1, [{ name: 'your HP after a win', color: C.win, values: s.hpLeftHist }], { xLabel: 'your HP', height: 150 });
  const lm = lastNonZero([s.monHpLeftHist]);
  if (n - wins) histogram(mBox, 0, 1, [{ name: 'monster HP left', color: C.death, values: s.monHpLeftHist.slice(0, lm + 1) }], { xLabel: 'monster HP', height: 150 });
  hc.append(hpBox, mBox);
  cards.append(hc);

  // damage dealt
  const dd = card('Damage you dealt, by source', 'mean per fight · each blow\'s HP loss split over the parts of its input, after armour');
  const parts = DEALT_PARTS.map((p, i) => ({ p, v: s.dealt[i] / n })).filter((x) => x.v > 0.0005);
  const ddBox = h('div');
  stackedBars(ddBox, ['dealt', 'stopped by armour', 'resisted', 'overkill'],
    [...parts.map((x, i) => ({ name: x.p, color: C.series[i % C.series.length], values: [x.v, 0, 0, 0] })),
      { name: 'armour', color: C.timeout, values: [0, s.absorbedMon / n, 0, 0] }, { name: 'resisted', color: C.purple, values: [0, 0, s.resistedMon / n, 0] },
      { name: 'overkill', color: C.flee, values: [0, 0, 0, s.overkill / n] }], { height: 200, yLabel: 'HP per fight', tip: (cat, se, v) => `${cat} · ${se.name}: ${v.toFixed(2)} per fight` });
  const mean = s.dealtPerFight / n, sd = Math.sqrt(Math.max(0, s.dealtPerFightSq / n - mean * mean));
  const swing = s.pSwings ? `${s.pSwings / n > 0 ? fmt(s.pSwings / n) : 0} swings per fight: ${pct(s.pHits / s.pSwings)} hit, ${pct(s.pCrits / s.pSwings)} critical, ${pct(s.pBadMisses / s.pSwings)} bad misses` : '';
  const shots = s.pShots ? `${fmt(s.pShots / n)} shots per fight, ${pct(s.pShotHits / s.pShots)} reach the target` : '';
  dd.append(ddBox, h('p', {}, `Per fight ${fmt(mean)} ± ${fmt(sd)} HP. `, swing, shots ? ' · ' + shots : ''),
    h('ul', { class: 'legend' }, ...parts.map((x, i) => h('li', {}, h('i', { class: 'sw', style: `background:${C.series[i % C.series.length]}` }), `${x.p} ${fmt(x.v, 2)}`))));
  cards.append(dd);

  // damage received per body part
  const rc = card('Damage you received, per body part', 'mean per fight · armour absorption split by item, armour spell and toughness');
  const rBox = h('div');
  stackedBars(rBox, ZONE_NAMES, [
    { name: 'damage taken', color: C.death, values: s.zoneDamage.map((v) => v / n) },
    { name: 'absorbed by armour items', color: C.blue, values: s.zoneAbsorbed.map((a) => a[0] / n) },
    { name: 'absorbed by armour spell', color: C.teal, values: s.zoneAbsorbed.map((a) => a[1] / n) },
    { name: 'absorbed by toughness', color: C.purple, values: s.zoneAbsorbed.map((a) => a[2] / n) }], { height: 200, yLabel: 'HP per fight' });
  const zt = h('table', { class: 'mini wide' }, h('tr', {}, ...['Location', 'Armour', 'Hits / fight', 'Misses / fight', 'Missed thanks to protection', 'Damage / fight', 'Absorbed / fight'].map((x) => h('th', {}, x))));
  ZONE_NAMES.forEach((z, i) => zt.append(h('tr', {}, h('td', {}, z), h('td', {}, String(P.armour[i])), h('td', {}, fmt(s.zoneHits[i] / n, 2)), h('td', {}, fmt(s.zoneMisses[i] / n, 2)),
    h('td', {}, fmt(s.zoneProtMisses[i] / n, 2)), h('td', {}, fmt(s.zoneDamage[i] / n, 2)), h('td', {}, fmt(s.zoneAbsorbed[i].reduce((a, b) => a + b) / n, 2)))));
  rc.append(rBox, zt, h('p', { class: 'hint' }, `Easy mode halved ${fmt(s.easyHalved / n, 2)} per fight · resistances stopped ${fmt(s.resistedPlayer / n, 2)} per fight.`));
  cards.append(rc);

  // by monster source
  const mc = card('Its attacks, by source', 'per fight');
  const mt = h('table', { class: 'mini wide' }, h('tr', {}, ...['Source', 'Attempts', 'Hits', 'Criticals', 'Damage'].map((x) => h('th', {}, x))));
  SOURCES.forEach((src, i) => { if (s.srcAttempts[i]) mt.append(h('tr', {}, h('td', {}, src), h('td', {}, fmt(s.srcAttempts[i] / n, 2)), h('td', {}, pct(s.srcHits[i] / s.srcAttempts[i])), h('td', {}, pct(s.srcCrits[i] / s.srcAttempts[i])), h('td', {}, fmt(s.srcDamage[i] / n, 2)))); });
  if (s.defensiveCasts) mt.append(h('tr', {}, h('td', {}, 'spells with no effect on you'), h('td', {}, fmt(s.defensiveCasts / n, 2)), h('td', {}), h('td', {}), h('td', {})));
  mc.append(mt);
  if (s.armourWearEvents || s.weaponWearEvents) mc.append(h('p', { class: 'hint' },
    `Wear per fight: weapon ${fmt(s.weaponWearEvents / n, 2)} events, ${fmt(s.weaponQualityLost / n, 2)} quality${s.weaponBroken ? `, broken in ${pct(s.weaponBroken / n)} of fights (you fight on barehanded)` : ''}; armour ${fmt(s.armourWearEvents / n, 2)} wear events, ${fmt(s.armourQualityLost / n, 2)} quality${s.armourBroken ? `, a piece destroyed in ${pct(s.armourBroken / n)} of fights` : ''}. A broken item is removed and the character recomputed, as FixPlayerEquips does.`));
  cards.append(mc);

  if (P.attackSpell && S.mode === 'ranged') {
    const cc = card(`Casting ${P.attackSpell.words}`, `circle ${P.attackSpell.circle}, ${P.attackSpell.cost} mana · Casting + 5 against ${2 * P.attackSpell.circle}`);
    cc.append(h('p', {}, `Per fight: ${fmt(s.casts / n, 2)} casts, ${fmt(s.fizzles / n, 2)} fizzles, ${fmt(s.backfires / n, 2)} backfires (${fmt(s.selfDamage / n, 2)} self-damage), ${fmt(s.manaSpent / n, 1)} mana spent, ${fmt(s.manaLeft / n, 1)} left at the end.`));
    cards.append(cc);
  }
  cards.append(exactCard(P, M, S));
  out.append(cards);
}

const meanOfHist = (hst: number[]) => { const t = hst.reduce((a, b) => a + b, 0); return t ? hst.reduce((s, c, i) => s + c * i, 0) / t : 0; };
function lastNonZero(hs: number[][]) { let m = 0; for (const hh of hs) for (let i = 0; i < hh.length; i++) if (hh[i]) m = Math.max(m, i); return m; }

// ------------------------------------------------------------------ all enemies
function renderAll(out: HTMLElement, res: AllResult[], rerender: () => void) {
  clear(out);
  const u = state.combat;
  const thr = u.threshold;
  const winP = (r: AllResult) => (r.stats.outcomes[0] + (u.fleeCounts ? r.stats.outcomes[2] : 0)) / r.stats.n;
  const what = u.fleeCounts ? 'won or put to flight' : 'won';
  const worst = (r: AllResult) => { const o = r.stats.outcomes; let b = 1; for (let i = 2; i < 4; i++) if (o[i] > o[b]) b = i; return b; };
  const totalMonsters = res.reduce((s, r) => s + r.row.n, 0);
  const beaten = res.filter((r) => winP(r) >= thr).reduce((s, r) => s + r.row.n, 0);
  const cards = h('div', { class: 'cards' });

  const head = card('How many can this character beat?', `${res.length} enemy rows (${totalMonsters} monsters), ${u.allN} fights each`);
  head.append(h('p', { class: 'lead big' }, `${beaten} of ${totalMonsters}`, h('small', {}, ` monsters ${what} in at least ${pct(thr, 0)} of fights`)),
    h('p', { class: 'hint' }, 'A monster that flees escapes in this model (nobody moves); in the game you may chase it. Use the switch above to count flights as beaten.'));
  cards.append(head);

  const sc = card('Win probability by enemy', 'grouped by dungeon level; colour = the most common other outcome; click a point to open it');
  const sBox = h('div');
  const groups = levels.map((L) => `L${L.level}`);
  stripChart(sBox, res.map((r) => ({ x: 0, y: winP(r), group: r.level - 1, color: winP(r) >= 0.999 ? C.win : u.fleeCounts ? (r.stats.outcomes[1] >= r.stats.outcomes[3] ? C.death : C.timeout) : OUTCOME_COLORS[worst(r)],
    label: `L${r.level} ${rowDesc(r.row)}: win ${pct(winP(r))}, death ${pct(r.stats.outcomes[1] / r.stats.n)}, flee ${pct(r.stats.outcomes[2] / r.stats.n)}, timeout ${pct(r.stats.outcomes[3] / r.stats.n)}`,
    onClick: () => { u.level = r.level; u.row = r.rowIndex; changed('combat'); lastAll = null; rerender(); } })), groups, thr, { yLabel: 'P(win)' });
  sc.append(sBox, h('ul', { class: 'legend' }, ...[[C.win, 'always won'], [C.death, 'deaths'], [C.flee, 'flees'], [C.timeout, 'timeouts']].map(([c, l]) => h('li', {}, h('i', { class: 'sw', style: `background:${c}` }), l))));
  cards.append(sc);

  const cc = card('Enemies beaten at or above a probability', 'counting each placed monster');
  const cBox = h('div');
  const pts: [number, number][] = [];
  for (let t = 0; t <= 100; t++) pts.push([t, res.filter((r) => winP(r) >= t / 100 - 1e-12).reduce((s, r) => s + r.row.n, 0)]);
  lineChart(cBox, [{ name: 'monsters', color: C.accent, points: pts }], { xLabel: 'win probability threshold %', yLabel: 'monsters', marker: thr * 100, area: true, step: true, yfmt: (v) => v.toFixed(0) });
  cc.append(cBox);
  cards.append(cc);

  const lc = card('Per level', 'monsters beaten at the threshold vs not');
  const lBox = h('div');
  const per = levels.map((L) => {
    const rs = res.filter((r) => r.level === L.level);
    const b = rs.filter((r) => winP(r) >= thr).reduce((s, r) => s + r.row.n, 0);
    return [b, rs.reduce((s, r) => s + r.row.n, 0) - b];
  });
  stackedBars(lBox, groups, [{ name: 'beaten', color: C.win, values: per.map((p) => p[0]) }, { name: 'not beaten', color: C.death, values: per.map((p) => p[1]) }], { height: 200, yLabel: 'monsters' });
  lc.append(lBox);
  cards.append(lc);

  const tc = card('Table', 'click a row to open it in the single-enemy view');
  const tbl = h('table', { class: 'mini wide sortable' }, h('tr', {}, ...['Lvl', 'Enemy', 'HP', 'Count', 'Win', 'Death', 'Flee', 'Timeout', 'Mean length'].map((x) => h('th', {}, x))));
  for (const r of [...res].sort((a, b) => a.level - b.level || winP(b) - winP(a))) {
    const o = r.stats.outcomes, n = r.stats.n;
    const meanLen = r.stats.durSum.reduce((a, b) => a + b, 0) / n;
    tbl.append(h('tr', { class: winP(r) >= thr ? 'ok' : 'bad', onclick: () => { u.level = r.level; u.row = r.rowIndex; changed('combat'); lastAll = null; rerender(); } },
      h('td', {}, String(r.level)), h('td', {}, `${rowName(r.row)} · ${ATTITUDES[r.row.att]}`), h('td', {}, String(r.row.hp)), h('td', {}, String(r.row.n)),
      h('td', {}, pct(o[0] / n)), h('td', {}, pct(o[1] / n)), h('td', {}, pct(o[2] / n)), h('td', {}, pct(o[3] / n)), h('td', {}, `${fmt(meanLen)} s`)));
  }
  tc.append(h('div', { class: 'scroll' }, tbl));
  cards.append(tc);
  out.append(cards);
  void groupedBars;
}
