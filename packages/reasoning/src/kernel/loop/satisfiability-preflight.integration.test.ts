// Run: bun test packages/reasoning/src/kernel/loop/satisfiability-preflight.integration.test.ts --timeout 15000
//
// GH #244 satisfiability preflight — THREADING pins (mission "wire it AND pin it").
//
// The pure decision (contract/satisfiability.ts) is pinned next door; this file
// pins that runner.ts ACTS on it before iteration 0's first LLM call:
//   (i)   slack task + zero relevant tools → abstained at iteration 0 with the
//         named capability reason (RED-first: fails before the runner wiring).
//   (ii)  same task + a capable tool → proceeds normally (tool called, no
//         preflight abstention — no misfire on partial overlap).
//   (iii) reasoning-only question + impoverished surface → preflight leaves it
//         alone (no capability abstention).
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import {
  TestLLMServiceLayer,
  LLMService,
  type TestTurn,
} from "@reactive-agents/llm-provider";
import { reactKernel } from "./react-kernel.js";
import { runPass } from "./run-pass.js";
import { succeedingToolLayer } from "../../testing/tool-service-mock.js";
import type { KernelInput } from "../state/kernel-state.js";

const SLACK_TASK = "Send a slack message to #general saying 'Hello team'";

const CRYPTO_SCHEMA = {
  name: "crypto-price",
  description: "current market value of digital coins",
  parameters: [{ name: "symbol", type: "string", required: true }],
};

const SLACK_SCHEMA = {
  name: "slack-post",
  description: "Send messages to Slack channels",
  parameters: [{ name: "channel", type: "string", required: true }],
};

const runKernel = (
  input: KernelInput,
  layer: Layer.Layer<LLMService>,
  maxIterations = 6,
) =>
  Effect.runPromise(
    runPass(reactKernel, input, {
      maxIterations,
      strategy: "reactive",
      kernelType: "react",
      taskId: "satisfiability-preflight",
    }).pipe(Effect.provide(layer)),
  );

const abstentionReason = (pass: { state: { meta: { abstention?: unknown } } }): string => {
  const a = pass.state.meta.abstention as { reason?: string } | undefined;
  return a?.reason ?? "";
};

describe("GH #244 — satisfiability preflight threading (runner iteration-0)", () => {
  it("(i) impossible task abstains at iteration 0 with the named capability reason", async () => {
    const pass = await runKernel(
      { task: SLACK_TASK, availableToolSchemas: [CRYPTO_SCHEMA] },
      TestLLMServiceLayer(),
    );
    expect(pass.state.meta.terminatedBy).toBe("abstained");
    // Fast path: the main loop never ran — no LLM call, no thinking iteration.
    expect(pass.state.iteration).toBe(0);
    expect(pass.state.llmCalls ?? 0).toBe(0);
    // Named reason: the capability + the tools that were available instead.
    expect(abstentionReason(pass)).toContain("send-message");
    expect(abstentionReason(pass)).toContain("crypto-price");
    // Harness-authored output (not a model fabrication).
    expect(abstentionReason(pass)).toContain("missing capability");
  }, 15000);

  it("(ii) REGRESSION: a capable tool on the surface → the run proceeds (no preflight misfire)", async () => {
    const layer = Layer.merge(
      TestLLMServiceLayer([
        { toolCall: { name: "slack-post", args: { channel: "#general" } } } as TestTurn,
      ]),
      succeedingToolLayer({ posted: true }, SLACK_SCHEMA.parameters),
    );
    const pass = await runKernel(
      { task: SLACK_TASK, availableToolSchemas: [CRYPTO_SCHEMA, SLACK_SCHEMA] },
      layer,
    );
    // The preflight must NOT have fired: either the run grounded on the tool
    // or it went around the loop — but never the capability abstention.
    expect(abstentionReason(pass)).not.toContain("missing capability");
    const called = pass.state.steps.some(
      (s) => s.type === "action" && JSON.stringify(s).includes("slack-post"),
    );
    expect(called).toBe(true);
  }, 15000);

  it("(iii) REGRESSION: a reasoning-only question is unaffected by the preflight", async () => {
    const pass = await runKernel(
      {
        task: "What is the capital of France?",
        availableToolSchemas: [CRYPTO_SCHEMA],
      },
      TestLLMServiceLayer(),
      3,
    );
    // Whatever the loop does (answers, exhausts, stands down), the capability
    // preflight is not the actor.
    expect(abstentionReason(pass)).not.toContain("missing capability");
    expect(pass.state.meta.terminatedBy).not.toBeUndefined();
  }, 15000);
});
