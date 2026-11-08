// Ratings from a round robin (plan C4): a Bradley-Terry model fitted by maximum likelihood with the MM
// algorithm (Hunter 2004), shown on the Elo scale. With every pair played, this is the order-free answer
// that sequential Elo updates only approximate (their result depends on the order of the games and on K).

export interface PairCounts {
  i: number; j: number;
  iWins: number; jWins: number; iFled: number; jFled: number; timeouts: number;
}
export interface Scoring {
  flee: 'loss' | 'draw';           // the one who fled loses (default), or the fight counts as a draw
  timeout: 'draw' | 'ignore';      // a timeout is a draw (default), or is left out
}
export const defaultScoring = (): Scoring => ({ flee: 'loss', timeout: 'draw' });

export interface RatingResult {
  rating: number[];        // Elo scale, mean of the rated entrants 1500; NaN when unrated
  ci: number[];            // half-width of the 95% interval
  score: number[];         // points won (draws ½)
  games: number[];         // games counted
  rated: boolean[];        // false: excluded, or no counted game
  iterations: number;
  /** points and games of i against j, after scoring */
  W: number[][]; G: number[][];
}

/** Points for i, points for j and games counted, from one pair's outcome counts. */
export function scorePair(p: PairCounts, s: Scoring): { wi: number; wj: number; g: number } {
  let wi = p.iWins, wj = p.jWins, g = p.iWins + p.jWins;
  if (s.flee === 'loss') { wi += p.jFled; wj += p.iFled; } else { wi += (p.iFled + p.jFled) / 2; wj += (p.iFled + p.jFled) / 2; }
  g += p.iFled + p.jFled;
  if (s.timeout === 'draw') { wi += p.timeouts / 2; wj += p.timeouts / 2; g += p.timeouts; }
  return { wi, wj, g };
}

const ELO = 400 / Math.LN10;

/**
 * Fits ratings for k entrants. `prior` virtual games per pair, split as a draw, keep a perfect or a
 * winless record finite (a weak pull toward the pair being even; 1 game against hundreds of real ones).
 * Entrants in `exclude` (the arena excludes those that never damage anyone) and those with no counted
 * game are left unrated, and their games do not count for the others.
 */
export function fitRatings(k: number, pairs: PairCounts[], scoring: Scoring = defaultScoring(), prior = 1,
  exclude: boolean[] = []): RatingResult {
  const W = Array.from({ length: k }, () => new Array(k).fill(0));
  const G = Array.from({ length: k }, () => new Array(k).fill(0));
  for (const p of pairs) {
    if (exclude[p.i] || exclude[p.j]) continue;
    const { wi, wj, g } = scorePair(p, scoring);
    W[p.i][p.j] += wi; W[p.j][p.i] += wj;
    G[p.i][p.j] += g; G[p.j][p.i] += g;
  }
  const games = G.map((r) => r.reduce((a, b) => a + b, 0));
  const score = W.map((r) => r.reduce((a, b) => a + b, 0));
  const rated = games.map((g, i) => g > 0 && !exclude[i]);
  const idx = rated.map((r, i) => (r ? i : -1)).filter((i) => i >= 0);

  // smoothed totals among the rated
  const Gs = (i: number, j: number) => G[i][j] + (G[i][j] > 0 ? prior : 0);
  const Ws = (i: number) => idx.reduce((s, j) => s + (j !== i ? W[i][j] + (G[i][j] > 0 ? prior / 2 : 0) : 0), 0);
  const wTot = new Map(idx.map((i) => [i, Ws(i)]));
  const g = new Array(k).fill(1);
  let it = 0;
  for (; it < 10000; it++) {
    let delta = 0;
    for (const i of idx) {
      let den = 0;
      for (const j of idx) if (j !== i && G[i][j] > 0) den += Gs(i, j) / (g[i] + g[j]);
      const ng = den > 0 ? wTot.get(i)! / den : g[i];
      delta = Math.max(delta, Math.abs(Math.log(ng / g[i])));
      g[i] = ng;
    }
    // normalise: geometric mean 1
    const lm = idx.reduce((s, i) => s + Math.log(g[i]), 0) / Math.max(1, idx.length);
    for (const i of idx) g[i] /= Math.exp(lm);
    if (delta < 1e-10) break;
  }
  const rating = new Array(k).fill(NaN), ci = new Array(k).fill(NaN);
  for (const i of idx) {
    rating[i] = 1500 + ELO * Math.log(g[i]);
    // Fisher information on the log scale (its diagonal): sum over opponents of G p (1 - p)
    let info = 0;
    for (const j of idx) if (j !== i && G[i][j] > 0) { const p = g[i] / (g[i] + g[j]); info += Gs(i, j) * p * (1 - p); }
    ci[i] = info > 0 ? 1.96 * ELO / Math.sqrt(info) : Infinity;
  }
  return { rating, ci, score, games, rated, iterations: it, W, G };
}

/** P(i beats j) on the Elo scale. */
export const expected = (ri: number, rj: number) => 1 / (1 + Math.pow(10, (rj - ri) / 400));

export interface Upset { i: number; j: number; observed: number; predicted: number; z: number; games: number }
/** The pairs whose observed score is furthest from what the ratings predict, by z-score. */
export function upsets(r: RatingResult, top = 12): Upset[] {
  const out: Upset[] = [];
  const k = r.rating.length;
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) {
    const g = r.G[i][j];
    if (!g || !r.rated[i] || !r.rated[j]) continue;
    const obs = r.W[i][j] / g, pred = expected(r.rating[i], r.rating[j]);
    const se = Math.sqrt(Math.max(pred * (1 - pred), 1e-6) / g);
    const zz = (obs - pred) / se;
    // report from the side that did better than predicted
    out.push(zz >= 0 ? { i, j, observed: obs, predicted: pred, z: zz, games: g } : { i: j, j: i, observed: 1 - obs, predicted: 1 - pred, z: -zz, games: g });
  }
  return out.sort((a, b) => b.z - a.z).slice(0, top);
}
