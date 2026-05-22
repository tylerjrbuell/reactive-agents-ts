/**
 * Smoke coverage for `@reactive-agents/react` — closes HS-26 / issue #82
 * (for the react package; svelte + vue tracked as separate per-package
 * bundles per the cross-package descope gate).
 *
 * Verifies the public surface: named exports exist, are the expected
 * runtime shapes, and TypeScript types compile against the documented
 * contract. Does NOT render hooks — React hooks require a render context
 * (`useState`/`useCallback` throw "Invalid hook call" outside one), and
 * pulling in `@testing-library/react` + `happy-dom` for a smoke test is
 * scope creep. A follow-up bundle can extract the fetch core into a pure
 * helper for behavioral coverage.
 */
import { describe, it, expect } from "bun:test";
import {
  useAgent,
  useAgentStream,
  type AgentStreamEvent,
  type AgentHookState,
  type UseAgentReturn,
  type UseAgentStreamReturn,
} from "../src/index.js";

describe("@reactive-agents/react — public surface", () => {
  it("exports useAgent as a function", () => {
    expect(typeof useAgent).toBe("function");
    // Hook signature: (endpoint: string, requestInit?: RequestInit) => UseAgentReturn
    expect(useAgent.length).toBeGreaterThanOrEqual(1);
  });

  it("exports useAgentStream as a function", () => {
    expect(typeof useAgentStream).toBe("function");
    expect(useAgentStream.length).toBeGreaterThanOrEqual(1);
  });

  it("type-checks the documented AgentHookState union", () => {
    const idle: AgentHookState = "idle";
    const streaming: AgentHookState = "streaming";
    const completed: AgentHookState = "completed";
    const error: AgentHookState = "error";
    expect([idle, streaming, completed, error]).toEqual([
      "idle",
      "streaming",
      "completed",
      "error",
    ]);
  });

  it("type-checks the documented AgentStreamEvent _tag variants", () => {
    // The hook switches on these `_tag` strings — the SSE contract is
    // hand-coupled to the runtime's AgentStream emission. If the runtime
    // renames a variant, this test fails at compile time before runtime
    // surfaces a silent SSE parse miss.
    const textDelta: AgentStreamEvent = { _tag: "TextDelta", text: "hi" } as AgentStreamEvent;
    const completed: AgentStreamEvent = {
      _tag: "StreamCompleted",
      output: "done",
    } as AgentStreamEvent;
    const cancelled: AgentStreamEvent = { _tag: "StreamCancelled" } as AgentStreamEvent;
    const error: AgentStreamEvent = {
      _tag: "StreamError",
      cause: "x",
    } as AgentStreamEvent;
    expect([textDelta._tag, completed._tag, cancelled._tag, error._tag]).toEqual([
      "TextDelta",
      "StreamCompleted",
      "StreamCancelled",
      "StreamError",
    ]);
  });

  it("type-checks UseAgentReturn fields are reachable from the hook return", () => {
    // Compile-time check via a function-typed reference (zero runtime cost).
    const _check: () => UseAgentReturn = () => ({
      output: null,
      loading: false,
      error: null,
      run: async () => "",
    });
    expect(typeof _check).toBe("function");
  });

  it("type-checks UseAgentStreamReturn shape (run + cancel callbacks)", () => {
    const _check: () => UseAgentStreamReturn = () => ({
      text: "",
      events: [],
      status: "idle",
      error: null,
      output: null,
      run: () => undefined,
      cancel: () => undefined,
    });
    expect(typeof _check).toBe("function");
  });
});
