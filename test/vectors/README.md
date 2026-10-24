# Vectors from the game executable

`skill_check.csv`, `rollem.csv`, `pickloc.csv` and `check_res.csv` are copied unchanged from
[abedegno/underworld-exhumed](https://github.com/abedegno/underworld-exhumed) (`uw2/vectors/` on this
branch; MIT licence, Copyright (c) 2026 abedegno). Each row is one call of the routine's own bytes from
UW2.EXE, run in an emulator: the inputs, the generator's 32-bit state before the call (`seed`), the
result, and the state after (`seed_out`). The game's `rand()` is Borland's:
`seed = seed * 0x015A4E35 + 1`, returning bits 16..30.

`test/rng-vectors.test.ts` runs the simulator's ports from the same states and requires the same
results and the same final states, so the simulator draws exactly what the game draws.
