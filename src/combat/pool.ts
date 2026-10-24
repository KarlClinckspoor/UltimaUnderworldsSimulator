// A small pool of fight workers with progress and cancel.
import type { FromWorker, Job } from './worker';
import { mergeStats, type Stats } from './stats';

export interface RunHandle { cancel(): void; done: Promise<Map<string, Stats> | null> }

const size = () => Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));

/**
 * Runs jobs across workers. Jobs sharing a key are merged (that is how one enemy's N
 * fights are split over several workers). onProgress gets fights done / total.
 */
export function runJobs(jobs: Job[], onProgress: (done: number, total: number) => void): RunHandle {
  const total = jobs.reduce((s, j) => s + j.n, 0);
  const workers: Worker[] = [];
  let cancelled = false;
  const results = new Map<string, Stats>();
  const progress = new Map<Job, number>();
  let resolveFn: (v: Map<string, Stats> | null) => void = () => {};
  const done = new Promise<Map<string, Stats> | null>((r) => (resolveFn = r));
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
      results.set(m.key, prev ? mergeStats(prev, m.stats) : m.stats);
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
export function splitJob(base: Omit<Job, 'n' | 'stream'>, n: number, parts = size()): Job[] {
  const k = Math.max(1, Math.min(parts, Math.ceil(n / 500)));
  const out: Job[] = [];
  for (let i = 0; i < k; i++) {
    const m = Math.floor(n / k) + (i < n % k ? 1 : 0);
    if (m > 0) out.push({ ...base, n: m, stream: i + 1 });
  }
  return out;
}
