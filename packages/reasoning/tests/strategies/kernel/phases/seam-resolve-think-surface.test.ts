// Quality program Task 5 (seam seeds, GH #260): direct-import behavioral pin
// for the `resolveThinkToolSurface` stage extracted from think.ts (#219).
// The existing think-pressure-gate.test.ts pins the pure predicate
// (`shouldNarrowToFinalAnswerOnly`) via the think.ts re-export; nothing pinned
// the STAGE's composition — the subtlest rule in the file: pressure-narrowing
// must REFUSE to fire while required tools are still pending (narrowing to
// final-answer-only while the harness demands `web-search` is an unsatisfiable
// state, per the stage's own banner comment). Fixtures follow the typed
// thinking-channel-consumption.test.ts recipe (zero casts).

import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { resolveThinkToolSurface } from "../../../../src/kernel/capabilities/reason/resolve-think-surface.js";
import {
  noopHooks,
  type KernelContext,
  type KernelState,
} from "../../../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../../src/context/context-profile.js";
import { TextParseDriver } from "@reactive-agents/tools";

const WEB_SEARCH = {
  name: "web-search",
  description: "Search the web",
  parameters: { type: "object", properties: {} },
};

function makeState(overrides: Partial<KernelState> = {}): KernelState {
  const base: KernelState = {
    taskId: "seam-task",
    strategy: "reactive",
    kernelType: "react",
    steps: [],
    toolsUsed: new Set<string>(),
    scratchpad: new Map<string, string>(),
    iteration: 1,
    tokens: 63000, // 0.98 of mid's 64k window — past the 0.85 pressure threshold
    cost: 0,
    status: "thinking",
    output: null,
    error: null,
    llmCalls: 1,
    meta: { maxIterations: 10 },
    controllerDecisionLog: [],
    messages: [],
    ...overrides,
  };
  return base;
}

function makeContext(input: Partial<KernelContext["input"]> = {}): KernelContext {
  return {
    input: {
      task: "search the web for something",
      availableToolSchemas: [WEB_SEARCH],
      harness: { lazyDisclosure: false }, // non-lazy arm: pressure narrowing applies here
      ...input,
    },
    profile: CONTEXT_PROFILES["mid"],
    compression: {
      enabled: false,
      maxResultChars: 4000,
      previewLines: 10,
      arrayPreviewItems: 5,
    },
    toolService: { _tag: "None" },
    hooks: noopHooks,
    toolCallingDriver: new TextParseDriver(),
    memoryService: { _tag: "None" },
  };
}

function visibleNames(state: KernelState, context: KernelContext): Promise<string[]> {
  return Effect.runPromise(
    resolveThinkToolSurface({ state, context }).pipe(
      Effect.map((r) => r.toolSurface.visible.map((s) => s.name)),
    ),
  );
}

describe("resolveThinkToolSurface — pressure gate vs required-tools interplay", () => {
  it("REFUSES to narrow to final-answer-only while a required tool is still pending (pressure-critical state)", async () => {
    const names = await visibleNames(makeState(), makeContext({ requiredTools: ["web-search"] }));
    expect(names).toContain("web-search");
  });

  it("NARROWS to the clean-exit surface at pressure-critical token use when nothing is still required (contrast arm)", async () => {
    const names = await visibleNames(makeState(), makeContext({ requiredTools: [] }));
    expect(names).not.toContain("web-search");
  });
});
