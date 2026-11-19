// Run: bun run repo test apps/cortex/ui/src/lib/strategy-visuals/registry-conformance.test.ts
/**
 * Every registered strategy gets a useful card. The names come from ui-core `STRATEGY_PHASES`, which
 * `strategy-phases.test.ts` pins to `packages/reasoning/src/services/strategy-registry.ts`, so a new
 * strategy fails HERE until it has a fixture below (a sequence of its real `kernelPass` labels) and a
 * meaningful card. "Meaningful" = the card shows (or a plan card draws instead), the running chip names
 * a phase, and the settled chip says what happened: never empty, "Working", or a bare "N phases".
 * Each card is checked live, settled, and after a storage round trip (the reload path).
 */
import { describe, expect, it } from "bun:test";
import {
  endStrategyRun,
  foldStrategyRun,
  initialStrategyRun,
  reactLoopOf,
  STRATEGY_PHASES,
  strategyRunForStorage,
  strategyRunFromStorage,
  strategyStatusOf,
  strategyStepOf,
  type StrategyRunState,
  type StrategyStepDetail,
} from "@reactive-agents/ui-core";
import { strategyCardModel, strategyVisualOf, type StrategyCardModel } from "./registry.js";

interface Fixture {
  readonly passes: readonly (string | readonly [string, StrategyStepDetail])[];
  /** Reactive and react draw their rows from the turn's thoughts and tool calls, not from phases. */
  readonly loop?: boolean;
  /** The settled chip must contain this. */
  readonly settled: RegExp;
}

const FIXTURES: Readonly<Record<string, Fixture>> = {
  reactive: { passes: ["reactive:main"], loop: true, settled: /iteration/ },
  react: { passes: ["reactive:main"], loop: true, settled: /iteration/ },
  direct: { passes: ["direct:main"], settled: /one pass/ },
  adaptive: { passes: [["adaptive:heuristic", { note: "[ADAPTIVE] Heuristic: blueprint" }]], settled: /chose Blueprint \(by task shape\)/ },
  reflexion: { passes: ["reflexion:generate", "reflexion:critique-1", "reflexion:improve-1"], settled: /1 round/ },
  "plan-execute-reflect": {
    passes: ["plan-execute:plan-1", "plan-execute:step-1:start", "plan-execute:step-1:done", "plan-execute:step-2:start", "plan-execute:step-2:failed", "plan-execute:synthesize"],
    settled: /2 steps, 1 failed/,
  },
  "tree-of-thought": {
    passes: [
      ["tree-of-thought:explore", { node: { id: "a", depth: 1, score: 0.4 } }],
      ["tree-of-thought:explore", { node: { id: "b", depth: 2, score: 0.9 } }],
      "tree-of-thought:select",
    ],
    settled: /2 nodes, best 0\.90/,
  },
  "code-action": {
    passes: ["code-action:plan", ["code-action:execute:1", { code: "1+1" }], ["code-action:verify:1", { verify: { verdict: "PASS", summary: "ok" } }], "code-action:answer"],
    settled: /1 attempt, verified/,
  },
  // `rewoo` is registered as an alias of the blueprint executor, so it emits blueprint labels.
  blueprint: { passes: ["blueprint:plan", "blueprint:verify", "blueprint:execute", "blueprint:step-1:start", "blueprint:step-1", "blueprint:patch", "blueprint:solve"], settled: /1 step, plan revised/ },
  rewoo: { passes: ["blueprint:plan", "blueprint:execute", "blueprint:step-1:start", "blueprint:step-1", "blueprint:step-2:start", "blueprint:step-2", "blueprint:solve"], settled: /2 steps/ },
};

const fold = (f: Fixture): StrategyRunState =>
  f.passes.reduce<StrategyRunState>((s, p) => {
    const [pass, detail] = typeof p === "string" ? [p, {}] : p;
    return foldStrategyRun(s, strategyStepOf(pass, detail)!);
  }, initialStrategyRun);

const loopOf = (ended: boolean) =>
  reactLoopOf({
    steps: [{ iteration: 1, narration: "Looking it up." }],
    calls: [{ id: "a", name: "web-search", status: "done" as const, iteration: 1, args: { query: "x" }, result: "hit" }],
    ended,
  });

const GENERIC_CHIP = /^(|Working|\d+ phases?)$/;

