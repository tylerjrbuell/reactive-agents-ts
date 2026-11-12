// Run: bun test packages/reasoning/tests/kernel/outstanding-action-not-success.test.ts --timeout 20000
//
// Real Telegram traces (2026-11-12, runs 01M78M4J93MA32GD2ZA06Y5AYH and
// 01M78M556YNFTH9B97VJHQPPDD): the task required an outbound send; the only
// visible tool was `web-search`. The exit gate denied the early end_turn
// ("actually complete the requested action"), the model then web-searched for
// how to send, the search SUCCEEDED, and `SideEffectLanded` read that success as
// the send landing: gate accepted with nothing outstanding, the run ended
// success / deliverable_decision=pass although nothing was delivered.
//
// RED-ON-CUT: in verify/post-conditions.ts isSideEffectLanded, drop the
// `|| isRetrievalToolName(...)` skips and this fails (run ends completed).
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
    name: "web-search",
    description: "search the web",
    parameters: [{ name: "query", type: "string", required: true }],
  },
];

let padN = 0;
const pad = (): string => {
  padN += 1;
  return Array.from({ length: 450 }, (_, i) => `h${padN}x${i}`).join(" ");
};

// The task shape the gateway produced (channelOutboundToolGuidance appended).
const input: KernelInput = {
  task:
    "You are in a live conversation with 8761507290 on telegram.\n\nUser: Hello\n\n" +
    "You MUST deliver your reply on this channel by calling a tool that sends an outbound message.",
  availableToolSchemas: SCHEMAS,
  contextProfile: { tier: "local" },
} as KernelInput;

const opts: KernelRunOptions = {
  maxIterations: 8,
  strategy: "reactive",
  kernelType: "react",
  taskId: "outstanding-action-not-success",
  modelId: "llama3.2:3b",
};

const tools = mockToolServiceLayer({
  execute: () => Effect.succeed({ success: true, result: "1. send_message_tool.py: cross-channel messaging via platform APIs" }),
  getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: SCHEMAS[0]!.parameters }),
});

describe("an outstanding action requirement is never success", () => {
  it("a successful web-search does not stand in for the send; the run does not complete", async () => {
    const pass = await Effect.runPromise(
      runPass(reactKernel, input, opts).pipe(
        Effect.provide(
          Layer.mergeAll(
            TestLLMServiceLayer([
              { text: "I need to send a message but have no send tool." },
              { text: pad(), toolCall: { name: "web-search", args: { query: "telegram send message tool" } } },
              { text: "Hello! I could not send this through the channel; the messaging tool is not available." },
              { text: "Hello! I could not send this through the channel; the messaging tool is not available." },
            ]),
            tools,
            EventBusLive,
          ),
        ),
      ),
    );
    const state = pass.state;
    expect(state.status).toBe("failed");
    expect(String(state.error)).toContain("actually complete the requested action");
  });
});
