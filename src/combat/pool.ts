// A small pool of fight workers with progress and cancel.
import type { AnyJob, FromWorker, Job } from './worker';
import type { Stats } from './stats';

export interface RunHandle<T = Stats> { cancel(): void; done: Promise<Map<string, T> | null> }

/** Adds b into a: numbers add, arrays add element by element (growing as needed), objects recurse. */
export function mergeDeep<T>(a: T, b: T): T {
  const add = (x: any, y: any): any => {
    if (typeof y === 'number') return (x ?? 0) + y;
    if (Array.isArray(y)) { if (!Array.isArray(x)) x = []; for (let i = 0; i < y.length; i++) x[i] = add(x[i], y[i]); return x; }
    if (y && typeof y === 'object') { if (!x || typeof x !== 'object') x = {}; for (const k of Object.keys(y)) x[k] = add(x[k], y[k]); return x; }
    return x ?? y;
  };
  return add(a, b);
}

const size = () => Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));

/**
 * Runs jobs across workers. Jobs sharing a key are merged (that is how one enemy's N
 * fights are split over several workers). onProgress gets fights done / total.
 */
export function runJobs<T = Stats>(jobs: AnyJob[], onProgress: (done: number, total: number) => void): RunHandle<T> {
  const total = jobs.reduce((s, j) => s + j.n, 0);
  const workers: Worker[] = [];
  let cancelled = false;
  const results = new Map<string, T>();
  const progress = new Map<AnyJob, number>();
  let resolveFn: (v: Map<string, T> | null) => void = () => {};
  const done = new Promise<Map<string, T> | null>((r) => (resolveFn = r));
  const queue = [...jobs];
  let running = 0;
  const report = () => onProgress([...progress.values()].reduce((a, b) => a + b, 0), total);

  const startNext = (w: Worker) => {
    const job = queue.shift();
    if (!job) { w.terminate(); if (--running === 0 && !cancelled) resolveFn(results); return; }
    progress.set(job, 0);
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === 'progress') { progress.set(job, m.done); report(); return; }
      const prev = results.get(m.key);
      results.set(m.key, prev ? mergeDeep(prev, m.stats as T) : (m.stats as T));
      startNext(w);
    };
    w.onerror = (err) => { console.error(err); cancel(); resolveFn(null); };
    w.postMessage(job);
  };
  const cancel = () => { cancelled = true; workers.forEach((w) => w.terminate()); resolveFn(null); };
  const n = Math.min(size(), jobs.length);
  for (let i = 0; i < n; i++) {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    workers.push(w);
    running++;
    startNext(w);
  }
  if (n === 0) resolveFn(results);
  return { cancel, done };
}

/** Splits one enemy's N fights into a few jobs on independent streams. */
export function splitJob(base: Omit<Job, 'n' | 'stream' | 'streams'>, n: number, parts = size()): Job[] {
  const k = Math.max(1, Math.min(parts, Math.ceil(n / 500)));
  const out: Job[] = [];
  for (let i = 0; i < k; i++) {
    const m = Math.floor(n / k) + (i < n % k ? 1 : 0);
    if (m > 0) out.push({ ...base, n: m, stream: i, streams: k });
  }
  return out;
}
