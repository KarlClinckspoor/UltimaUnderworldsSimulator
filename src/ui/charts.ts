// d3 charts that redraw when their card changes width (ResizeObserver).
import * as d3 from 'd3';

export const C = {
  win: '#39b58c', death: '#e46b5b', flee: '#e3b24e', timeout: '#6f7d9c',
  accent: '#6db5ff', blue: '#8aa4f0', purple: '#b48ce8', teal: '#4fd1c5', pink: '#ec8fbd',
  val: '#4fa3ff', tgt: '#ff5d5d',
  series: ['#8aa4f0', '#e3b24e', '#39b58c', '#e46b5b', '#b48ce8', '#4fd1c5', '#ec8fbd', '#6f7d9c'],
};
export const OUTCOME_COLORS = [C.win, C.death, C.flee, C.timeout];

type Svg = d3.Selection<SVGSVGElement, unknown, null, undefined>;
const observers = new WeakMap<Element, ResizeObserver>();

/** Mounts a responsive SVG in el and calls draw(svg, width, height) on every width change. */
export function chart(el: HTMLElement, height: number, draw: (svg: Svg, w: number, h: number) => void) {
  el.classList.add('chart');
  let last = -1;
  const render = () => {
    const w = Math.max(220, Math.floor(el.clientWidth));
    if (w === last) return;
    last = w;
    el.innerHTML = '';
    const svg = d3.select(el).append('svg').attr('width', w).attr('height', height).attr('viewBox', `0 0 ${w} ${height}`) as Svg;
    draw(svg, w, height);
  };
  observers.get(el)?.disconnect();
  const ro = new ResizeObserver(() => render());
  ro.observe(el);
  observers.set(el, ro);
  requestAnimationFrame(render);
}

const M = { t: 12, r: 14, b: 36, l: 46 };

function axes(svg: Svg, x: d3.AxisScale<any>, y: d3.AxisScale<any>, w: number, h: number, xl?: string, yl?: string,
  yfmt?: (v: any) => string, xticks?: number, xClass = '', yClass = '', xfmt?: (v: any) => string) {
  const ax = d3.axisBottom(x);
  if (xticks !== undefined) ax.ticks(xticks);
  if (xfmt) ax.tickFormat(xfmt as any);
  svg.append('g').attr('class', `axis ${xClass}`).attr('transform', `translate(0,${h - M.b})`).call(ax as any);
  const ay = d3.axisLeft(y).ticks(5);
  if (yfmt) ay.tickFormat(yfmt as any);
  svg.append('g').attr('class', `axis ${yClass}`).attr('transform', `translate(${M.l},0)`).call(ay as any);
  if (xl) svg.append('text').attr('class', `axis-label ${xClass}`).attr('x', (M.l + w - M.r) / 2).attr('y', h - 4).attr('text-anchor', 'middle').text(xl);
  if (yl) svg.append('text').attr('class', `axis-label ${yClass}`).attr('transform', `translate(11,${(M.t + h - M.b) / 2}) rotate(-90)`).attr('text-anchor', 'middle').text(yl);
}

export interface Series { name: string; color: string; values: number[] }

/** Stacked bars over categorical x. */
export function stackedBars(el: HTMLElement, cats: string[], series: Series[], o: { height?: number; yLabel?: string; xLabel?: string; yfmt?: (v: number) => string; tip?: (cat: string, s: Series, v: number) => string; rotate?: boolean } = {}) {
  const height = o.height ?? 220;
  chart(el, height, (svg, w, h) => {
    const bottom = o.rotate ? 70 : M.b;
    const x = d3.scaleBand().domain(cats).range([M.l, w - M.r]).padding(0.18);
    const totals = cats.map((_, i) => series.reduce((s, se) => s + Math.max(0, se.values[i] ?? 0), 0));
    const y = d3.scaleLinear().domain([0, d3.max(totals) || 1]).nice().range([h - bottom, M.t]);
    svg.append('g').attr('class', 'grid').attr('transform', `translate(${M.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(w - M.l - M.r)).tickFormat(() => '') as any);
    cats.forEach((cat, i) => {
      let acc = 0;
      for (const s of series) {
        const v = Math.max(0, s.values[i] ?? 0);
        if (!v) continue;
        svg.append('rect').attr('x', x(cat)!).attr('width', x.bandwidth()).attr('y', y(acc + v)).attr('height', Math.max(0, y(acc) - y(acc + v)))
          .attr('fill', s.color).append('title').text(o.tip ? o.tip(cat, s, v) : `${cat} · ${s.name}: ${v.toFixed(2)}`);
        acc += v;
      }
    });
    const ax = svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${h - bottom})`).call(d3.axisBottom(x) as any);
    if (o.rotate) ax.selectAll('text').attr('transform', 'rotate(-35)').attr('text-anchor', 'end').attr('dx', '-0.4em').attr('dy', '0.5em');
    const ay = d3.axisLeft(y).ticks(5);
    if (o.yfmt) ay.tickFormat(o.yfmt as any);
    svg.append('g').attr('class', 'axis').attr('transform', `translate(${M.l},0)`).call(ay as any);
    if (o.yLabel) svg.append('text').attr('class', 'axis-label').attr('transform', `translate(11,${(M.t + h - bottom) / 2}) rotate(-90)`).attr('text-anchor', 'middle').text(o.yLabel);
  });
}

