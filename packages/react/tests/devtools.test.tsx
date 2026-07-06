import { describe, expect, test } from "bun:test";
import { withHappyDom } from "./happy-dom.js";
import { render, fireEvent } from "@testing-library/react";
import { initialRunState, reduceRunState, type RunState } from "@reactive-agents/ui-core";
import { AgentDevtools } from "../src/components/AgentDevtools.js";

withHappyDom();

const state: RunState = reduceRunState(
  reduceRunState(initialRunState(), { _tag: "ToolCallStarted", toolName: "web-search", callId: "c1", seq: 1 }),
  { _tag: "CostDelta", tokens: 10, usd: 0.002, seq: 2 },
);

describe("AgentDevtools", () => {
  test("hidden when enabled=false", () => {
    const { container } = render(<AgentDevtools state={state} enabled={false} />);
    expect(container.querySelector("[data-ra-devtools]")).toBeNull();
  });

  test("shows overlay with cost + steps + replay when enabled", () => {
    let replayed = false;
    const { container, getByText } = render(<AgentDevtools state={state} enabled onReplay={() => (replayed = true)} />);
    expect(container.querySelector("[data-ra-devtools]")).not.toBeNull();
    fireEvent.click(getByText(/replay/i));
    expect(replayed).toBe(true);
  });
});
