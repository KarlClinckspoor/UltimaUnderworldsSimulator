// The character panel shared by both tabs.
import {
  BUFF_SPELLS, characterFromSave, defaultCharacter, derive, derivedMaxHp, derivedMaxMana, itemLabel, levelFromExp,
  maxWeight, shieldSlot, SLOT_NAMES, spellLabel, spellStatus, weaponSlot, ZONE_NAMES, type Character, type Enchant,
} from '../core/character';
import { readPlayerDat } from '../core/playerdat';
import { pPass } from '../core/skillcheck';
import { armour as ARMOUR, RUNES, SK, SKILLS, spells } from '../data/gameData';
import { changed, state } from '../state';
import { clear, h, numInput, pct, select, toggle } from './dom';
import { describeEnchant, ENCHANT_NAME_NOTE } from '../core/enchantNames';

const RES_NAMES: [number, string][] = [[0x40, 'missiles'], [0x08, 'fire'], [0x10, 'poison'], [0x03, 'magic (chance)']];

function itemsForSlot(c: Character, s: number): number[] {
  const byCat = (cats: number[]) => ARMOUR.filter((a) => cats.includes(a.category) && !a.name.startsWith('item')).map((a) => a.id);
  if (s === 0) return byCat([8]);
  if (s === 1) return byCat([1]);
  if (s === 2) return byCat([4]);
  if (s === 3) return byCat([3]);
  if (s === 4) return byCat([5]);
  if (s === 9 || s === 10) return byCat([9]);
  if (s === weaponSlot(c)) return [...Array(15).keys(), 0x18, 0x19, 0x1a, 0x1f];
  if (s === shieldSlot(c)) return byCat([0]);
  return [];
}

// options show the name the game gives ("of ...") and what the code does
const encOpt = (isWeapon: boolean, effect: number): [string, string] => {
  const d = describeEnchant(isWeapon, { major: 12, effect })!;
  return [`12:${effect}`, `"${d.gameName}": ${d.effect}`];
};
const ENCH_GROUPS: { label: string; opts: [string, string][] }[] = [
  { label: 'Weapon (class 12): the game\'s name, then what it does', opts: Array.from({ length: 16 }, (_, i) => encOpt(true, i)) },
  { label: 'Worn item (class 12): the game\'s name, then what it does', opts: Array.from({ length: 16 }, (_, i) => encOpt(false, i)) },
  { label: 'Spell effects on a worn item', opts: [
    ['2:2', 'Resist Blows (+2 armour, all)'], ['2:3', 'Thick Skin (+3 armour, all)'], ['2:5', 'Iron Flesh (+5 armour, all)'],
    ['3:1', 'Protection (monsters -3 to hit)'], ['3:5', 'Missile Protection'], ['3:6', 'Flameproof'], ['3:7', 'Poison Resistance'],
    ['11:2', 'Speed (Haste)']] },
];

function enchSelect(c: Character, slot: number, ench: Enchant | null, onChange: (e: Enchant | null) => void) {
  const isWeapon = slot === weaponSlot(c);
  const s = h('select', { class: 'ench', onchange: (e: Event) => {
    const v = (e.target as HTMLSelectElement).value;
    if (!v) return onChange(null);
    const [major, effect] = v.split(':').map(Number);
    onChange({ major, effect });
  } });
  s.append(h('option', { value: '' }, 'no enchantment'));
  const cur = ench ? `${ench.major}:${ench.effect}` : '';
  let found = !ench;
  for (const g of ENCH_GROUPS) {
    if (isWeapon ? g.label.startsWith('Worn') || g.label.startsWith('Spell') : g.label.startsWith('Weapon')) continue;
    const og = h('optgroup', { label: g.label });
    for (const [v, l] of g.opts) { og.append(h('option', { value: v, selected: v === cur }, l)); if (v === cur) found = true; }
    s.append(og);
  }
  if (!found && ench) s.append(h('option', { value: cur, selected: true }, `class ${ench.major}, effect ${ench.effect}`));
  return s;
}

