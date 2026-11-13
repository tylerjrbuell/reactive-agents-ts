// Run: bun test packages/reasoning/tests/kernel/read-and-answer-real-surface.test.ts --timeout 20000
//
// Ablation 2026-11-13 (wiki/Research/Harness-Reports/2026-11-13-recent-default-harness-ablation.md):
// after 795a51884 (retrieval results never count as a landed side effect) the H3
// tasks h3-continuation / h3-exact-value ("Read config.json ... tell me", "Add the
// two counts ... reply") ended `failure` / stall_deliverable with the RIGHT answer:
// the loose prose heuristic derived SideEffectLanded (the bench wrapper's
// "Working directory for this task" line supplied the noun, "reply"/"add" the verb)
// and nothing a read can do meets it. The surface here is the REAL h3 one
// (tool-surface-resolved: file-read required + file-write builtins-floor), which
// the earlier retrieval-only fixture missed. deriveConditions now pairs verb and
// noun within one clause, so the preamble line and the answer-shaped sentence
// never combine.
//
// RED-ON-CUT: in derive-conditions.ts namesMutationOfResource, test the whole
// text instead of per clause and this ends failed.
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
    name: "file-read",
    description: "read a file",
    parameters: [{ name: "path", type: "string", required: true }],
  },
  {
    name: "file-write",
    description: "write a file",
    parameters: [
      { name: "path", type: "string", required: true },
      { name: "content", type: "string", required: true },
    ],
  },
];

let padN = 0;
const pad = (): string => {
  padN += 1;
  return Array.from({ length: 450 }, (_, i) => `r${padN}x${i}`).join(" ");
};

const input: KernelInput = {
  task:
    "Working directory for this task: /tmp/bench\n\n" +
    'Read /tmp/bench/config.json in your working directory and tell me the value of build.releaseCode (the one under "build", not any other releaseCode). Reply with that value.',
  availableToolSchemas: SCHEMAS,
  contextProfile: { tier: "local" },
} as KernelInput;

const opts: KernelRunOptions = {
  maxIterations: 8,
  strategy: "reactive",
  kernelType: "react",
  taskId: "retrieval-only-surface-answers",
  modelId: "llama3.2:3b",
};

const tools = mockToolServiceLayer({
  execute: () => Effect.succeed({ success: true, result: '{"build":{"releaseCode":"RC-7392-QZ"}}' }),
  getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: SCHEMAS[0]!.parameters }),
});

describe("a read-and-answer task on the real h3 surface (file-read + file-write) completes", () => {
  it("file-read then answer ends done, never held to an unmeetable SideEffectLanded", async () => {
    const answer = "The build.releaseCode is RC-7392-QZ.";
    const pass = await Effect.runPromise(
      runPass(reactKernel, input, opts).pipe(
        Effect.provide(
          Layer.mergeAll(
            TestLLMServiceLayer([
              { text: pad(), toolCall: { name: "file-read", args: { path: "/tmp/bench/config.json" } } },
              { text: answer },
              { text: answer },
            ]),
            tools,
            EventBusLive,
          ),
        ),
      ),
    );
    expect(pass.state.status).toBe("done");
    expect(String(pass.state.error ?? "")).not.toContain("actually complete the requested action");
  });
});
