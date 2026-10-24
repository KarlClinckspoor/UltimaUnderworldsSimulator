// Runs the C harness (functions copied verbatim from the game's source, rand() enumerated)
// and checks the TypeScript ports against it. Skipped when no C compiler is installed.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gradeCounts, gradeOfRoll } from '../src/core/skillcheck';
import { checkRes, pickloc, rollDamage, shouldIFlee, type R } from '../src/combat/blow';

function compiler(): string | null {
  for (const cc of ['cc', 'gcc', 'clang']) {
    try { execFileSync(cc, ['--version'], { stdio: 'ignore' }); return cc; } catch { /* next */ }
  }
  return null;
}
const cc = compiler();
const dir = join(__dirname, 'c');
let out: any = null;
if (cc) {
  mkdirSync(join(dir, 'build'), { recursive: true });
  const exe = join(dir, 'build', process.platform === 'win32' ? 'harness.exe' : 'harness');
  execFileSync(cc, ['-O2', '-o', exe, join(dir, 'harness.c')]);
  if (existsSync(exe)) out = JSON.parse(execFileSync(exe, { maxBuffer: 64 << 20 }).toString());
}

/** A random source that replays a fixed queue of rand() values, like the harness. */
function queue(vals: number[]): R {
  let i = 0;
  const next = () => vals[i++ & 15];
  return {
    int: (n) => next() % n,
    rollem: (dice, sides) => {
      let t = dice;
      if (sides > 0 && dice > 0) for (let k = 0; k < dice; k++) t += Math.trunc((next() * sides) / 0x8000);
      return t;
    },
  };
}

describe.skipIf(!out)('C cross-check', () => {
  it("skill_check: the game-model counts equal the C code run over all 32768 values of rand()", () => {
    // 32768 = 31 * 1057 + 1: residue 0 has 1058 values, every other residue 1057.
    for (let d = -80; d <= 80; d++) {
      expect(gradeCounts(d, 0, 'game').counts).toEqual(out.skill_check[d + 80]);
      // and the ideal model is within one 15-bit value of it
      const ts = gradeCounts(d, 0, 'ideal').counts;
      const g0 = gradeOfRoll(d, 0, 0);
      for (let g = 0; g < 4; g++) expect(out.skill_check[d + 80][g]).toBe(ts[g] * 1057 + (g0 + 1 === g ? 1 : 0));
    }
  });
  it('d = 0 gives 2, 13, 13, 3 in 31 (the source comment)', () => {
    expect(gradeCounts(0, 0, 'ideal').counts).toEqual([3, 13, 13, 2]);
  });
  it('pickloc agrees for every geometry and rand() residue', () => {
    const tops = [9, 14, 18, 20, 23, 28, 32];
    let s = '';
    for (const top of tops) for (let a = 0; a <= 40; a++) for (const b of [0, 20]) for (let r = 0; r < 36; r++)
      s += pickloc(0, top, a, a + b, queue([Math.trunc(r / 6), r % 6, (r * 7) % 6]));
    expect(s).toBe(out.pickloc);
  });
  it('should_i_flee agrees', () => {
    const maxhps = [0, 5, 8, 20, 21, 45, 80, 200], nerves = [0, 5, 8, 15], dmgs = [0, 3, 10, 40, 100];
    let s = '';
    for (const mh of maxhps) for (let hp = 0; hp <= mh + 2; hp++) for (const nv of nerves) for (const dm of dmgs)
      for (let r = 0; r < 4; r++) s += shouldIFlee(mh, hp, nv, dm, queue([r])) ? 1 : 0;
    expect(s).toBe(out.flee);
  });
  it('check_res agrees', () => {
    const types = [3, 4, 8, 0x0b, 0x10, 0x23, 0x40, 0x43];
    let s = '';
    for (let res = 0; res < 256; res++) for (const t of types) for (let r = 0; r < 3; r++)
      s += checkRes(res, 10, t, queue([r])) ? 1 : 0;
    expect(s).toBe(out.check_res);
  });
  it('the damage dice agree', () => {
    let lcg = 12345;
    const lcg15 = () => { lcg = (Math.imul(lcg, 1103515245) + 12345) >>> 0; return (lcg >>> 16) & 0x7fff; };
    const got: number[] = [];
    for (let d = 0; d <= 60; d++) for (let r = 0; r < 20; r++) {
      const vals = Array.from({ length: 16 }, lcg15);
      got.push(rollDamage(d, queue(vals)));
    }
    expect(got).toEqual(out.dice);
  });
});
