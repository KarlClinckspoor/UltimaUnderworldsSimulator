// Formulas: LaTeX rendered by KaTeX (loaded on first use) next to the same rule in Python.
// \V{...} marks a value (blue) and \T{...} a target (red), in both the maths and the code.
import { h } from './dom';

type Katex = typeof import('katex');
let katexP: Promise<Katex> | null = null;
const loadKatex = () => (katexP ??= Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => ((m as any).default ?? m) as Katex));

const MACROS = { '\\V': '\\htmlClass{val}{#1}', '\\T': '\\htmlClass{tgt}{#1}' };

/** Renders LaTeX into el (display style unless inline). */
export function tex(src: string, inline = false) {
  const el = h(inline ? 'span' : 'div', { class: inline ? 'tex' : 'tex display' }, src);
  loadKatex().then((k) => {
    try { k.render(src, el, { displayMode: !inline, throwOnError: false, trust: true, strict: false, macros: { ...MACROS } }); }
    catch { el.textContent = src; }
  }).catch(() => { el.textContent = src; });
  return el;
}

/** The LaTeX source as people would paste it elsewhere: the colour macros become plain. */
const plainTex = (src: string) => src.replace(/\\[VT]\{/g, '{');

function copyBtn(label: string, text: () => string) {
  const b = h('button', { class: 'btn ghost tiny', type: 'button', title: `Copy the ${label}` }, `copy ${label}`);
  b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text()); b.textContent = 'copied'; }
    catch { b.textContent = 'copy failed'; }
    setTimeout(() => { b.textContent = `copy ${label}`; }, 1200);
  });
  return b;
}

/** Python with the words value and target (and any extra names) coloured. */
function pyBlock(code: string, vNames: string[], tNames: string[]) {
  const pre = h('pre', { class: 'py' });
  const code$ = h('code', {});
  const words = [...vNames.map((w) => [w, 'val']), ...tNames.map((w) => [w, 'tgt'])] as [string, string][];
  const re = words.length ? new RegExp(`\\b(${words.map(([w]) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g') : null;
  for (const line of code.split('\n')) {
    const hash = line.indexOf('#');
    const body = hash >= 0 ? line.slice(0, hash) : line, comment = hash >= 0 ? line.slice(hash) : '';
    let last = 0;
    if (re) for (const m of body.matchAll(re)) {
      code$.append(body.slice(last, m.index));
      code$.append(h('span', { class: words.find(([w]) => w === m[0])![1] }, m[0]));
      last = m.index! + m[0].length;
    }
    code$.append(body.slice(last));
    if (comment) code$.append(h('span', { class: 'cm' }, comment));
    code$.append('\n');
  }
  pre.append(code$);
  return pre;
}

/** A formula block: rendered maths, then the Python, each with a copy button. */
export function formula(texSrc: string, py: string, o: { vNames?: string[]; tNames?: string[] } = {}) {
  const pyText = py.replace(/\s+$/, '');
  return h('div', { class: 'formula' },
    tex(texSrc),
    pyBlock(pyText, o.vNames ?? ['value'], o.tNames ?? ['target']),
    h('div', { class: 'row copy-row' }, copyBtn('LaTeX', () => plainTex(texSrc)), copyBtn('Python', () => pyText)));
}
