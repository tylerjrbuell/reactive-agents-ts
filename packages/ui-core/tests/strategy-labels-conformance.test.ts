import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  STRATEGY_PHASES,
  foldStrategyRun,
  initialStrategyRun,
  strategyPhasesOf,
  strategyStepOf,
} from "../src/index.js";

const REASONING_SRC = join(import.meta.dir, "../../reasoning/src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "node_modules" ? [] : sourceFiles(p);
    return p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
  });
}

/** Every `<strategy>:<phase>` label literal the framework's source can stamp as a kernelPass. */
function emittedLabels(): ReadonlyMap<string, ReadonlySet<string>> {
  const prefixes = [...new Set(Object.values(STRATEGY_PHASES).map((s) => s.pass))];
  // `phase: "x:y"` is the strategy's debug log, not a kernelPass label; `step-${n}` leaves a trailing dash.
  const re = new RegExp(`(?<!phase: )["\`](${prefixes.join("|")}):([a-z][a-z-]*[a-z])`, "g");
  const out = new Map<string, Set<string>>();
  for (const file of sourceFiles(REASONING_SRC)) {
    for (const m of readFileSync(file, "utf8").matchAll(re)) {
      const set = out.get(m[1]!) ?? new Set<string>();
      set.add(m[2]!);
      out.set(m[1]!, set);
    }
  }
  return out;
}

describe("kernelPass label conformance", () => {
  const labels = emittedLabels();

  it("finds the labels the strategies emit (the scan is alive)", () => {
    expect(labels.get("reflexion")?.has("critique")).toBe(true);
    expect(labels.get("code-action")?.has("execute")).toBe(true);
    expect(labels.get("tree-of-thought")?.has("explore")).toBe(true);
  });

  it("every emitted phase has a table label, never a title-cased raw id", () => {
    const unmapped: string[] = [];
    for (const [prefix, phases] of labels) {
      const known = new Set(strategyPhasesOf(prefix).map((p) => p.id));
      // Strategies with no phases (reactive, direct) draw no stepper, so their labels never show.
      if (known.size === 0) continue;
      for (const phase of phases) if (!known.has(phase)) unmapped.push(`${prefix}:${phase}`);
    }
    expect(unmapped).toEqual([]);
  });

  it("the unlabelled-pass stamp (`<strategy>:main`) reads as a name, never 'Main'", () => {
    for (const spec of Object.values(STRATEGY_PHASES)) {
      const row = foldStrategyRun(initialStrategyRun, strategyStepOf(`${spec.pass}:main`)!).rows[0]!;
      expect(row.label).not.toBe("Main");
    }
    const reflexion = foldStrategyRun(initialStrategyRun, strategyStepOf("reflexion:main")!);
    expect(reflexion.rows[0]!.label).toBe("Drafting");
  });
});
