import { describe, it, expect } from "bun:test";
import { Effect, Either } from "effect";
import type { AgentResult } from "../src/builder/types.js";
import { bareBuilderFailure, driveApprovals, mapRunBoundaryError } from "../src/agent/run-contract.js";
import { a2aResultToEffect } from "../src/agent/a2a-executor.js";

const result = (over: Partial<AgentResult>): AgentResult =>
  ({ success: true, output: "ok", taskId: "t", ...over }) as AgentResult;

describe("bareBuilderFailure (run() bare-builder contract)", () => {
  it("throws for llm_error / max_iterations / guard_stop on a bare builder", () => {
    for (const terminatedBy of ["llm_error", "max_iterations", "guard_stop"] as const) {
      const err = bareBuilderFailure(result({ success: false, terminatedBy, error: "boom" }), false);
      expect(err?.message).toBe("boom");
    }
  });

  it("falls back to a descriptive message when the result carries no error", () => {
    const err = bareBuilderFailure(result({ success: false, terminatedBy: "llm_error" }), false);
    expect(err?.message).toBe("Agent run failed: llm_error");
  });

  it("never throws with explicit reasoning, or for graded declines like abstention", () => {
    expect(bareBuilderFailure(result({ terminatedBy: "llm_error" }), true)).toBeUndefined();
    expect(bareBuilderFailure(result({ success: false, terminatedBy: "guard_stop" }), true)).toBeUndefined();
    expect(bareBuilderFailure(result({ success: false, terminatedBy: "abstained" }), false)).toBeUndefined();
    expect(bareBuilderFailure(result({}), false)).toBeUndefined();
  });
});

describe("a2aResultToEffect", () => {
  it("passes a successful output through", async () => {
    expect(await Effect.runPromise(a2aResultToEffect(result({ output: "answer" })))).toBe("answer");
  });

  it("fails a graceful decline so the A2A task is 'failed', preferring error > abstention > output", async () => {
    const msg = async (r: AgentResult) => {
      const e = await Effect.runPromise(Effect.either(a2aResultToEffect(r)));
      return Either.isLeft(e) ? e.left.message : "<ok>";
    };
    expect(await msg(result({ success: false, error: "bad" }))).toBe("bad");
    expect(await msg(result({ success: false, abstention: { reason: "no evidence", missing: [] } }))).toBe(
      "Agent declined to complete the task: no evidence",
    );
    expect(await msg(result({ success: false, output: "partial text" }))).toBe("partial text");
    expect(await msg(result({ success: false, output: "" }))).toBe("Agent declined to complete the task");
  });
});

const paused = (runId: string): AgentResult =>
  result({ status: "awaiting-approval", pendingApproval: { runId, gateId: "g", toolName: "shell", args: {} } });

describe("driveApprovals", () => {
  it("returns the result untouched without an onApproval callback", async () => {
    const r = paused("r1");
    expect(await driveApprovals(r, undefined, { approve: async () => r, deny: async () => r })).toBe(r);
  });

  it("approves and loops through a second gate, then denies with the callback's reason", async () => {
    const log: string[] = [];
    const decisions = [true, { approve: false, reason: "nope" }] as const;
    let i = 0;
    const final = result({ output: "final" });
    const out = await driveApprovals(paused("r1"), () => decisions[i++]!, {
      approve: async (id) => (log.push(`approve:${id}`), paused("r2")),
      deny: async (id, reason) => (log.push(`deny:${id}:${reason}`), final),
    });
    expect(log).toEqual(["approve:r1", "deny:r2:nope"]);
    expect(out).toBe(final);
  });

  it("defaults the denial reason", async () => {
    const reasons: string[] = [];
    await driveApprovals(paused("r1"), () => false, {
      approve: async () => result({}),
      deny: async (_id, reason) => (reasons.push(reason), result({})),
    });
    expect(reasons).toEqual(["denied by onApproval"]);
  });
});

describe("mapRunBoundaryError", () => {
  const base = { agentId: "a1", taskId: "t1", aborted: false, emitTerminated: async () => {}, errorHandler: undefined };

  it("on terminate(): emits AgentTerminated once and throws a clean terminal error", async () => {
    const emitted: string[] = [];
    const e = await mapRunBoundaryError(new Error("interrupted"), {
      ...base,
      aborted: true,
      emitTerminated: async (tid) => void emitted.push(tid),
    }).catch((x: unknown) => x);
    expect(emitted).toEqual(["t1"]);
    expect(String((e as Error).message)).toContain("Agent a1 terminated");
  });

  it("hands the unwrapped error to errorHandler and swallows handler exceptions", async () => {
    const seen: string[] = [];
    const e = await mapRunBoundaryError(new Error("boom"), {
      ...base,
      errorHandler: (err) => {
        seen.push(err.message);
        throw new Error("handler blew up");
      },
    }).catch((x: unknown) => x);
    expect(seen).toEqual(["boom"]);
    expect(String((e as Error).message)).toContain("boom");
  });
});
