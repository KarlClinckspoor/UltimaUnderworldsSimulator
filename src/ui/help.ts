// "How to read this" popups on the cards: a small ? button in the card header that shows the
// text on hover, on keyboard focus and on a tap (focus), without any script of its own.
import { h } from './dom';

export function helpTip(text: string | Node) {
  return h('span', { class: 'help' },
    h('button', { type: 'button', class: 'help-btn', 'aria-label': 'How to read this' }, '?'),
    h('span', { class: 'help-pop', role: 'tooltip' }, h('b', {}, 'How to read this. '), text));
}

/** Adds a help popup to a card made by dom.card(). */
export function withHelp<T extends HTMLElement>(cardEl: T, text: string | Node): T {
  const head = cardEl.querySelector('header h3');
  if (head) head.append(helpTip(text));
  return cardEl;
}
