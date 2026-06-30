// Run: bun test packages/reasoning/tests/strategies/kernel/provider-quirk-contract.test.ts --timeout 15000
//
// CROSS-PROVIDER CONTRACT. Every strategy is otherwise tested only against the
// deterministic mock, which emits CLEAN function-calls — so provider-specific
// output quirks (stringified args, snake_case tool names, <think> leakage) break
// strategies with ZERO failing test. This replays the react kernel's core
// contract (tool call → resolve; final answer → clean) across the quirks real
// providers actually emit, proving the harness (resolver + healing + think-strip)
// normalizes each one. Deterministic — no live models. Extend QUIRKS to add more.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { executeReActKernel, reactKernel } from "../../../src/kernel/loop/react-kernel.js";
import { TestLLMServiceLayer, type ProviderQuirk } from "@reactive-agents/llm-provider";
import {
  initialKernelState,
  noopHooks,
  type KernelContext,
} from "../../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../src/context/context-profile.js";
import { createToolCallResolver, TextParseDriver } from "@reactive-agents/tools";

function makeContext(overrides?: Partial<KernelContext>): KernelContext {
  const profile = CONTEXT_PROFILES["mid"];
  return {
    input: { task: "Test task" },
    profile,
    compression: { budget: profile.toolResultMaxChars ?? 800, previewItems: 3, autoStore: true, codeTransform: true },
    toolService: { _tag: "None" },
    hooks: noopHooks,
    toolCallingDriver: new TextParseDriver(),
    ...overrides,
  } as KernelContext;
}

const fcResolver = () =>
  createToolCallResolver({ supportsToolCalling: true, supportsStreaming: true, supportsStructuredOutput: false, supportsLogprobs: false });

// Quirks that affect the native tool-call path the kernel resolves.
const TOOLCALL_QUIRKS: (ProviderQuirk | undefined)[] = [undefined, "snake_case-name", "stringified-args"];

describe.each(TOOLCALL_QUIRKS)("react kernel resolves a tool call under provider quirk: %s", (quirk) => {
  it("resolves to the registered tool name with the correct args", async () => {
    const layer = TestLLMServiceLayer(
      [{ match: "Task:", toolCall: { name: "web-search", args: { query: "hello world" } } }],
      quirk,
    );
    const context = makeContext({
      input: {
        task: "Find something",
        toolCallResolver: fcResolver(),
        availableToolSchemas: [{ name: "web-search", description: "search the web", parameters: [{ name: "query", type: "string", required: true }] }],
      } as KernelContext["input"],
    });
    const state = initialKernelState({ maxIterations: 3, strategy: "react-kernel", kernelType: "react" });

    const next = await Effect.runPromise(reactKernel(state, context).pipe(Effect.provide(layer)));

    expect(next.status).toBe("acting");
    const pending = next.meta.pendingNativeToolCalls as Array<{ name: string; arguments: unknown }>;
    expect(pending).toHaveLength(1);
    // Name must heal to the REGISTERED name despite a snake_case quirk.
    expect(pending[0]!.name).toBe("web-search");
    // Args must be a parsed object despite a stringified-args quirk — never a
    // raw string and never dropped to {}.
    expect(pending[0]!.arguments).toEqual({ query: "hello world" });
  });
});

// think-leak affects the final ANSWER, not the tool call: a <think> block must
// be stripped so it never ships in the user-facing output.
const ANSWER_QUIRKS: (ProviderQuirk | undefined)[] = [undefined, "think-leak"];

describe.each(ANSWER_QUIRKS)("react kernel ships a clean final answer under provider quirk: %s", (quirk) => {
  it("does not leak a <think> block into the output", async () => {
    const layer = TestLLMServiceLayer([{ match: "Task:", text: "FINAL ANSWER: The capital is Paris." }], quirk);

    const result = await Effect.runPromise(
      executeReActKernel({ task: "What is the capital of France?", maxIterations: 3 }).pipe(Effect.provide(layer)),
    );

    expect(result.terminatedBy).toBe("final_answer");
    expect(result.output).toContain("Paris");
    expect(result.output).not.toContain("<think>");
    expect(result.output).not.toContain("reason about this step by step");
  });
});
