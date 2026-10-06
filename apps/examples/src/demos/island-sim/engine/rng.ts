import { Schema } from "effect";

/** Simple mulberry32 PRNG */
export interface Rng {
  /** Float in [0,1) */
  next(): number;
  /** Integer inclusive */
  int(min: number, max: number): number;
  /** Random element */
  pick<T>(xs: readonly T[]): T;
}

export function makeRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => {
    const r = next();
    return Math.floor(r * (max - min + 1)) + min;
  };
  const pick = <T>(xs: readonly T[]) => xs[int(0, xs.length - 1)];
  return { next, int, pick };
}

/** Simple test schema to ensure module loads */
export const RngSchema = Schema.Struct({});
