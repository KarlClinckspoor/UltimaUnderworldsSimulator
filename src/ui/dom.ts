// Tiny DOM helpers.
type Attrs = Record<string, string | number | boolean | ((e: any) => void) | undefined | null>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as any);
    else if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k === 'value') (el as any).value = v;
    else if (k === 'checked') (el as any).checked = !!v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export const clear = (el: Element) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

export function numInput(value: number, min: number, max: number, onChange: (v: number) => void, attrs: Attrs = {}) {
  return h('input', {
    type: 'number', value, min, max, step: 1, class: 'num', ...attrs,
    onchange: (e: Event) => {
      const el = e.target as HTMLInputElement;
      let v = Math.round(Number(el.value));
      if (!Number.isFinite(v)) v = min;
      v = Math.max(min, Math.min(max, v));
      el.value = String(v);
      onChange(v);
    },
  });
}

export function select<T extends string | number>(value: T, options: [T, string][], onChange: (v: T) => void, attrs: Attrs = {}) {
  const s = h('select', { ...attrs, onchange: (e: Event) => {
    const raw = (e.target as HTMLSelectElement).value;
    const found = options.find(([v]) => String(v) === raw);
    if (found) onChange(found[0]);
  } });
  for (const [v, label] of options) s.append(h('option', { value: String(v), selected: v === value }, label));
  return s;
}

export function toggle(label: string, checked: boolean, onChange: (v: boolean) => void, title?: string) {
  return h('label', { class: 'toggle', title }, h('input', { type: 'checkbox', checked, onchange: (e: Event) => onChange((e.target as HTMLInputElement).checked) }), h('span', {}, label));
}

export const card = (title: string, sub?: string | Node, ...kids: (Node | null)[]) =>
  h('section', { class: 'card' }, h('header', {}, h('h3', {}, title), sub ? h('p', { class: 'sub' }, sub) : null), ...kids);

export const pct = (p: number, d = 1) => `${(100 * p).toFixed(d)}%`;
export const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-');
