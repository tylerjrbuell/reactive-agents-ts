// File: tests/kernel/recovery-steering-policy.test.ts
//
// 2026-10-23 introspective harness loop — recovery-steering policy fix (B).
//
// Root cause (wiki/Research/Harness-Reports/introspective-2026-10-24-02-*;
// 3/6 probe runs named this message actively confusing): when a tool failed
// because tool POLICY refused it (sandbox allowlist, contract deny-list,
// path-traversal confinement), the alternate-path rotation steer still fired —
// "Recovery required: prior tool path failed (file-write). Try an alternate
// path now: file-read." file-read cannot remedy a blocked write. The rotation
// was designed for wrong-guess path errors, not policy denials.
//
// Contract pinned here:
//   1. A failed tool whose latest error text is a policy denial puts the steer
//      in a policy arm that NEVER names an alternate tool and instead
//      re-surfaces the denial's own remedy text.
//   2. Non-policy failures (plain wrong path, transient errors) keep the
//      existing alternate-path / retry steering byte-identical.

import { describe, it, expect } from "bun:test";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import type { ReasoningStep } from "../../src/types/index.js";
import {
  buildRecoverySteeringGuidance,
  getToolFailureRecoveryFromSteps,
  isPolicyDeniedToolError,
  type ToolFailureRecoveryOptions,
} from "../../src/kernel/loop/runner-helpers/recovery-steering.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const failedObs = (toolName: string, error: string): ReasoningStep =>
  makeStep("observation", error, {
    observationResult: makeObservationResult(toolName, false, error),
  });

const successObs = (toolName: string, content: string): ReasoningStep =>
  makeStep("observation", content, {
    observationResult: makeObservationResult(toolName, true, content),
  });

const opts: ToolFailureRecoveryOptions = {
  availableToolNames: ["file-write", "file-read", "web-search"],
};

/** Real confinePath() message shape from packages/tools file-operations (read-only). */
const TRAVERSAL_DENIAL =
  `Path traversal detected: /home/user/out.md resolves to /home/user/out.md, outside the ` +
  `working root /sandbox/root. Paths are relative to the working root, never the ` +
  `filesystem root. Use a relative path instead, e.g. "./out.md".`;

/** Real kernel allowlist block message from act/tool-observe.ts. */
const ALLOWLIST_DENIAL =
  `[Tool "file-write" is not in allowedTools — blocked. Allowed: file-read]`;

/** Real contract deny-list block message from act/tool-observe.ts. */
const CONTRACT_DENIAL = `[Tool "file-write" is forbidden by contract — blocked.]`;

// ─── Classifier unit pins ─────────────────────────────────────────────────────

describe("isPolicyDeniedToolError — conservative denial classifier", () => {
  it("classifies the block/allowlist/sandbox/path-traversal families", () => {
    expect(isPolicyDeniedToolError(TRAVERSAL_DENIAL)).toBe(true);
    expect(isPolicyDeniedToolError(ALLOWLIST_DENIAL)).toBe(true);
    expect(isPolicyDeniedToolError(CONTRACT_DENIAL)).toBe(true);
    expect(isPolicyDeniedToolError("rm is blocked — use the file-write tool to manage files")).toBe(true);
    expect(isPolicyDeniedToolError("Execution refused: command runs outside the sandbox allowlist")).toBe(true);
    expect(isPolicyDeniedToolError("EACCES: permission denied, open '/etc/hosts'")).toBe(true);
  });

  it("does NOT classify wrong-path / transient / ordinary failures", () => {
    expect(isPolicyDeniedToolError("ENOENT: no such file or directory, open './nope.txt'")).toBe(false);
    expect(isPolicyDeniedToolError("connection refused: search backend unreachable")).toBe(false);
    expect(isPolicyDeniedToolError("Timed out after 5000ms")).toBe(false);
    expect(isPolicyDeniedToolError("")).toBe(false);
  });
});

// ─── Recovery scan pins ───────────────────────────────────────────────────────

describe("getToolFailureRecoveryFromSteps — policy-denial detection", () => {
  it("flags a policy-blocked tool in policyBlocked with its error excerpt", () => {
    const recovery = getToolFailureRecoveryFromSteps(
      [failedObs("file-write", TRAVERSAL_DENIAL)],
      opts,
    );
    expect(recovery.failedUnresolved).toContain("file-write");
    expect(recovery.policyBlocked).toContain("file-write");
    expect(recovery.policyErrors?.["file-write"]).toContain("Use a relative path instead");
  });

  it("does not flag a plain wrong-path failure", () => {
    const recovery = getToolFailureRecoveryFromSteps(
      [failedObs("file-read", "ENOENT: no such file or directory, open './nope.txt'")],
      opts,
    );
    expect(recovery.policyBlocked ?? []).toEqual([]);
  });

  it("clears the flag once the tool later succeeds", () => {
    const recovery = getToolFailureRecoveryFromSteps(
      [failedObs("file-write", TRAVERSAL_DENIAL), successObs("file-write", "wrote ./out.md")],
      opts,
    );
    expect(recovery.failedUnresolved).toEqual([]);
    expect(recovery.policyBlocked ?? []).toEqual([]);
  });
});

