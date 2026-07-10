// Run: bun test packages/runtime/test/stream-abstention.test.ts
//
// `StreamCompleted.abstention` was DECLARED and never written.
//
// stream-types.ts:46 declares it:
//     /** Run-level abstention surface, present when the run abstained. */
//     readonly abstention?: { reason: string; missing: readonly string[] }
//
// `execute-stream.ts` builds the StreamCompleted event and never sets it. The
// non-streaming path does (`reactive-agent.ts:1553` → `projectAbstention`), so
// `run()` surfaces an abstention and `runStream()` silently does not.
//
// Probed live (cogito:8b, 2026-07-09):
//     run()       → { abstention: null, ... }
//     runStream() → { hasAbstentionField: false, metaTerminatedBy: null }
//
// The benchmark reads exactly this field:
//     const terminatedBy = completed.abstention ? "abstained" : meta.terminatedBy
//
// and `scoreAbstention` credits a trap task only when `terminatedBy ===
// "abstained"`. So **no abstention-trap task could ever score above 0 through the
// streaming path**, no matter how correctly the harness declined. The honesty
// rail — the framework's headline behaviour — was invisible to its own benchmark.
//
// The projection lives in ONE place and both paths call it. Duplicating three
// lines into execute-stream would have re-created the drift this repo keeps
// finding.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { projectAbstention } from "../src/engine/abstention-projection.js";

describe("projectAbstention — the single owner of the abstention surface", () => {
  it("projects when the run abstained AND carries a reason", () => {
    const a = projectAbstention({
      terminatedBy: "abstained",
      abstention: { reason: "required tool unavailable", missing: ["tool:employee-directory"] },
    });
    expect(a).toEqual({ reason: "required tool unavailable", missing: ["tool:employee-directory"] });
  });

  it("returns undefined when the run did NOT abstain", () => {
    expect(
      projectAbstention({
        terminatedBy: "final_answer",
        abstention: { reason: "x", missing: [] },
      }),
    ).toBeUndefined();
  });

  it("returns undefined when abstained but no reason was recorded", () => {
    expect(projectAbstention({ terminatedBy: "abstained" })).toBeUndefined();
  });

  it("returns undefined on an empty result", () => {
    expect(projectAbstention({})).toBeUndefined();
  });
});

// ─── WIRING: both result paths must project it ───────────────────────────────
//
// The unit tests above stay green even if execute-stream never calls this. That
// is precisely the bug, so pin the call sites.

const src = (p: string) => readFileSync(join(import.meta.dir, "..", "src", p), "utf8");

describe("WIRING: the STREAMING path surfaces abstention, like run() does", () => {
  it("execute-stream projects abstention onto StreamCompleted", () => {
    const s = src("engine/execute-stream.ts");
    expect(s).toContain("projectAbstention");
    expect(s).toMatch(/abstention:/);
  });

  it("the projected surface is attached to the StreamCompleted event itself", () => {
    // The bench reads `completed.abstention` first; that is the field that was
    // declared and never written.
    const s = src("engine/execute-stream.ts");
    expect(s).toMatch(/abstention: streamAbstention/);
  });

  it("the non-streaming path still uses the same single owner", () => {
    const s = src("reactive-agent.ts");
    expect(s).toContain("projectAbstention");
  });

  it("the projection is DEFINED once, not copy-pasted into both paths", () => {
    const stream = src("engine/execute-stream.ts");
    const agent = src("reactive-agent.ts");
    // Neither call site may re-implement the rule.
    expect(stream).not.toMatch(/terminatedBy !== "abstained"/);
    expect(agent).not.toMatch(/terminatedBy !== "abstained"/);
  });
});

// ─── LIMITATION (stated, not hidden) ─────────────────────────────────────────
//
// There is no end-to-end pin here, and that is a real gap, not an oversight.
//
// `makeExecuteStream` is not the async-iterable boundary (it returns an Effect;
// `agent.runStream` is the wrapper), and producing a genuinely ABSTAINED run is
// hard: `decideForcedAbstention` correctly returns null whenever the run has a
// deliverable, and a model that fabricates an answer produces one. Probed
// 2026-07-09 with cogito:8b AND the deterministic test provider, with a required
// tool that does not exist:
//
//     run()        → terminatedBy "end_turn", success true, abstention null
//     runStream()  → no abstention field
//
// So the abstention rail did not fire in either configuration. The projection and
// its two call sites are pinned above; the event's construction under a real
// abstained run is NOT yet pinned. Closing that needs a fixture that reaches
// forced abstention (no deliverable + required tool unavailable + iterations
// exhausted), which is the follow-up.
