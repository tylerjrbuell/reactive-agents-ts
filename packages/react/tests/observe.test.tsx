import { describe, expect, test, beforeAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { renderHook, render } from "@testing-library/react";
import { initialRunState, reduceRunState, type RunState, type SeqStamped, type UiStreamEvent } from "@reactive-agents/ui-core";
import { useRunCost } from "../src/hooks/use-run-cost.js";
import { useRunSteps } from "../src/hooks/use-run-steps.js";
import { CostMeter } from "../src/components/CostMeter.js";
import { StepTimeline } from "../src/components/StepTimeline.js";

beforeAll(() => {
  if (!globalThis.document) GlobalRegistrator.register();
});

const build = (events: SeqStamped<UiStreamEvent>[]): RunState =>
  events.reduce((s, e) => reduceRunState(s, e), initialRunState());

describe("Observe", () => {
  const state = build([
    { _tag: "ToolCallStarted", toolName: "web-search", callId: "c1", seq: 1 },
    { _tag: "ToolCallCompleted", toolName: "web-search", callId: "c1", durationMs: 120, success: true, seq: 2 },
    { _tag: "CostDelta", tokens: 42, usd: 0.01, seq: 3 },
  ]);

  test("useRunCost reads cost from state", () => {
    const { result } = renderHook(() => useRunCost(state));
    expect(result.current).toEqual({ tokens: 42, usd: 0.01 });
  });

  test("useRunSteps derives a tool entry", () => {
    const { result } = renderHook(() => useRunSteps(state));
    const tool = result.current.find((e) => e.kind === "tool" && e.label.includes("web-search"));
    expect(tool).toBeDefined();
    expect(tool?.success).toBe(true);
  });

  test("CostMeter + StepTimeline render", () => {
    const { getByTestId: _getByTestId } = render(
      <div>
        <CostMeter state={state} />
        <StepTimeline state={state} />
      </div>,
    );
    // no throw; DOM present
    expect(document.querySelector("[data-ra-cost]")).not.toBeNull();
    expect(document.querySelector("[data-ra-timeline]")).not.toBeNull();
  });
});
