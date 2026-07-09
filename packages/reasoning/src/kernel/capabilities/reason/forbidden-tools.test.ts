// Run: bun test packages/reasoning/src/kernel/capabilities/reason/forbidden-tools.test.ts
//
// P0 (wiring audit 2026-07-09). `packages/core/src/contracts/task-contract.ts:33`
// documents a HARD guarantee for a declared `forbidden` tool:
//
//     "the tool MUST NOT be visible to the LLM"
//
// Before this fix, `compileRunContract` pushed a `{kind:"forbidden-tool"}` entry
// onto `RunContract.constraints` and NOTHING read it — `constraints` had zero
// non-test readers and `tool-surface.ts` had no deny filter. A user calling
// `.withContract({tools:[{kind:"forbidden", name:"shell-execute"}]})` got silent
// non-enforcement: the tool stayed visible and callable.
//
// Two layers are pinned here, deliberately:
//   1. The RESOLVER invariant (pure): a forbidden tool is absent from `universe`,
//      `visible` and `callable` — even when it is simultaneously required,
//      allowed, or a META tool. Deny beats every floor. `universe` matters
//      because the tool-call resolver heals model-named calls against it: a
//      hallucinated forbidden name must not resolve back into an executable call.
//   2. The WIRING (drives real `handleThinking` against a stub LLM): the deny
//      list actually reaches the resolver from `state.meta.runContract`. Test (1)
//      alone would still pass if think.ts never passed `forbiddenTools` — which
//      is exactly the class of gap this audit was about. Cutting the wiring
//      fails test (2).

import { describe, expect, it } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import fc from "fast-check";
import { LLMService, type StreamEvent } from "@reactive-agents/llm-provider";
import { NativeFCDriver } from "@reactive-agents/tools";
import { resolveToolSurface, type ToolSurfaceInputs } from "./tool-surface.js";
import { handleThinking } from "./think.js";
import { compileRunContract, forbiddenTools } from "../../contract/run-contract.js";
import {
  initialKernelState,
  noopHooks,
  type KernelContext,
  type KernelInput,
  type KernelState,
} from "../../state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../context/context-profile.js";
import type { ToolSchema } from "../attend/tool-formatting.js";
import { META_TOOLS } from "../../state/kernel-constants.js";

const schema = (name: string): ToolSchema =>
  ({ name, description: `${name} tool`, parameters: [] }) as ToolSchema;

const FINAL_ANSWER = schema("final-answer");

const baseInputs = (over: Partial<ToolSurfaceInputs> = {}): ToolSurfaceInputs => ({
  augmented: [schema("web-search"), schema("shell-execute"), FINAL_ANSWER],
  finalAnswerSchema: FINAL_ANSWER,
  lazyMode: false,
  pressureCritical: false,
  hasClassification: false,
  requiredTools: [],
  relevantTools: [],
  allowedTools: [],
  toolsUsed: [],
  discovered: [],
  gateBlockedTools: [],
  missingRequiredTools: [],
  pruneMinTools: 0,
  ...over,
});

const names = (xs: readonly ToolSchema[]) => xs.map((t) => t.name);

// ─── Layer 1: the resolver invariant ─────────────────────────────────────────

