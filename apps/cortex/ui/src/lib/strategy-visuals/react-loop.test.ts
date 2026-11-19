import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { endStrategyRun, foldStrategyRun, initialStrategyRun, reactLoopOf, strategyStepOf, type LoopCallInput, type StrategyRunState } from "@reactive-agents/ui-core";
import { renderComponent } from "../components/kit/test-render.js";
import { strategyCardModel, strategyVisualOf } from "./registry.js";

const run = (ended = false): StrategyRunState => {
  const r = foldStrategyRun(initialStrategyRun, strategyStepOf("reactive:main")!);
  return ended ? endStrategyRun(r) : r;
};
const calls: LoopCallInput[] = [
  { id: "a", name: "web-search", status: "done", iteration: 1, args: { query: "btc" }, result: "3 hits" },
  { id: "b", name: "http-get", status: "running", iteration: 2 },
];
const steps = [{ iteration: 1, narration: "Searching first." }, { iteration: 2, narration: "Reading the page." }];

describe("reactive card (ReAct loop view)", () => {
  it("react and reactive resolve to the loop view; direct and adaptive keep the generic stepper", () => {
    expect(strategyVisualOf("reactive").kind).toBe("loop");
    expect(strategyVisualOf("react").kind).toBe("loop");
    expect(strategyVisualOf("direct").kind).toBe("stepper");
    expect(strategyVisualOf("adaptive").kind).toBe("stepper");
  });

  it("is open with the running tool in the chip, then collapses to a tally once the turn ends", () => {
    const live = strategyCardModel(run(), { hasPlan: false, loop: reactLoopOf({ steps, calls, ended: false }) });
    expect(live).toMatchObject({ show: true, kind: "loop", title: "Reactive", chip: "Iteration 2 · http-get", openByDefault: true });
    const done = strategyCardModel(run(true), { hasPlan: false, loop: reactLoopOf({ steps, calls: calls.map((c) => ({ ...c, status: "done" as const })), ended: true }) });
    expect(done).toMatchObject({ chip: "2 iterations, 2 tools", openByDefault: false });
  });

  it("draws nothing for a run that never thought or acted", () => {
    expect(strategyCardModel(run(), { hasPlan: false, loop: reactLoopOf({ steps: [], calls: [], ended: false }) }).show).toBe(false);
    expect(strategyCardModel(run(), { hasPlan: false }).show).toBe(false);
  });

  it("renders thought, action and observation rows, marks the current iteration, settles on terminal", async () => {
    const file = join(import.meta.dir, "../components/strategy/StrategyCard.svelte");
    const live = await renderComponent(file, { run: run(), loop: reactLoopOf({ steps, calls, ended: false }) });
    expect(live).toContain('data-kind="loop"');
    expect(live).toContain("Searching first.");
    expect(live).toContain("web-search");
    expect(live).toContain("query");
    expect(live).toContain("3 hits");
    expect(live).toContain('aria-current="step"');
    expect(live.match(/data-testid="loop-iteration"/g)?.length).toBe(2);
    const ended = await renderComponent(file, { run: run(true), loop: reactLoopOf({ steps, calls: [{ ...calls[0]! }, { ...calls[1]!, status: "failed", error: "[Tool error: 404]" }], ended: true }) });
    expect(ended).toContain("2 iterations, 2 tools");
    expect(ended).not.toContain("loop-iteration"); // collapsed once over
  });
});
