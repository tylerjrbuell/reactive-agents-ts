// Run: bun test packages/reasoning/src/kernel/capabilities/act/duplicate-guard-epoch.test.ts --timeout 20000
//
// duplicateGuard replays a prior identical result only inside one workspace
// epoch. A successful mutating call (file-write, file-edit, shell-execute,
// code-execute) after the prior call makes that result stale, so the repeat
// must execute. Spike 2026-11-07 feedback-loop §3: re-running `bun test` after
// writing a test file replayed the pre-edit "No tests found!" plus "Give FINAL
// ANSWER". Non-mutating calls in between do not end the epoch.
import { describe, expect, it } from "bun:test";
import { duplicateGuard } from "./guard.js";
import { makeStep } from "../sense/step-utils.js";
import { makeObservationResult } from "../../utils/observation-helpers.js";
import { initialKernelState, transitionState } from "../../state/kernel-state.js";
import { makeKernelInput, makeKernelRunOptions } from "../../../testing/kernel-fixtures.js";
import type { ReasoningStep } from "../../../types/index.js";

const call = (id: string, name: string, args: Record<string, unknown>, out: string, success = true): ReasoningStep[] => [
  makeStep("action", `${name}(${JSON.stringify(args)})`, { toolCall: { id, name, arguments: args } }),
  makeStep("observation", out, { toolCallId: id, observationResult: makeObservationResult(name, success, out) }),
];

const input = makeKernelInput({ task: "Edit a.ts then re-read it." });
const stateWith = (steps: ReasoningStep[]) =>
  transitionState(initialKernelState(makeKernelRunOptions({ strategy: "reactive", maxIterations: 14 })), { steps });
const reread = { id: "c9", name: "file-read", arguments: { path: "a.ts" } };

describe("duplicateGuard workspace epoch", () => {
  it("re-executes a read after a successful file-write landed", () => {
    const state = stateWith([
      ...call("c1", "file-read", { path: "a.ts" }, "OLD"),
      ...call("c2", "file-write", { path: "a.ts", content: "NEW" }, "written"),
    ]);
    expect(duplicateGuard(reread, state, input).pass).toBe(true);
  });

  it("re-executes after shell-execute or code-execute mutated the workspace", () => {
    for (const name of ["shell-execute", "code-execute", "file-edit"]) {
      const state = stateWith([
        ...call("c1", "file-read", { path: "a.ts" }, "OLD"),
        ...call("c2", name, { command: "x" }, "ok"),
      ]);
      expect(duplicateGuard(reread, state, input).pass).toBe(true);
    }
  });

  it("still replays a true duplicate when only non-mutating calls intervened", () => {
    const state = stateWith([
      ...call("c1", "file-read", { path: "a.ts" }, "SAME"),
      ...call("c2", "web-search", { query: "q" }, "hits"),
      ...call("c3", "file-write", { path: "b.ts", content: "x" }, "boom", false),
    ]);
    const r = duplicateGuard(reread, state, input);
    expect(r.pass).toBe(false);
    if (!r.pass) expect(r.observation).toContain("Already done");
  });

  it("replays again once the post-mutation read is itself the prior result", () => {
    const state = stateWith([
      ...call("c1", "file-read", { path: "a.ts" }, "OLD"),
      ...call("c2", "file-write", { path: "a.ts", content: "NEW" }, "written"),
      ...call("c3", "file-read", { path: "a.ts" }, "NEW"),
    ]);
    const r = duplicateGuard(reread, state, input);
    expect(r.pass).toBe(false);
    if (!r.pass) expect(r.observation.startsWith("NEW [Already done")).toBe(true);
  });
});