describe("forbidden tools — hard deny beats every visibility floor", () => {
  it("a forbidden tool is absent from universe, visible AND callable", () => {
    const s = resolveToolSurface(baseInputs({ forbiddenTools: ["shell-execute"] }));
    expect(names(s.universe)).not.toContain("shell-execute");
    expect(names(s.visible)).not.toContain("shell-execute");
    expect(names(s.callable)).not.toContain("shell-execute");
    // ...and the non-forbidden tool is untouched.
    expect(names(s.visible)).toContain("web-search");
  });

  it("deny WINS over the required floor (a required+forbidden tool stays hidden)", () => {
    const s = resolveToolSurface(
      baseInputs({ requiredTools: ["shell-execute"], forbiddenTools: ["shell-execute"] }),
    );
    expect(names(s.visible)).not.toContain("shell-execute");
    expect(names(s.callable)).not.toContain("shell-execute");
  });

  it("deny WINS over the allowed floor", () => {
    const s = resolveToolSurface(
      baseInputs({ allowedTools: ["shell-execute"], forbiddenTools: ["shell-execute"] }),
    );
    expect(names(s.visible)).not.toContain("shell-execute");
  });

  it("deny WINS over the META floor", () => {
    const meta = [...META_TOOLS][0] as string;
    const s = resolveToolSurface(
      baseInputs({
        augmented: [schema(meta), schema("web-search"), FINAL_ANSWER],
        forbiddenTools: [meta],
      }),
    );
    expect(names(s.visible)).not.toContain(meta);
    expect(names(s.callable)).not.toContain(meta);
  });

  it("deny survives the pressure-critical arm (universe is narrowed, not re-widened)", () => {
    const s = resolveToolSurface(
      baseInputs({ pressureCritical: true, lazyMode: false, forbiddenTools: ["final-answer"] }),
    );
    expect(names(s.universe)).not.toContain("final-answer");
  });

  it("reports an explicit hidden reason for a forbidden tool", () => {
    const s = resolveToolSurface(baseInputs({ forbiddenTools: ["shell-execute"] }));
    expect(s.reasons.get("shell-execute")).toContain("forbidden");
  });

  it("no forbidden list → surface is byte-identical (no behavior change by default)", () => {
    const withUndef = resolveToolSurface(baseInputs());
    const withEmpty = resolveToolSurface(baseInputs({ forbiddenTools: [] }));
    expect(names(withUndef.visible)).toEqual(names(withEmpty.visible));
    expect(names(withUndef.callable)).toEqual(names(withEmpty.callable));
    expect(names(withUndef.visible)).toContain("shell-execute");
  });

  it("PROPERTY: a forbidden tool never appears anywhere, for any other input combination", () => {
    const pool = ["web-search", "file-read", "shell-execute", "code-execute"];
    fc.assert(
      fc.property(
        fc.constantFrom(...pool),
        fc.uniqueArray(fc.constantFrom(...pool), { maxLength: 4 }),
        fc.uniqueArray(fc.constantFrom(...pool), { maxLength: 3 }),
        fc.uniqueArray(fc.constantFrom(...pool), { maxLength: 3 }),
        fc.boolean(),
        fc.boolean(),
        (banned, required, allowed, used, lazyMode, pressureCritical) => {
          const s = resolveToolSurface(
            baseInputs({
              augmented: [...pool.map(schema), FINAL_ANSWER],
              requiredTools: required,
              allowedTools: allowed,
              toolsUsed: used,
              lazyMode,
              pressureCritical,
              forbiddenTools: [banned],
            }),
          );
          return (
            !names(s.universe).includes(banned) &&
            !names(s.visible).includes(banned) &&
            !names(s.callable).includes(banned)
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── The contract → deny-list projection ─────────────────────────────────────

describe("forbiddenTools(contract)", () => {
  it("extracts declared forbidden tool names from the compiled contract", () => {
    const c = compileRunContract("do the thing", {
      taskContract: {
        tools: [
          { kind: "forbidden", name: "shell-execute" },
          { kind: "required", name: "web-search" },
        ],
      },
    } as never);
    expect(forbiddenTools(c)).toEqual(["shell-execute"]);
  });

  it("undefined contract → empty deny list", () => {
    expect(forbiddenTools(undefined)).toEqual([]);
  });
});

// ─── Layer 2: the WIRING (fails if think.ts stops passing the deny list) ─────

const cannedStreamEvents: readonly StreamEvent[] = [
  { type: "text_delta", text: "Thinking." },
  { type: "content_complete", content: "Thinking." },
  { type: "usage", usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12, estimatedCost: 0 } },
];

const stubLLM = Layer.succeed(LLMService, {
  complete: () =>
    Effect.succeed({
      content: "ok",
      stopReason: "end_turn",
      usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12, estimatedCost: 0 },
      model: "test-model",
    }) as never,
  stream: () => Effect.succeed(Stream.fromIterable(cannedStreamEvents) as never),
  completeStructured: () => Effect.succeed({ ok: true }) as never,
  embed: () => Effect.succeed([]),
  countTokens: () => Effect.succeed(0),
  getModelConfig: () => Effect.succeed({} as never),
  getStructuredOutputCapabilities: () => Effect.succeed({} as never),
  capabilities: () => Effect.succeed({} as never),
} as never);

/** Drive the REAL think phase and capture the system prompt handed to the model. */
const captureSystemPrompt = async (state: KernelState, input: KernelInput): Promise<string> => {
  let captured = "";
  const context: KernelContext = {
    input,
    profile: CONTEXT_PROFILES.local,
    compression: { budget: 800, previewItems: 5, autoStore: true, codeTransform: true },
    toolService: { _tag: "None" },
    hooks: {
      ...noopHooks,
      onThought: (_s: KernelState, _t: string, prompt?: { system: string }) => {
        captured = prompt?.system ?? "";
        return Effect.void;
      },
    },
    toolCallingDriver: new NativeFCDriver(),
    memoryService: { _tag: "None" },
  };
  await Effect.runPromise(handleThinking(state, context).pipe(Effect.provide(stubLLM)));
  return captured;
};

const stateWith = (contractTools?: readonly { kind: string; name: string }[]): KernelState => {
  const base = {
    ...initialKernelState({ strategy: "reactive", kernelType: "reactive", maxIterations: 8 }),
    messages: [{ role: "user" as const, content: "Delete the logs." }],
  };
  if (!contractTools) return base;
  const runContract = compileRunContract("Delete the logs.", {
    taskContract: { tools: contractTools },
  } as never);
  return { ...base, meta: { ...base.meta, runContract } };
};

const input: KernelInput = {
  task: "Delete the logs.",
  availableToolSchemas: [
    { name: "shell-execute", description: "Run a shell command.", parameters: [] },
    { name: "file-read", description: "Read a file.", parameters: [] },
  ],
};

describe("WIRING: a contract-declared forbidden tool never reaches the model", () => {
  it("without a contract, shell-execute IS offered (control)", async () => {
    const system = await captureSystemPrompt(stateWith(), input);
    expect(system).toContain("shell-execute");
  });

  it("P0: with `forbidden: shell-execute` declared, the prompt NEVER mentions it", async () => {
    const system = await captureSystemPrompt(
      stateWith([{ kind: "forbidden", name: "shell-execute" }]),
      input,
    );
    expect(system).not.toContain("shell-execute");
    // The sibling tool is unaffected — we denied one tool, not the surface.
    expect(system).toContain("file-read");
  });
});
