import { describe, expect, it } from "bun:test";
import { runEndToast } from "./run-toast.js";

const PROVIDER_ERROR =
  "LLM stream failed at iteration 0: anthropic call failed (anthropic:claude-sonnet-4-6): anthropic request failed: 400 Your credit balance is too low to access the Anthropic API.";

describe("runEndToast", () => {
  it("puts the run's error on a failed AgentCompleted toast (live 2026-11-10 showed only '<id> failed')", () => {
    const t = runEndToast({ type: "AgentCompleted", runId: "r1", name: "agent", payload: { success: false, error: PROVIDER_ERROR } });
    expect(t).toEqual({ kind: "error", title: "agent failed", message: PROVIDER_ERROR, href: "/run/r1", key: "run-end:r1" });
  });
  it("gives AgentCompleted and TaskFailed of one run the same key, so they show one toast", () => {
    const a = runEndToast({ type: "AgentCompleted", runId: "r1", name: "agent", payload: { success: false } });
    const b = runEndToast({ type: "TaskFailed", runId: "r1", name: "agent", payload: { error: "boom" } });
    expect(a?.key).toBe(b?.key);
    expect(b?.message).toBe("boom");
  });
  it("is a success toast without a message when the run succeeded or omitted the flag", () => {
    expect(runEndToast({ type: "AgentCompleted", runId: "r2", name: "a", payload: {} })).toEqual({
      kind: "success",
      title: "a completed",
      href: "/run/r2",
      key: "run-end:r2",
    });
  });
  it("is null for other event types", () => {
    expect(runEndToast({ type: "AgentStarted", runId: "r3", name: "a", payload: {} })).toBeNull();
  });
});

describe("runEndToast: a run the user stopped", () => {
  it("is a neutral 'stopped' toast with no error message, not 'failed'", () => {
    const t = runEndToast({
      type: "AgentCompleted",
      runId: "r9",
      name: "agent",
      payload: { success: false, error: "The run was stopped on request before it finished.", outcome: { status: "partial", outstanding: ["stopped_by_request"] } },
    });
    expect(t).toEqual({ kind: "info", title: "agent stopped", href: "/run/r9", key: "run-end:r9" });
  });
});
