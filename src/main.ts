import './styles.css';
import { readHash, state, subscribe, changed } from './state';
import { renderPanel } from './ui/panel';
import { renderSkills } from './ui/skills';
import { renderCombat } from './ui/combat';
import { h } from './ui/dom';
import { setRandModel } from './core/randdist';

readHash();
const app = document.getElementById('app')!;
const panel = h('aside', { class: 'panel', id: 'panel' });
const views = { skills: h('main', { class: 'view', id: 'view-skills' }), combat: h('main', { class: 'view', id: 'view-combat' }) };
const tabBtn = (id: 'skills' | 'combat', label: string) =>
  h('button', { class: 'tab', 'data-tab': id, onclick: () => { state.tab = id; changed('tab'); } }, label);
const collapse = h('button', { class: 'btn ghost collapse', title: 'Show or hide the character panel',
  onclick: () => { state.panelOpen = !state.panelOpen; changed('panel'); } }, 'Character');

app.append(
  h('header', { class: 'top' },
    h('div', { class: 'brand' }, h('span', { class: 'ankh', 'aria-hidden': 'true' }, '◈'), h('div', {}, h('h1', {}, 'Labyrinth of Worlds Odds'),
      h('p', {}, 'Ultima Underworld II skill checks and combat, from the game\'s own code'))),
    h('nav', { class: 'tabs' }, collapse, tabBtn('skills', 'Skills'), tabBtn('combat', 'Combat'))),
  h('div', { class: 'body' }, panel, views.skills, views.combat),
  h('footer', {}, 'Rules ported from ', h('a', { href: 'https://github.com/abedegno/underworld-exhumed', target: '_blank', rel: 'noopener' }, 'abedegno/underworld-exhumed'),
    ' (UW2 sources). Game data from the pristine UW2 OBJECTS.DAT, COMOBJ.DAT, LEV.ARK, WEAP.DAT, AS.AN and CR.AN. Nothing leaves your browser.'));

const rendered = { skills: '', combat: '' };
function render(why: string) {
  setRandModel(state.combat.rand);
  document.body.classList.toggle('panel-closed', !state.panelOpen);
  for (const b of document.querySelectorAll<HTMLButtonElement>('.tab')) b.classList.toggle('on', b.dataset.tab === state.tab);
  views.skills.hidden = state.tab !== 'skills';
  views.combat.hidden = state.tab !== 'combat';
  if (why === 'init' || why.startsWith('character')) {
    renderPanel(panel);
    rendered.skills = rendered.combat = '';
  }
  // render the visible tab lazily; keep the hidden one as it was
  const key = JSON.stringify([state.character, state.combat.rand]);
  if (rendered[state.tab] !== key) {
    rendered[state.tab] = key;
    if (state.tab === 'skills') renderSkills(views.skills); else renderCombat(views.combat);
  }
}
subscribe((why) => { if (why === 'tab' || why === 'panel' || why.startsWith('character')) render(why); });
render('init');
