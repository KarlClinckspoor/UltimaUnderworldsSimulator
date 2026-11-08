// Web Worker: runs batches of fights (player vs monster) or duels (monster vs monster, the arena),
// each job with its own block of the random stream.
import { blockSize, makeRng, type RandModel } from '../core/rng';
import { newStats, simulate, type HpMode } from './fight';
import { emptyDuelStats, simulateDuels, type DuelSettings, type DuelStats } from './duel';
import type { FightSettings, MonsterProfile, PlayerProfile } from './setup';
import type { Stats } from './stats';

export interface Job {
  kind?: 'fight';
  key: string; P: PlayerProfile; M: MonsterProfile; S: FightSettings; hpMode: HpMode; n: number; seed: number;
  stream: number; streams: number;   // this job's block of the generator's cycle, of `streams` equal blocks
}
export interface DuelJob {
  kind: 'duel';
  key: string; A: MonsterProfile; B: MonsterProfile; S: DuelSettings; rand: RandModel; n: number; seed: number;
  stream: number; streams: number;
}
export type AnyJob = Job | DuelJob;
export type FromWorker = { type: 'done'; key: string; stats: Stats | DuelStats } | { type: 'progress'; key: string; done: number };

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);

self.onmessage = (e: MessageEvent<AnyJob>) => {
  const j = e.data;
  if (j.kind === 'duel') {
    const rng = makeRng(j.seed, j.stream, j.rand, j.streams);
    const st = emptyDuelStats(j.S);
    simulateDuels(st, j.A, j.B, j.S, j.n, rng);
    if (j.rand === 'game' && rng.draws > blockSize(j.streams)) st.blockOverruns++;
    post({ type: 'progress', key: j.key, done: j.n });
    post({ type: 'done', key: j.key, stats: st });
    return;
  }
  const rng = makeRng(j.seed, j.stream, j.S.rand, j.streams);
  const st = newStats(j.P, j.M, j.S);
  const chunk = 250;
  for (let done = 0; done < j.n; done += chunk) {
    simulate(st, j.P, j.M, j.S, j.hpMode, Math.min(chunk, j.n - done), rng);
    post({ type: 'progress', key: j.key, done: Math.min(j.n, done + chunk) });
  }
  if (j.S.rand === 'game' && rng.draws > blockSize(j.streams)) st.blockOverruns++;
  post({ type: 'done', key: j.key, stats: st });
};
