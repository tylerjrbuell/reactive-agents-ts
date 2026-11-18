/**
 * Phase Z CLI: `bun run bench:sim -- --mechanism X [--shapes a,b] [--seeds N] [--tier name] [--sweep]`.
 *
 * Prints a compact matrix (shapes x the mechanism, off vs on). One seed and no tier
 * is the deterministic tier: a `hurts` there is veto-class evidence. `--seeds N`
 * (N > 1) wraps each shape's policy in a tier's failure rates (`--tier`, default
 * mid-local; UNCALIBRATED, advisory). `--sweep` varies the probability the model
 * follows steering from 0 to 1 and reports where the mechanism flips.
 * Exit code 1 when any matrix shape is `hurts` (a sweep is advisory and exits 0).
 * Zero tokens, no live model.
 */
import { MECHANISMS, findMechanism, type Mechanism } from "../../src/sim/mechanisms.js";
import { SHAPES, findShape } from "../../src/sim/shapes/index.js";
import type { Shape } from "../../src/sim/shape.js";
import { loadTier, tierNames, type Tier } from "../../src/sim/tier.js";
import { formatMatrix, formatSweeps, matrix, sweep } from "./matrix.js";

const USAGE =
  "usage: bun run bench:sim -- --mechanism <name|all> [--shapes a,b] [--seeds N] [--tier name] [--sweep]";

function flag(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}

/** Resolve names to items, or an error line listing the valid names. */
function pick<T>(
  names: readonly string[],
  find: (n: string) => T | undefined,
  valid: readonly string[],
  what: string,
): { readonly items: readonly T[] } | { readonly error: string } {
  const items: T[] = [];
  for (const n of names) {
    const found = find(n);
    if (found === undefined) return { error: `unknown ${what} "${n}"; one of: ${valid.join(", ")}` };
    items.push(found);
  }
  return { items };
}

/** Run the CLI; returns the process exit code. */
export async function main(args: readonly string[]): Promise<number> {
  const mech = flag(args, "mechanism");
  if (mech === undefined) {
    console.error(`${USAGE}\nmechanisms: ${MECHANISMS.map((m) => m.name).join(", ")}, all`);
    return 2;
  }
  const mechanisms: readonly Mechanism[] = (() => {
    if (mech === "all") return MECHANISMS;
    const found = findMechanism(mech);
    return found === undefined ? [] : [found];
  })();
  if (mechanisms.length === 0) {
    console.error(`unknown mechanism "${mech}"; one of: ${MECHANISMS.map((m) => m.name).join(", ")}, all`);
    return 2;
  }
  const shapeArg = flag(args, "shapes");
  let shapes: readonly Shape[] = SHAPES;
  if (shapeArg !== undefined) {
    const picked = pick(shapeArg.split(","), findShape, SHAPES.map((s) => s.id), "shape");
    if ("error" in picked) {
      console.error(picked.error);
      return 2;
    }
    shapes = picked.items;
  }
  const seeds = Number(flag(args, "seeds") ?? "1");
  if (!Number.isInteger(seeds) || seeds < 1) {
    console.error(`--seeds must be a positive integer\n${USAGE}`);
    return 2;
  }
  const wantsSweep = args.includes("--sweep");
  const tierName = flag(args, "tier") ?? (seeds > 1 || wantsSweep ? "mid-local" : undefined);
  let tier: Tier | undefined;
  if (tierName !== undefined) {
    if (!tierNames().includes(tierName)) {
      console.error(`unknown tier "${tierName}"; one of: ${tierNames().join(", ")}`);
      return 2;
    }
    tier = loadTier(tierName);
  }

  if (wantsSweep) {
    if (tier === undefined) return 2;
    const sweeps = [];
    for (const s of shapes) for (const m of mechanisms) sweeps.push(await sweep(s, m, { tier, seeds: flag(args, "seeds") === undefined ? 30 : seeds }));
    console.log(`compliance sweep, tier ${tier.name} (${tier.status}); advisory, never promotes\n${formatSweeps(sweeps)}`);
    return 0; // a sweep is advisory: only the deterministic matrix gates (exit 1 on `hurts`)
  }

  const cells = await matrix({ shapes, mechanisms, seeds, tier });
  const mode =
    tier === undefined
      ? "deterministic (naive scripted model, compliance 1): hurts = veto-class"
      : `stochastic, tier ${tier.name} (${tier.status}), ${seeds} seeds: advisory`;
  console.log(`${mode}\n${formatMatrix(cells)}`);
  return cells.some((c) => c.verdict === "hurts") ? 1 : 0;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
