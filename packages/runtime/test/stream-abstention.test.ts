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

// ─── VERIFIED END-TO-END (2026-07-09, after the fix) ─────────────────────────
//
// The fix was confirmed by running the bench cell that this bug made unscoreable.
// `ab-trap-4` declares a required tool the agent is never given, so the harness
// abstains at iteration 0 (requiredToolUnavailable, iterationsRemaining 0):
//
//   BEFORE the fix:  accuracy 0.0, 0 tokens, output "Task complete."
//   AFTER  the fix:  accuracy 1.0, 0 tokens, output "Task complete."   (both arms)
//
// Same harness behaviour, same zero tokens. The ONLY thing that changed is that
// the stream now carries the abstention, so `scoreAbstention` can see it. The
// framework was declining honestly the whole time and its own benchmark scored
// that as a failure.
//
// RETRACTION. An earlier note here (and the commit message of b6c0d390) claimed
// "the abstention rail did not fire in either configuration". That was wrong.
// It was inferred from a probe that never called `.withReasoning()`, so no kernel
// loop ran at all. The rail fires; the stream dropped it. Evidence beats
// inference, and a probe that skips the feature under test proves nothing.
//
// STILL UNPINNED: `ab-trap-4` abstains BEFORE the loop starts, so it exercises
// the rail but not the mid-loop control seams (F3 / stall), which need abstention
// to qualify *during* the loop (>= 2 ungrounded-synthesis rejections). A fixture
// for that — a required tool that EXISTS but always fails — is the follow-up.