/** Grouped bars: each category gets one bar per series. */
export function groupedBars(el: HTMLElement, cats: string[], series: Series[], o: { height?: number; yLabel?: string; yfmt?: (v: number) => string; yMax?: number; labels?: boolean } = {}) {
  chart(el, o.height ?? 220, (svg, w, h) => {
    const x = d3.scaleBand().domain(cats).range([M.l, w - M.r]).padding(0.2);
    const xi = d3.scaleBand().domain(series.map((s) => s.name)).range([0, x.bandwidth()]).padding(0.08);
    const ymax = o.yMax ?? (d3.max(series.flatMap((s) => s.values)) || 1);
    const y = d3.scaleLinear().domain([0, ymax]).nice().range([h - M.b, M.t]);
    svg.append('g').attr('class', 'grid').attr('transform', `translate(${M.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(w - M.l - M.r)).tickFormat(() => '') as any);
    for (const s of series) cats.forEach((cat, i) => {
      const v = s.values[i] ?? 0;
      const g = svg.append('g');
      g.append('rect').attr('x', x(cat)! + xi(s.name)!).attr('width', xi.bandwidth()).attr('y', y(v)).attr('height', y(0) - y(v)).attr('fill', s.color)
        .append('title').text(`${cat} · ${s.name}: ${o.yfmt ? o.yfmt(v) : v.toFixed(2)}`);
      if (o.labels && xi.bandwidth() > 26) g.append('text').attr('class', 'bar-label').attr('x', x(cat)! + xi(s.name)! + xi.bandwidth() / 2).attr('y', y(v) - 3).attr('text-anchor', 'middle').text(o.yfmt ? o.yfmt(v) : v.toFixed(1));
    });
    axes(svg, x, y, w, h, undefined, o.yLabel, o.yfmt);
  });
}

export interface LineSeries { name: string; color: string; points: [number, number][]; dashed?: boolean | string; width?: number }
export function lineChart(el: HTMLElement, series: LineSeries[], o: { height?: number; xLabel?: string; yLabel?: string; yDomain?: [number, number]; xDomain?: [number, number]; marker?: number | null; yfmt?: (v: number) => string; step?: boolean; area?: boolean; xClass?: string; yClass?: string } = {}) {
  chart(el, o.height ?? 220, (svg, w, h) => {
    const all = series.flatMap((s) => s.points);
    const x = d3.scaleLinear().domain(o.xDomain ?? (d3.extent(all, (p) => p[0]) as [number, number])).range([M.l, w - M.r]);
    const y = d3.scaleLinear().domain(o.yDomain ?? [0, d3.max(all, (p) => p[1]) || 1]).nice().range([h - M.b, M.t]);
    svg.append('g').attr('class', 'grid').attr('transform', `translate(${M.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(w - M.l - M.r)).tickFormat(() => '') as any);
    for (const s of series) {
      const line = d3.line<[number, number]>().x((p) => x(p[0])).y((p) => y(p[1]));
      if (o.step) line.curve(d3.curveStepAfter);
      if (o.area) {
        const area = d3.area<[number, number]>().x((p) => x(p[0])).y0(y(0)).y1((p) => y(p[1]));
        if (o.step) area.curve(d3.curveStepAfter);
        svg.append('path').attr('d', area(s.points)).attr('fill', s.color).attr('opacity', 0.18);
      }
      svg.append('path').attr('d', line(s.points)).attr('fill', 'none').attr('stroke', s.color).attr('stroke-width', s.width ?? 2)
        .attr('stroke-dasharray', typeof s.dashed === 'string' ? s.dashed : s.dashed ? '6 4' : null).append('title').text(s.name);
    }
    if (o.marker !== undefined && o.marker !== null) {
      svg.append('line').attr('class', `marker ${o.xClass ?? ''}`).attr('x1', x(o.marker)).attr('x2', x(o.marker)).attr('y1', M.t).attr('y2', h - M.b);
    }
    axes(svg, x, y, w, h, o.xLabel, o.yLabel, o.yfmt, undefined, o.xClass, o.yClass);
    // hover readout
    const tip = svg.append('text').attr('class', 'readout').attr('x', w - M.r).attr('y', M.t + 10).attr('text-anchor', 'end');
    svg.append('rect').attr('x', M.l).attr('y', M.t).attr('width', w - M.l - M.r).attr('height', h - M.t - M.b).attr('fill', 'transparent')
      .on('mousemove', (ev: MouseEvent) => {
        const [mx] = d3.pointer(ev);
        const xv = x.invert(mx);
        const parts = series.map((s) => {
          let best = s.points[0];
          for (const p of s.points) if (Math.abs(p[0] - xv) < Math.abs(best[0] - xv)) best = p;
          return best ? `${s.name}: ${o.yfmt ? o.yfmt(best[1]) : best[1].toFixed(2)}` : '';
        });
        tip.text(`x ${xv.toFixed(1)} · ${parts.join(' · ')}`);
      }).on('mouseleave', () => tip.text(''));
  });
}

/** Stacked histogram: bins are [x0, x1) of equal width. */
export function histogram(el: HTMLElement, x0: number, width: number, series: Series[], o: { height?: number; xLabel?: string; yLabel?: string; yfmt?: (v: number) => string; xfmt?: (v: number) => string; marks?: { x: number; label: string }[] } = {}) {
  chart(el, o.height ?? 200, (svg, w, h) => {
    const nb = Math.max(...series.map((s) => s.values.length), 1);
    const x = d3.scaleLinear().domain([x0, x0 + nb * width]).range([M.l, w - M.r]);
    const tot = Array.from({ length: nb }, (_, i) => series.reduce((s, se) => s + (se.values[i] ?? 0), 0));
    const y = d3.scaleLinear().domain([0, d3.max(tot) || 1]).nice().range([h - M.b, M.t]);
    svg.append('g').attr('class', 'grid').attr('transform', `translate(${M.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(w - M.l - M.r)).tickFormat(() => '') as any);
    for (let i = 0; i < nb; i++) {
      let acc = 0;
      for (const s of series) {
        const v = s.values[i] ?? 0;
        if (!v) continue;
        const bx = x(x0 + i * width), bw = Math.max(1, x(x0 + (i + 1) * width) - bx - (nb < 80 ? 1 : 0));
        svg.append('rect').attr('x', bx).attr('width', bw).attr('y', y(acc + v)).attr('height', y(acc) - y(acc + v)).attr('fill', s.color)
          .append('title').text(`${s.name}, ${o.xfmt ? o.xfmt(x0 + i * width) : (x0 + i * width).toFixed(1)}–${o.xfmt ? o.xfmt(x0 + (i + 1) * width) : (x0 + (i + 1) * width).toFixed(1)}: ${o.yfmt ? o.yfmt(v) : v}`);
        acc += v;
      }
    }
    for (const m of o.marks ?? []) {
      svg.append('line').attr('class', 'marker').attr('x1', x(m.x)).attr('x2', x(m.x)).attr('y1', M.t).attr('y2', h - M.b);
      svg.append('text').attr('class', 'mark-label').attr('x', x(m.x) + 3).attr('y', M.t + 9).text(m.label);
    }
    axes(svg, x, y, w, h, o.xLabel, o.yLabel, o.yfmt, undefined, '', '', o.xfmt);
  });
}

export function heatmap(el: HTMLElement, xs: number[], ys: number[], val: (x: number, y: number) => number, o: { height?: number; xLabel?: string; yLabel?: string; mark?: [number, number] | null; onClick?: (x: number, y: number) => void; fmt?: (v: number) => string; xClass?: string; yClass?: string } = {}) {
  chart(el, o.height ?? 300, (svg, w, h) => {
    const x = d3.scaleBand<number>().domain(xs).range([M.l, w - M.r]);
    const y = d3.scaleBand<number>().domain(ys).range([h - M.b, M.t]);
    const col = d3.scaleSequential(d3.interpolateCividis).domain([0, 1]);
    for (const xv of xs) for (const yv of ys) {
      const v = val(xv, yv);
      svg.append('rect').attr('x', x(xv)!).attr('y', y(yv)!).attr('width', x.bandwidth() + 0.5).attr('height', y.bandwidth() + 0.5).attr('fill', col(v))
        .style('cursor', o.onClick ? 'pointer' : 'default').on('click', () => o.onClick?.(xv, yv))
        .append('title').text(`value ${xv}, target ${yv}: ${o.fmt ? o.fmt(v) : v.toFixed(3)}`);
    }
    if (o.mark && xs.includes(o.mark[0]) && ys.includes(o.mark[1]))
      svg.append('rect').attr('class', 'heat-mark').attr('x', x(o.mark[0])!).attr('y', y(o.mark[1])!).attr('width', x.bandwidth()).attr('height', y.bandwidth());
    const ax = d3.axisBottom(x).tickValues(xs.filter((v) => v % 5 === 0));
    const ay = d3.axisLeft(y).tickValues(ys.filter((v) => v % 5 === 0));
    svg.append('g').attr('class', `axis ${o.xClass ?? ''}`).attr('transform', `translate(0,${h - M.b})`).call(ax as any);
    svg.append('g').attr('class', `axis ${o.yClass ?? ''}`).attr('transform', `translate(${M.l},0)`).call(ay as any);
    if (o.xLabel) svg.append('text').attr('class', `axis-label ${o.xClass ?? ''}`).attr('x', (M.l + w - M.r) / 2).attr('y', h - 4).attr('text-anchor', 'middle').text(o.xLabel);
    if (o.yLabel) svg.append('text').attr('class', `axis-label ${o.yClass ?? ''}`).attr('transform', `translate(11,${(M.t + h - M.b) / 2}) rotate(-90)`).attr('text-anchor', 'middle').text(o.yLabel);
  });
}

export interface FanBand { lo: number[]; hi: number[]; label: string; opacity: number }
/** A fan chart: nested bands (widest first) around a median line, plus a mean line and an
    optional reference line (e.g. the maximum). Steps: values hold until the next x. */
export function fanChart(el: HTMLElement, xs: number[], bands: FanBand[], median: number[], mean: number[], o: { height?: number; xLabel?: string; yLabel?: string; color?: string; yMax?: number; ref?: { y: number; label: string }; xfmt?: (v: number) => string; tipFmt?: (v: number) => string; yfmt?: (v: number) => string } = {}) {
  const color = o.color ?? C.accent;
  chart(el, o.height ?? 240, (svg, w, h) => {
    const x = d3.scaleLinear().domain([xs[0], xs[xs.length - 1] || 1]).range([M.l, w - M.r]);
    const top = Math.max(o.yMax ?? 0, d3.max(bands.flatMap((b) => b.hi)) ?? 1, 1);
    const y = d3.scaleLinear().domain([0, top]).nice().range([h - M.b, M.t]);
    svg.append('g').attr('class', 'grid').attr('transform', `translate(${M.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(w - M.l - M.r)).tickFormat(() => '') as any);
    const idx = xs.map((_, i) => i);
    for (const b of bands) {
      const area = d3.area<number>().x((i) => x(xs[i])).y0((i) => y(b.lo[i])).y1((i) => y(b.hi[i])).curve(d3.curveStepAfter);
      svg.append('path').attr('d', area(idx)).attr('fill', color).attr('opacity', b.opacity).append('title').text(b.label);
    }
    const line = (vals: number[], curve: d3.CurveFactory) => d3.line<number>().x((i) => x(xs[i])).y((i) => y(vals[i])).curve(curve)(idx);
    svg.append('path').attr('d', line(median, d3.curveStepAfter)).attr('fill', 'none').attr('stroke', color).attr('stroke-width', 2).append('title').text('median');
    svg.append('path').attr('d', line(mean, d3.curveLinear)).attr('fill', 'none').attr('stroke', 'var(--text)').attr('stroke-width', 1.4).attr('stroke-dasharray', '5 4').append('title').text('mean');
    if (o.ref) {
      svg.append('line').attr('class', 'marker').attr('x1', M.l).attr('x2', w - M.r).attr('y1', y(o.ref.y)).attr('y2', y(o.ref.y));
      svg.append('text').attr('class', 'mark-label').attr('x', w - M.r - 2).attr('y', y(o.ref.y) - 4).attr('text-anchor', 'end').text(o.ref.label);
    }
    axes(svg, x, y, w, h, o.xLabel, o.yLabel, o.yfmt, undefined, '', '', o.xfmt);
    const tip = svg.append('text').attr('class', 'readout').attr('x', w - M.r).attr('y', M.t + 10).attr('text-anchor', 'end');
    svg.append('rect').attr('x', M.l).attr('y', M.t).attr('width', w - M.l - M.r).attr('height', h - M.t - M.b).attr('fill', 'transparent')
      .on('mousemove', (ev: MouseEvent) => {
        const xv = x.invert(d3.pointer(ev)[0]);
        let i = 0;
        while (i + 1 < xs.length && xs[i + 1] <= xv) i++;
        const fx = o.tipFmt ?? o.xfmt ?? ((v: number) => v.toFixed(0));
        tip.text(`${fx(xs[i])} · median ${median[i]} · mean ${mean[i].toFixed(1)} · ${bands.map((b) => `${b.label} ${b.lo[i]}–${b.hi[i]}`).join(' · ')}`);
      }).on('mouseleave', () => tip.text(''));
  });
}

export interface StripPoint { x: number; y: number; color: string; label: string; group: number; onClick?: () => void }
/** Points grouped along x (e.g. by dungeon level), y in [0,1], with a threshold line. */
export function stripChart(el: HTMLElement, pts: StripPoint[], groups: string[], threshold: number, o: { height?: number; yLabel?: string } = {}) {
  chart(el, o.height ?? 260, (svg, w, h) => {
    const x = d3.scaleBand<number>().domain(groups.map((_, i) => i)).range([M.l, w - M.r]).padding(0.08);
    const y = d3.scaleLinear().domain([0, 1]).range([h - M.b, M.t]);
    svg.append('g').attr('class', 'grid').attr('transform', `translate(${M.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(w - M.l - M.r)).tickFormat(() => '') as any);
    groups.forEach((_, gi) => {
      const g = pts.filter((p) => p.group === gi).sort((a, b) => b.y - a.y);
      const bw = x.bandwidth();
      g.forEach((p, i) => {
        const cx = x(gi)! + (g.length > 1 ? (i / (g.length - 1)) * (bw - 6) + 3 : bw / 2);
        svg.append('circle').attr('cx', cx).attr('cy', y(p.y)).attr('r', 3.2).attr('fill', p.color).attr('opacity', 0.9)
          .style('cursor', p.onClick ? 'pointer' : 'default').on('click', () => p.onClick?.())
          .append('title').text(p.label);
      });
    });
    svg.append('line').attr('class', 'marker').attr('x1', M.l).attr('x2', w - M.r).attr('y1', y(threshold)).attr('y2', y(threshold));
    svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${h - M.b})`).call(d3.axisBottom(x).tickFormat((i) => groups[i as number]) as any);
    svg.append('g').attr('class', 'axis').attr('transform', `translate(${M.l},0)`).call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('.0%')) as any);
    if (o.yLabel) svg.append('text').attr('class', 'axis-label').attr('transform', `translate(11,${(M.t + h - M.b) / 2}) rotate(-90)`).attr('text-anchor', 'middle').text(o.yLabel);
  });
}

/** A horizontal 100% bar with labelled segments. */
export function shareBar(el: HTMLElement, parts: { label: string; value: number; color: string }[]) {
  el.classList.add('sharebar');
  el.innerHTML = '';
  const tot = parts.reduce((s, p) => s + p.value, 0) || 1;
  for (const p of parts) {
    if (!p.value) continue;
    const seg = document.createElement('div');
    seg.style.flex = String(p.value / tot);
    seg.style.background = p.color;
    seg.title = `${p.label}: ${((100 * p.value) / tot).toFixed(1)}%`;
    if (p.value / tot > 0.08) seg.textContent = `${p.label} ${((100 * p.value) / tot).toFixed(0)}%`;
    el.append(seg);
  }
}