function expectMeaningful(card: StrategyCardModel, f: Fixture, name: string, state: "live" | "settled"): void {
  // A plan card the goal-checks view already draws is the one allowed absence; here no plan is shown.
  expect(card.show, `${name} (${state}) shows no card`).toBe(true);
  expect(card.title.length, `${name} has no title`).toBeGreaterThan(0);
  expect(GENERIC_CHIP.test(card.chip), `${name} (${state}) chip "${card.chip}" is generic`).toBe(false);
  if (state === "settled") expect(card.chip, `${name} settled chip`).toMatch(f.settled);
}

describe("every registered strategy has a meaningful card", () => {
  it("has a fixture for every name in the registry table (and no stale ones)", () => {
    expect(Object.keys(FIXTURES).sort()).toEqual(Object.keys(STRATEGY_PHASES).sort());
  });

  for (const [name, f] of Object.entries(FIXTURES)) {
    it(`${name}: live, settled and after reload`, () => {
      const live = fold(f);
      const opts = (run: StrategyRunState, ended: boolean) => ({ statusLine: strategyStatusOf(run), hasPlan: false, ...(f.loop ? { loop: loopOf(ended) } : {}) });
      expectMeaningful(strategyCardModel(live, opts(live, false)), f, name, "live");

      const settled = endStrategyRun(live);
      expectMeaningful(strategyCardModel(settled, opts(settled, true)), f, name, "settled");

      const stored = strategyRunFromStorage(JSON.parse(JSON.stringify(strategyRunForStorage(live))));
      expect(stored, `${name} did not survive storage`).toBeDefined();
      expectMeaningful(strategyCardModel(stored, opts(stored!, true)), f, name, "settled");
      expect(strategyCardModel(stored, opts(stored!, true)).chip).toBe(strategyCardModel(settled, opts(settled, true)).chip);
    });
  }

  it("a plan strategy with nothing notable draws no card of its own while the plan card shows its plan", () => {
    for (const name of ["plan-execute-reflect", "blueprint", "rewoo"]) {
      // blueprint and rewoo fixtures have a clean step; plan-execute's fails one, which the card does show (below).
      const run = fold(name === "plan-execute-reflect" ? { passes: ["plan-execute:plan-1", "plan-execute:step-1:start", "plan-execute:step-1:done"], settled: /./ } : FIXTURES[name]!);
      expect(strategyCardModel(run, { hasPlan: true }).show, name).toBe(false);
      expect(strategyCardModel(run, { hasPlan: false }).show, name).toBe(true);
    }
  });

  it("a plan card beside the plan card stays hidden for a clean run and shows only history for a retried or patched one", () => {
    for (const name of ["plan-execute-reflect", "blueprint", "rewoo"]) {
      const clean = fold({ passes: ["plan-execute:step-1:start", "plan-execute:step-1:done"], settled: /./ });
      expect(strategyCardModel(clean, { hasPlan: true }).show, `${name} clean`).toBe(false);
    }
    const retried = endStrategyRun(fold({ passes: ["plan-execute:step-1:start", "plan-execute:step-1:retry-1", "plan-execute:step-1:done"], settled: /./ }));
    const card = strategyCardModel(retried, { hasPlan: true });
    expect(card.show).toBe(true);
    expect(card.historyOnly).toBe(true);
    expect(card.chip).toBe("1 step, 1 retry");
    // After reload the card reads the same.
    const stored = strategyRunFromStorage(JSON.parse(JSON.stringify(strategyRunForStorage(retried))))!;
    expect(strategyCardModel(stored, { hasPlan: true }).chip).toBe("1 step, 1 retry");
  });

  it("rewoo resolves to the plan view under its registry name and its own label prefix", () => {
    expect(strategyVisualOf("rewoo").kind).toBe("plan");
    expect(strategyVisualOf("blueprint").kind).toBe("plan");
    const own = fold({ passes: ["rewoo:plan", "rewoo:step-1:start", "rewoo:step-1:done", "rewoo:solve"], settled: /./ });
    const card = strategyCardModel(endStrategyRun(own), { hasPlan: false });
    expect(card.show).toBe(true);
    expect(card.kind).toBe("plan");
    expect(card.title).toBe("Blueprint");
    expect(card.chip).toBe("1 step");
  });

  it("adaptive that hands over to another strategy says so in the title", () => {
    const run = fold({ passes: [["adaptive:select", { note: "[ADAPTIVE] Selected strategy: reflexion" }], "reflexion:generate", "reflexion:critique-1"], settled: /./ });
    expect(strategyCardModel(run, { hasPlan: false }).title).toBe("Adaptive → Reflexion");
  });
});
