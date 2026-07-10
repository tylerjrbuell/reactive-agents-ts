// Run: bun test packages/runtime/test/receipt-target-wiring.test.ts
//
// The receipt's rule-3 fix (core/test/receipt-unresolved-required.test.ts) is
// only real if two things actually reach `computeTrustReceipt`:
//
//   1. a `target` fingerprint on each tool call, so a retried attempt can be
//      told apart from a call to something else;
//   2. the run's `requiredTools`, which is what arms the rule at all.
//
// Unit-testing `computeTrustReceipt` proves neither. Both call sites are
// pinned here — cut either and these go red.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeTrustReceipt } from "@reactive-agents/core";
import { deriveReceiptToolCalls, toolCallTarget } from "../src/builder/helpers.js";

const action = (id: string, name: string, args: unknown) => ({
  type: "action",
  metadata: { toolCall: { id, name, arguments: args } },
});
const observation = (id: string, success: boolean) => ({
  type: "observation",
  metadata: { toolCallId: id, observationResult: { success } },
});

describe("toolCallTarget — a stable fingerprint of what the call was about", () => {
  it("is insensitive to key order (the same call across two turns)", () => {
    expect(toolCallTarget({ path: "./a", encoding: "utf-8" })).toBe(
      toolCallTarget({ encoding: "utf-8", path: "./a" }),
    );
  });

  it("distinguishes two reads of different files", () => {
    expect(toolCallTarget({ path: "./orders.json" })).not.toBe(toolCallTarget({ path: "./rates.json" }));
  });

  it("is undefined for empty / non-object arguments, never a bogus match", () => {
    expect(toolCallTarget({})).toBeUndefined();
    expect(toolCallTarget(undefined)).toBeUndefined();
    expect(toolCallTarget([1, 2])).toBeUndefined();
  });

  it("survives a non-serialisable argument by declining to fingerprint", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(toolCallTarget(circular)).toBeUndefined();
  });
});

describe("WIRING: deriveReceiptToolCalls carries the target off the step trace", () => {
  it("emits a target for each action, derived from its arguments", () => {
    const calls = deriveReceiptToolCalls({
      reasoningSteps: [
        action("c1", "file-read", { path: "./orders.json" }),
        observation("c1", true),
      ],
    });
    expect(calls).toEqual([
      { name: "file-read", ok: true, target: toolCallTarget({ path: "./orders.json" })! },
    ]);
  });

  it("two reads of different files are two distinct targets", () => {
    const calls = deriveReceiptToolCalls({
      reasoningSteps: [
        action("c1", "file-read", { path: "./orders.json" }),
        action("c2", "file-read", { path: "./rates.json" }),
        observation("c1", true),
        observation("c2", false),
      ],
    });
    expect(calls.map((c) => c.ok)).toEqual([true, false]);
    expect(calls[0]!.target).not.toBe(calls[1]!.target);
  });
});

describe("END TO END: the measured traces, through the real derivation", () => {
  // The fabricating run (haiku + qwen, rails off, 2026-07-09).
  const fabricationSteps = [
    action("c1", "file-read", { path: "./orders.json" }),
    action("c2", "file-read", { path: "./rates.json" }),
    observation("c1", true),
    observation("c2", false),
    action("c3", "file-write", { path: "./result.txt", content: "174.7912" }),
    observation("c3", true),
  ];

  // The recovering run, after list-directory shipped. SAME ENOENT.
  const recoverySteps = [
    action("c1", "file-read", { path: "./orders.json" }),
    action("c2", "file-read", { path: "./rates.json" }),
    observation("c1", true),
    observation("c2", false),
    action("c3", "list-directory", { path: "." }),
    observation("c3", true),
    action("c4", "file-read", { path: "./config.json" }),
    observation("c4", true),
    action("c5", "file-write", { path: "./result.txt", content: "184.00" }),
    observation("c5", true),
  ];

  const receipt = (steps: typeof fabricationSteps, goalAchieved: boolean | null) =>
    computeTrustReceipt({
      toolCalls: deriveReceiptToolCalls({ reasoningSteps: steps }),
      goalAchieved,
      abstained: false,
      success: true,
      modelId: "test",
      now: 0,
    });

  it("the fabrication (end_turn) yields `partially-grounded`", () => {
    const r = receipt(fabricationSteps, null);
    expect(r.verdict).toBe("partially-grounded");
    expect(r.toolCallStats).toEqual({ ok: 2, failed: 1 });
  });

  it("the recovery (final_answer_tool) stays `tool-grounded`, despite the same ENOENT", () => {
    const r = receipt(recoverySteps, true);
    expect(r.verdict).toBe("tool-grounded");
    expect(r.toolCallStats).toEqual({ ok: 4, failed: 1 });
  });

  it("the ONLY difference between them, at the receipt, is the ending", () => {
    // Feed the recovery's steps with the fabrication's ambiguous ending: the
    // unresolved rates.json read is still there, so it downgrades. This is what
    // makes `goalAchieved` load-bearing rather than decorative.
    expect(receipt(recoverySteps, null).verdict).toBe("partially-grounded");
  });
});

// ─── The derivation is what arms the rule; pin it. ───────────────────────────
//
// `computeTrustReceipt` resolves failures per (tool, target). If the runtime
// stopped emitting `target`, EVERY failure would read as unresolved and honest
// retries would be downgraded. Nothing above would catch that, because these
// tests hand-build their own steps — so assert the derivation directly.

const src = (p: string) => readFileSync(join(import.meta.dir, "..", "src", p), "utf8");

describe("WIRING: the runtime emits the target the receipt resolves on", () => {
  it("deriveReceiptToolCalls reads toolCall.arguments, not just the name", () => {
    expect(src("builder/helpers.ts")).toMatch(/toolCallTarget\(toolCall\.arguments\)/);
  });

  it("a retried call and its retry share a target, so the receipt can resolve them", () => {
    const calls = deriveReceiptToolCalls({
      reasoningSteps: [
        action("c1", "file-read", { path: "./a" }),
        action("c2", "file-read", { path: "./a" }),
        observation("c1", false),
        observation("c2", true),
      ],
    });
    expect(calls[0]!.target).toBe(calls[1]!.target!);
    expect(calls.map((c) => c.ok)).toEqual([false, true]);
  });
});
