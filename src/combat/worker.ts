// Web Worker: runs batches of fights with its own seeded random stream.
import { blockSize, makeRng } from '../core/rng';
import { newStats, simulate, type HpMode } from './fight';
import type { FightSettings, MonsterProfile, PlayerProfile } from './setup';
import type { Stats } from './stats';

export interface Job {
  key: string; P: PlayerProfile; M: MonsterProfile; S: FightSettings; hpMode: HpMode; n: number; seed: number;
  stream: number; streams: number;   // this job's block of the generator's cycle, of `streams` equal blocks
}
export type FromWorker = { type: 'done'; key: string; stats: Stats } | { type: 'progress'; key: string; done: number };

self.onmessage = (e: MessageEvent<Job>) => {
  const j = e.data;
  const rng = makeRng(j.seed, j.stream, j.S.rand, j.streams);
  const st = newStats(j.P, j.M, j.S);
  const chunk = 250;
  for (let done = 0; done < j.n; done += chunk) {
    simulate(st, j.P, j.M, j.S, j.hpMode, Math.min(chunk, j.n - done), rng);
    (self as unknown as Worker).postMessage({ type: 'progress', key: j.key, done: Math.min(j.n, done + chunk) } satisfies FromWorker);
  }
  if (j.S.rand === 'game' && rng.draws > blockSize(j.streams)) st.blockOverruns++;
  (self as unknown as Worker).postMessage({ type: 'done', key: j.key, stats: st } satisfies FromWorker);
};
