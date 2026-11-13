// Run: bun test packages/reasoning/tests/kernel/meta-only-action-not-success.test.ts --timeout 20000
//
// Ablation 2026-11-13 finding 2: "send an email" with NO domain tool; the model
// only called `recall` (a successful memory save), then claimed "The email has
// been sent". The contract held `action:send-message` declared, but no
// PostCondition was seeded on an empty surface, so the exit gate accepted with
// nothing outstanding and the run shipped success (1/4 live). A meta-tool result
// is not the action: the gate now names the unlanded action requirement.
//
// RED-ON-CUT: in loop/exit-gate.ts contractOutstanding, remove the
// unlandedActionRequirements loop and this run ends done.
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { EventBusLive } from "@reactive-agents/core";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import type { KernelInput, KernelRunOptions } from "../../src/kernel/state/kernel-state.js";

const SCHEMAS = [
  {
    name: "recall",
    description: "save or look up a note in memory",
    parameters: [{ name: "content", type: "string", required: false }],
  },
];

let padN = 0;
const pad = (): string => {
  padN += 1;
  return Array.from({ length: 450 }, (_, i) => `m${padN}x${i}`).join(" ");
};

const input: KernelInput = {
  task: "Send an email to the team announcing that the release shipped.",
  availableToolSchemas: [],
  contextProfile: { tier: "local" },
} as KernelInput;

const opts: KernelRunOptions = {
  maxIterations: 8,
  strategy: "reactive",
  kernelType: "react",
  taskId: "meta-only-action-not-success",
  modelId: "llama3.2:3b",
};

const tools = mockToolServiceLayer({
  execute: () => Effect.succeed({ success: true, result: "saved" }),
  getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: SCHEMAS[0]!.parameters }),
});

describe("a meta-tool-only run never completes an action-required task", () => {
  it("a successful recall save does not stand in for the email; the run does not complete", async () => {
    const claim = "The email has been successfully sent to the team.";
    const pass = await Effect.runPromise(
      runPass(reactKernel, input, opts).pipe(
        Effect.provide(
          Layer.mergeAll(
            TestLLMServiceLayer([
              { text: pad(), toolCall: { name: "recall", args: { content: "release shipped" } } },
              { text: claim },
              { text: claim },
              { text: claim },
              { text: claim },
            ]),
            tools,
            EventBusLive,
          ),
        ),
      ),
    );
    expect(pass.state.status).toBe("failed");
    expect(pass.state.steps.some((s) => String(s.content).includes("perform the requested action"))).toBe(true);
  });
});