export function renderPanel(root: HTMLElement) {
  const c = state.character;
  const d = derive(c);
  const set = (f: () => void, why = 'character') => { f(); changed(why); };
  clear(root);

  // ---- load / reset
  const file = h('input', { type: 'file', accept: '.dat,.DAT', class: 'hidden', onchange: async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) await load(f);
  } });
  const status = h('p', { class: 'load-status' });
  const load = async (f: File) => {
    try {
      const p = readPlayerDat(new Uint8Array(await f.arrayBuffer()));
      if (p.problems.length) status.textContent = `Read with warnings: ${p.problems.join('; ')}`;
      state.character = characterFromSave(p);
      changed('character-load');
    } catch (err) { status.textContent = `Could not read ${f.name}: ${(err as Error).message}`; }
  };
  const drop = h('div', { class: 'drop', ondragover: (e: DragEvent) => { e.preventDefault(); drop.classList.add('over'); },
    ondragleave: () => drop.classList.remove('over'),
    ondrop: (e: DragEvent) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer?.files[0]; if (f) load(f); } },
    h('button', { class: 'btn', onclick: () => file.click() }, 'Load PLAYER.DAT'),
    h('span', {}, ' or drop it here'), file,
    h('button', { class: 'btn ghost', title: 'Reset to a fresh level-1 character', onclick: () => set(() => { state.character = defaultCharacter(); }) }, 'Reset'));
  root.append(h('div', { class: 'panel-sec' }, drop, status,
    h('p', { class: 'hint' }, 'Read in your browser only. From the save: attributes, skills, HP, mana, runes and equipment slots 0-10 (the pack is ignored).')));

  // ---- attributes
  const lvFromXp = levelFromExp(c.expRaw);
  root.append(h('div', { class: 'panel-sec' },
    h('h4', {}, c.name || 'Character'),
    h('div', { class: 'grid3' },
      lab('STR', numInput(c.str, 1, 40, (v) => set(() => (c.str = v)))),
      lab('DEX', numInput(c.dex, 1, 40, (v) => set(() => (c.dex = v)))),
      lab('INT', numInput(c.int, 1, 40, (v) => set(() => (c.int = v)))),
      lab('Level', numInput(c.level, 1, 16, (v) => set(() => (c.level = v)))),
      lab('HP now', numInput(c.hp, 1, 255, (v) => set(() => (c.hp = v)))),
      lab('Mana now', numInput(c.mana, 0, 255, (v) => set(() => (c.mana = v))))),
    h('div', { class: 'row wrap' },
      toggle('Easy mode', c.easy, (v) => set(() => (c.easy = v)), 'PLAYER.DAT byte 0xB4: +7 to hit, damage taken halved'),
      toggle('Start at full HP & mana', c.fullHp, (v) => set(() => (c.fullHp = v)))),
    h('p', { class: 'derived' },
      `Max HP ${d.maxHp} (30 + level × STR / 5 = ${derivedMaxHp(c)}) · max mana ${d.maxMana} ((Mana+1) × INT ≫ 3 = ${derivedMaxMana(c)}) · carry ${maxWeight(c)}`,
      c.expRaw ? ` · XP ${Math.floor(c.expRaw / 10)} (level ${lvFromXp} by XP)` : ''),
  ));

  // ---- skills
  const sk = h('div', { class: 'skills' });
  SKILLS.forEach((name, i) => sk.append(lab(name, numInput(c.skills[i], 0, 30, (v) => set(() => (c.skills[i] = v))))));
  root.append(h('div', { class: 'panel-sec' }, h('h4', {}, 'Skills'), sk));

  // ---- derived combat values
  const resNames = RES_NAMES.filter(([b]) => d.resist & b).map(([, n]) => n);
  root.append(h('div', { class: 'panel-sec' }, h('h4', {}, 'Combat values'),
    h('table', { class: 'mini' },
      h('tr', {}, h('th', {}, 'Location'), h('th', {}, 'Armour'), h('th', {}, 'items/spell/tough'), h('th', { title: 'subtracted from the monster to-hit' }, 'to-hit prot.')),
      ...ZONE_NAMES.map((z, i) => h('tr', {}, h('td', {}, z), h('td', {}, String(d.armour[i])),
        h('td', { class: 'muted' }, `${d.armourParts[i].items}/${d.armourParts[i].spell}/${d.armourParts[i].toughness}`), h('td', {}, String(d.cmbModTH[i]))))),
    h('p', { class: 'derived' }, `Defence (monsters roll against it): Defense ${c.skills[SK.Defense]} + ${SKILLS[d.defenceSkill]} ${c.skills[d.defenceSkill]} / 2 = `, h('b', {}, String(d.defence))),
    h('p', { class: 'derived' }, `Resists: ${resNames.length ? resNames.join(', ') : 'nothing'}${d.hasted ? ' · Hasted' : ''}${d.timeStop ? ' · Time stopped' : ''}`),
    ...d.notes.map((n) => h('p', { class: 'warn' }, n)),
  ));

  // ---- equipment
  const eq = h('div', { class: 'equip' });
  for (let s = 0; s <= 10; s++) {
    const e = c.equipment[s];
    const ids = itemsForSlot(c, s);
    if (e && !ids.includes(e.itemId)) ids.unshift(e.itemId);
    let role = SLOT_NAMES[s];
    if (s === weaponSlot(c)) role += ' · weapon'; else if (s === shieldSlot(c)) role += ' · shield';
    if (!ids.length && !e) continue;
    const opts: [number, string][] = [[-1, s === weaponSlot(c) ? '(bare hand)' : '(empty)'], ...ids.map((id) => [id, itemLabel(id)] as [number, string])];
    const row = h('div', { class: 'eq-row' },
      h('span', { class: 'eq-slot' }, role),
      select(e ? e.itemId : -1, opts, (v) => set(() => {
        if (v === -1) delete c.equipment[s]; else c.equipment[s] = { itemId: v, quality: e?.quality ?? 63, ench: e?.ench ?? null };
      })));
    if (e) {
      row.append(h('span', { class: 'eq-q', title: 'quality 0..63: armour value = (quality × protection ≫ 6) + 1' }, 'q ',
        numInput(e.quality, 1, 63, (v) => set(() => (e.quality = v)))));
      row.append(enchSelect(c, s, e.ench, (en) => set(() => (e.ench = en))));
      if (e.ench?.major === 12 && (e.ench.effect & 8) && s > 4 && s !== weaponSlot(c))
        row.append(h('p', { class: 'warn eq-note' }, '⚠ Toughness on a shield or ring goes twice to the torso and not at all to the arms (player_affected_by adds it to the first of its two locations each time); the simulator does the same.'));
    }
    eq.append(row);
  }
  root.append(h('div', { class: 'panel-sec' }, h('h4', {}, 'Equipment'), eq,
    h('p', { class: 'hint' }, `Hands follow the save's lefty bit (${c.lefty}): the weapon is in slot ${weaponSlot(c)}, the shield in slot ${shieldSlot(c)}. Enchantments on shoulders and on the weapon only act through the weapon's own to-hit/damage (ObjWorn).`),
    h('details', { class: 'hint ench-note' }, h('summary', {}, 'Enchantment names: are "Accuracy" and "Damage" swapped? Not in UW1'), h('p', {}, ENCHANT_NAME_NOTE)),
    toggle('Swap hands (lefty bit)', c.lefty === 0, (v) => set(() => { c.lefty = v ? 0 : 1; }))));

  // ---- runes & buffs
  const rb = h('div', { class: 'runes' });
  RUNES.forEach((r, i) => rb.append(h('button', { class: `rune ${c.runes.includes(i) ? 'on' : ''}`, title: c.runes.includes(i) ? 'in the rune bag' : 'not in the bag',
    onclick: () => set(() => { c.runes = c.runes.includes(i) ? c.runes.filter((x) => x !== i) : [...c.runes, i].sort((a, b) => a - b); }) }, r)));
  const st = spellStatus(c);
  const buffs = h('div', { class: 'buffs' });
  for (const idx of BUFF_SPELLS) {
    const s = st[idx];
    const sp = spells[idx];
    const on = c.buffs.includes(idx);
    const odds = pPass(c.skills[SK.Casting] + 5, 2 * sp.circle!);
    buffs.append(h('label', { class: `buff ${s.castable ? '' : 'off'}`, title: s.castable ? `cast odds ${pct(odds)} (Casting + 5 vs ${2 * sp.circle!})` : s.reasons.join('; ') },
      h('input', { type: 'checkbox', checked: on, disabled: !s.castable && !on, onchange: (e: Event) => set(() => {
        c.buffs = (e.target as HTMLInputElement).checked ? [...c.buffs, idx] : c.buffs.filter((x) => x !== idx);
      }) }),
      h('span', {}, `${spellLabel(idx)} `, h('small', {}, `c${sp.circle} · ${3 * sp.circle!} mana${s.castable ? '' : ' · ' + s.reasons.join(', ')}`))));
  }
  root.append(h('div', { class: 'panel-sec' }, h('h4', {}, 'Runes'), rb, h('h4', {}, 'Buffs (pre-cast at 100%)'), buffs,
    toggle(`Pay buff mana from the starting mana (${d.buffMana})`, c.payBuffMana, (v) => set(() => (c.payBuffMana = v))),
    h('p', { class: 'hint' }, 'A spell is offered when its runes are in the bag, (level + 1) / 2 ≥ circle and 3 × circle ≤ max mana; at most three are active.')));
}

const lab = (t: string, input: HTMLElement) => h('label', { class: 'lab' }, h('span', {}, t), input);
