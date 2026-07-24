// Run: bun test packages/reasoning/src/kernel/capabilities/act/approval-gate.test.ts
//
// Unit pins for the block-mode approval gate (Durable HITL, Phase D). The
// end-to-end behavioral pins live in runtime (approval-block-mode-gate.test.ts);
// these pin the pure decision + the fail-closed wrapper in isolation.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  resolveBlockApproval,
  wrapApprovalDecider,
  type BlockApprovalPolicy,
} from "./approval-gate.js";

const gatingPolicy = (over: Partial<BlockApprovalPolicy> = {}): BlockApprovalPolicy => ({
  mode: "block",
  tools: new Set(["danger"]),
  ...over,
});

describe("resolveBlockApproval", () => {
  it("deny-by-default: a gated call with no decider is refused", async () => {
    const out = await Effect.runPromise(
      resolveBlockApproval("danger", {}, gatingPolicy(), { iteration: 0 }),
    );
    expect(out.gated).toBe(true);
    expect(out.gated && out.approved).toBe(false);
    expect(out.gated && !out.approved && out.message).toContain("no approval handler is configured");
  });

  it("a non-gated tool passes through (not gated)", async () => {
    const out = await Effect.runPromise(
      resolveBlockApproval("safe", {}, gatingPolicy(), { iteration: 0 }),
    );
    expect(out.gated).toBe(false);
  });

  it("detach mode is never handled here — the run-pause path owns it", async () => {
    const out = await Effect.runPromise(
      resolveBlockApproval("danger", {}, gatingPolicy({ mode: "detach" }), { iteration: 0 }),
    );
    expect(out.gated).toBe(false);
  });

  it("an undefined policy is not a gate", async () => {
    const out = await Effect.runPromise(
      resolveBlockApproval("danger", {}, undefined, { iteration: 0 }),
    );
    expect(out.gated).toBe(false);
  });

  it("decider approve → gated + approved", async () => {
    const out = await Effect.runPromise(
      resolveBlockApproval("danger", {}, gatingPolicy({
        decide: () => Effect.succeed({ approve: true }),
      }), { iteration: 0 }),
    );
    expect(out.gated && out.approved).toBe(true);
  });

  it("decider deny → gated + refused, reason surfaced", async () => {
    const out = await Effect.runPromise(
      resolveBlockApproval("danger", {}, gatingPolicy({
        decide: () => Effect.succeed({ approve: false, reason: "nope" }),
      }), { iteration: 0 }),
    );
    expect(out.gated && !out.approved).toBe(true);
    expect(out.gated && !out.approved && out.message).toContain("nope");
  });

  it("requireFor can gate a tool not in the tools set", async () => {
    const out = await Effect.runPromise(
      resolveBlockApproval("anything", {}, {
        mode: "block",
        tools: new Set<string>(),
        requireFor: ({ toolName }) => toolName === "anything",
      }, { iteration: 0 }),
    );
    // No decider → deny-by-default, proving requireFor engaged the gate.
    expect(out.gated && !out.approved).toBe(true);
  });
});

describe("wrapApprovalDecider", () => {
  it("coerces a bare boolean true → { approve: true }", async () => {
    const decide = wrapApprovalDecider(() => true);
    const d = await Effect.runPromise(decide({ toolName: "x", args: {}, iteration: 0 }));
    expect(d).toEqual({ approve: true });
  });

  it("passes an ApprovalDecision object through", async () => {
    const decide = wrapApprovalDecider(() => ({ approve: false, reason: "r" }));
    const d = await Effect.runPromise(decide({ toolName: "x", args: {}, iteration: 0 }));
    expect(d).toEqual({ approve: false, reason: "r" });
  });

  it("awaits a Promise-returning callback", async () => {
    const decide = wrapApprovalDecider(async () => ({ approve: true }));
    const d = await Effect.runPromise(decide({ toolName: "x", args: {}, iteration: 0 }));
    expect(d.approve).toBe(true);
  });

  it("FAILS CLOSED: a throwing callback denies rather than crashing", async () => {
    const decide = wrapApprovalDecider(() => {
      throw new Error("boom");
    });
    const d = await Effect.runPromise(decide({ toolName: "x", args: {}, iteration: 0 }));
    expect(d.approve).toBe(false);
    expect(d.reason).toContain("fail-closed");
  });

  it("FAILS CLOSED: a rejecting async callback denies", async () => {
    const decide = wrapApprovalDecider(async () => {
      throw new Error("async boom");
    });
    const d = await Effect.runPromise(decide({ toolName: "x", args: {}, iteration: 0 }));
    expect(d.approve).toBe(false);
  });
});