// ─── Steering-guidance arms ───────────────────────────────────────────────────

describe("buildRecoverySteeringGuidance — never chase an alternate tool past a policy denial", () => {
  it("stall arm: policy-blocked write re-surfaces the remedy and names NO alternate tool", () => {
    const recovery = getToolFailureRecoveryFromSteps(
      [failedObs("file-write", TRAVERSAL_DENIAL)],
      opts,
    );
    const guidance = buildRecoverySteeringGuidance(recovery, 1, 2, "stall");

    // The message that 3/6 probe runs called actively confusing must be gone:
    expect(guidance).not.toContain("Try an alternate path now");
    expect(guidance).not.toContain("file-read");
    expect(guidance).not.toContain("web-search");

    // Instead: denial class + the tool's own remedy, retry the SAME tool.
    expect(guidance).toContain("refused by tool policy");
    expect(guidance).toContain("file-write");
    expect(guidance).toContain('Use a relative path instead, e.g. "./out.md"');
    expect(guidance).toContain("Do not finalize yet.");
    expect(guidance).toContain("(1/2)");
  });

  it("loop arm: same policy guarantee under loop detection", () => {
    const recovery = getToolFailureRecoveryFromSteps(
      [failedObs("file-write", TRAVERSAL_DENIAL)],
      opts,
    );
    const guidance = buildRecoverySteeringGuidance(recovery, 2, 3, "loop");

    expect(guidance).not.toContain("Try alternate path");
    expect(guidance).not.toContain("file-read");
    expect(guidance).toContain("policy");
    expect(guidance).toContain("file-write");
    expect(guidance).toContain("(2/3)");
  });

  it("kernel allowlist block (probe-evidence scenario) also routes to the policy arm", () => {
    const recovery = getToolFailureRecoveryFromSteps(
      [failedObs("file-write", ALLOWLIST_DENIAL)],
      opts,
    );
    expect(recovery.alternativeCandidates.length).toBeGreaterThan(0); // file-read IS in the pool...
    const guidance = buildRecoverySteeringGuidance(recovery, 1, 2, "stall");
    // ...but the steer must not chase it: an alternate tool cannot lift a denial.
    // (The raw denial text legitimately re-surfaced as the remedy may MENTION
    // allowed tools — that is the tool's own error, not the steer advising a
    // rotation. The steer itself must never recommend an alternate path.)
    expect(guidance).not.toContain("Try an alternate path now");
    expect(guidance).not.toContain("Try alternate path");
    expect(guidance).toContain("file-write");
  });

  it("mixed failures (policy + transient): policy denial still wins the steer", () => {
    const recovery = getToolFailureRecoveryFromSteps(
      [
        failedObs("web-search", "connection refused: search backend unreachable"),
        failedObs("file-write", CONTRACT_DENIAL),
      ],
      opts,
    );
    const guidance = buildRecoverySteeringGuidance(recovery, 1, 2, "stall");
    expect(guidance).not.toContain("Try an alternate path now");
    expect(guidance).toContain("file-write");
  });

  it("non-policy wrong-path failure keeps the pre-fix alternate-path message BYTE-IDENTICAL", () => {
    const recovery = getToolFailureRecoveryFromSteps(
      [failedObs("file-read", "ENOENT: no such file or directory, open './nope.txt'")],
      opts,
    );
    const guidance = buildRecoverySteeringGuidance(recovery, 1, 2, "stall");
    expect(guidance).toBe(
      "Recovery required: prior tool path failed (file-read). Try an alternate path now: file-write. Do not finalize yet. (1/2)",
    );
  });

  it("non-policy transient failure keeps the pre-fix retry-corrected-args message BYTE-IDENTICAL", () => {
    // Only the failing tool is available → no alternate candidates → retry arm.
    const recovery = getToolFailureRecoveryFromSteps(
      [failedObs("web-search", "connection refused: search backend unreachable")],
      { availableToolNames: ["web-search"] },
    );
    const guidance = buildRecoverySteeringGuidance(recovery, 1, 2, "stall");
    expect(guidance).toBe(
      "Recovery required: prior tool path failed (web-search). Retry web-search with corrected arguments/evidence. Do not finalize yet. (1/2)",
    );
    const loopGuidance = buildRecoverySteeringGuidance(recovery, 2, 3, "loop");
    expect(loopGuidance).toBe(
      "Recovery required: loop detected after failed tool path (web-search). Retry web-search with corrected arguments before completion. (2/3)",
    );
  });
});
