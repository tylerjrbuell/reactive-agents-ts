/**
 * killswitch-reason-preserved.test.ts
 *
 * Regression test for the abort-transition observability bug discovered while
 * writing apps/examples/src/advanced/killswitch-toggle.ts (2026-05-24).
 *
 * The killswitch contract: phase hooks return
 *   `{ abort: 'stop' | 'terminate', reason: string }`
 * where `reason` is the OBSERVABILITY surface — it explains WHY the agent
 * stopped (e.g. `"budget-limit:tokens:1000/512"`, `"max-iterations:5"`,
 * `"timeout-after:30s"`).
 *
 * Prior to the fix, the 4 kernel abort-transition sites (runner bootstrap,
 * runner before-think, act before-act, act after-act) dropped `abort.reason`
 * on the floor and left `state.meta.terminatedBy` undefined — making every
 * killswitch firing silent in downstream observability (event-bus, debrief,
 * UpwardReport metadata).
 *
 * This is the sibling bug to the May 19 honesty sweep that flagged 3/6 compose
 * killswitches as shipped dead — that sweep fixed the killswitch IMPL state
 * shapes; this fix routes the reason through to `terminatedBy` at the abort
 * site.
 *
 * Assertions:
 *   1. `{ abort: 'stop', reason: '...' }` → `meta.terminatedBy === reason`,
 *      status === 'done'.
 *   2. `{ abort: 'terminate', reason: '...' }` → `meta.terminatedBy === reason`,
 *      status === 'failed'.
 *   3. `{ abort: 'stop' }` (no reason)       → `meta.terminatedBy === 'killswitch:stop'`
 *      (failure-mode sentinel — surfaces that a killswitch fired but its impl
 *      forgot to declare why).
 */
import { describe, it, expect } from "bun:test";
import { HarnessPipeline } from "@reactive-agents/core";
import { runPhaseHooks, killswitchTerminatedBy } from "../../../src/kernel/loop/phase-hooks.js";
import {
  initialKernelState,
  transitionState,
  type KernelState,
} from "../../../src/kernel/state/kernel-state.js";

function makeState(): KernelState {
  return initialKernelState({
    taskId: "test-task",
    strategy: "react",
    kernelType: "react",
    maxIterations: 5,
  });
}

describe("killswitch reason → meta.terminatedBy preservation", () => {
  describe("killswitchTerminatedBy() helper", () => {
    it("returns abort.reason when set", () => {
      expect(killswitchTerminatedBy({ abort: "stop", reason: "budget-limit:tokens:1/0" }))
        .toBe("budget-limit:tokens:1/0");
    });

    it("falls back to 'killswitch:${abort}' sentinel when reason is absent", () => {
      expect(killswitchTerminatedBy({ abort: "stop" })).toBe("killswitch:stop");
      expect(killswitchTerminatedBy({ abort: "terminate" })).toBe("killswitch:terminate");
    });
  });

  describe("abort-transition flow (runPhaseHooks → transitionState)", () => {
    it("before-think 'stop' with reason → status=done, meta.terminatedBy=reason", async () => {
      const pipeline = new HarnessPipeline([
        {
          kind: "before",
          phase: "think",
          fn: () => ({ abort: "stop", reason: "budget-limit:tokens:1/0" }),
        },
      ]);
      let state = makeState();
      const abort = await runPhaseHooks(pipeline, "before", "think", 0, state);
      expect(abort).toEqual({ abort: "stop", reason: "budget-limit:tokens:1/0" });
      state = transitionState(state, {
        status: abort!.abort === "terminate" ? "failed" : "done",
        output: state.output ?? "",
        meta: {
          ...state.meta,
          terminatedBy: killswitchTerminatedBy(abort!),
        },
      });
      expect(state.status).toBe("done");
      expect(state.meta.terminatedBy).toBe("budget-limit:tokens:1/0");
    });

    it("before-think 'terminate' with reason → status=failed, meta.terminatedBy=reason", async () => {
      const pipeline = new HarnessPipeline([
        {
          kind: "before",
          phase: "think",
          fn: () => ({ abort: "terminate", reason: "timeout-after:1ms" }),
        },
      ]);
      let state = makeState();
      const abort = await runPhaseHooks(pipeline, "before", "think", 0, state);
      expect(abort).toEqual({ abort: "terminate", reason: "timeout-after:1ms" });
      state = transitionState(state, {
        status: abort!.abort === "terminate" ? "failed" : "done",
        output: state.output ?? "",
        meta: {
          ...state.meta,
          terminatedBy: killswitchTerminatedBy(abort!),
        },
      });
      expect(state.status).toBe("failed");
      expect(state.meta.terminatedBy).toBe("timeout-after:1ms");
    });

    it("before-think 'stop' WITHOUT reason → meta.terminatedBy = 'killswitch:stop' sentinel", async () => {
      const pipeline = new HarnessPipeline([
        {
          kind: "before",
          phase: "think",
          fn: () => ({ abort: "stop" }),
        },
      ]);
      let state = makeState();
      const abort = await runPhaseHooks(pipeline, "before", "think", 0, state);
      expect(abort).toEqual({ abort: "stop" });
      state = transitionState(state, {
        status: abort!.abort === "terminate" ? "failed" : "done",
        output: state.output ?? "",
        meta: {
          ...state.meta,
          terminatedBy: killswitchTerminatedBy(abort!),
        },
      });
      expect(state.status).toBe("done");
      expect(state.meta.terminatedBy).toBe("killswitch:stop");
    });
  });
});
