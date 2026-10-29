import './styles.css';
import { readHash, state, subscribe, changed, type Tab } from './state';
import { renderPanel } from './ui/panel';
import { renderSkills } from './ui/skills';
import { renderCombat } from './ui/combat';
import { renderChargen } from './ui/chargen';
import { h } from './ui/dom';
import { setRandModel } from './core/randdist';

readHash();
const app = document.getElementById('app')!;
const panel = h('aside', { class: 'panel', id: 'panel' });
const views = { skills: h('main', { class: 'view', id: 'view-skills' }), combat: h('main', { class: 'view', id: 'view-combat' }), chargen: h('main', { class: 'view', id: 'view-chargen' }) };
const tabBtn = (id: Tab, label: string) =>
  h('button', { class: 'tab', 'data-tab': id, onclick: () => { state.tab = id; changed('tab'); } }, label);
const collapse = h('button', { class: 'btn ghost collapse', title: 'Show or hide the character panel',
  onclick: () => { state.panelOpen = !state.panelOpen; changed('panel'); } }, 'Character');

app.append(
  h('header', { class: 'top' },
    h('div', { class: 'brand' }, h('span', { class: 'ankh', 'aria-hidden': 'true' }, '☥'), h('div', {}, h('h1', {}, 'Stygian Abyss Odds'),
      h('p', {}, 'Ultima Underworld 1 skill checks and combat, from the game\'s own code'))),
    h('nav', { class: 'tabs' }, collapse, tabBtn('chargen', 'Creation'), tabBtn('skills', 'Skills'), tabBtn('combat', 'Combat'))),
  h('div', { class: 'body' }, panel, views.chargen, views.skills, views.combat),
  h('footer', {}, 'Rules ported from ', h('a', { href: 'https://github.com/abedegno/underworld-exhumed', target: '_blank', rel: 'noopener' }, 'abedegno/underworld-exhumed'),
    '. Game data from the pristine OBJECTS.DAT, COMOBJ.DAT and LEV.ARK. Nothing leaves your browser.'));

const rendered = { skills: '', combat: '', chargen: '' };
function render(why: string) {
  setRandModel(state.combat.rand);
  document.body.classList.toggle('panel-closed', !state.panelOpen);
  collapse.classList.toggle('on', state.panelOpen);
  collapse.setAttribute('aria-pressed', String(state.panelOpen));
  for (const b of document.querySelectorAll<HTMLButtonElement>('.tab')) b.classList.toggle('on', b.dataset.tab === state.tab);
  views.skills.hidden = state.tab !== 'skills';
  views.combat.hidden = state.tab !== 'combat';
  views.chargen.hidden = state.tab !== 'chargen';
  if (why === 'init' || why.startsWith('character')) {
    renderPanel(panel);
    rendered.skills = rendered.combat = '';
  }
  // render the visible tab lazily; keep the hidden one as it was
  const key = JSON.stringify([state.character, state.combat.rand]);
  if (rendered[state.tab] !== key) {
    rendered[state.tab] = key;
    if (state.tab === 'skills') renderSkills(views.skills);
    else if (state.tab === 'chargen') renderChargen(views.chargen);
    else renderCombat(views.combat);
  }
}
subscribe((why) => { if (why === 'tab' || why === 'panel' || why.startsWith('character')) render(why); });
render('init');
