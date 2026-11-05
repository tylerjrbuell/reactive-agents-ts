import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  approvalDecisionSlot,
  bindRun,
  childRunScope,
  getRunSlot,
  runControllerSlot,
  withRunScope,
} from "../src/internal/run-scope.js";
import { childContext, rootContext } from "../src/run-context.js";
import type { RunControllerLike } from "../src/index.js";

const root = rootContext("run-r", "agent-r");

describe("per-run decision slots", () => {
  it("an approval decision is bound at the run entry and never reaches a sub-agent", async () => {
    const decision = { gateId: "g1", status: "approved" as const };
    const { inRun, inChild } = await Effect.runPromise(
      Effect.gen(function* () {
        const inRun = yield* getRunSlot(approvalDecisionSlot);
        const inChild = yield* getRunSlot(approvalDecisionSlot).pipe(childRunScope(childContext(root, "sub")));
        return { inRun, inChild };
      }).pipe(withRunScope(root, bindRun(approvalDecisionSlot, decision))),
    );
    expect(inRun?.gateId).toBe("g1");
    expect(inChild).toBeNull();
  });

  it("an unbound run has no decision", async () => {
    expect(await Effect.runPromise(getRunSlot(approvalDecisionSlot).pipe(withRunScope(root)))).toBeNull();
  });

  it("the run controller reaches sub-agents, so a stop stops them too", async () => {
    const controller: RunControllerLike = { checkpoint: () => Promise.resolve(undefined) };
    const inChild = await Effect.runPromise(
      getRunSlot(runControllerSlot).pipe(childRunScope(childContext(root, "sub")), withRunScope(root, bindRun(runControllerSlot, controller))),
    );
    expect(inChild).toBe(controller);
  });
});
