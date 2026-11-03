// Run: bun test packages/trace/tests/run-started-posture.test.ts --timeout 15000
//
// run-started carries the run posture (tracing audit L2: "executed despite
// plan-only" was undiagnosable because posture appeared nowhere in the trace).
// RED-ON-CUT: drop the `posture` read in normalize.ts's AgentStarted case.
import { describe, expect, it } from "bun:test";
import type { AgentEvent } from "@reactive-agents/core";
import { toTraceEvent } from "../src/normalize.js";

const started = (extra: Record<string, unknown>): AgentEvent =>
  // boundary: partial AgentStarted fixture; the normalizer reads only posture-relevant fields
  ({ _tag: "AgentStarted", taskId: "t1", agentId: "a", provider: "ollama", model: "m", timestamp: 1, task: "x", ...extra }) as unknown as AgentEvent;

describe("run-started posture", () => {
  it("plan posture lands on run-started.config", () => {
    const ev = toTraceEvent(started({ posture: "plan" }), 0);
    expect(ev?.kind).toBe("run-started");
    expect(ev?.kind === "run-started" && ev.config).toEqual({ posture: "plan" });
  });

  it("absent / execute posture leaves config empty (replay-compatible)", () => {
    const none = toTraceEvent(started({}), 0);
    const exec = toTraceEvent(started({ posture: "execute" }), 0);
    expect(none?.kind === "run-started" && none.config).toEqual({});
    expect(exec?.kind === "run-started" && exec.config).toEqual({});
  });
});
