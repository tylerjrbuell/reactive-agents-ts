// Run: bun test packages/reasoning/tests/strategies/code-action-approval-scope.test.ts --timeout 15000
//
// Audit G6 (2026-11-18): code-action refused any approval policy with a
// non-empty tool list. The runtime folds every registered `requiresApproval`
// tool into that list, so a run whose callable tools were all read-only still
// refused. code-action now refuses only when a tool its sandbox can call is
// gated, when command rules meet a callable shell tool, or when a
// `requireFor` predicate is set. The negative controls below are the security
// side: a gated tool the sandbox can call must still refuse before any model
// call, and a gated tool it cannot call must never execute.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import type { ToolService } from "@reactive-agents/tools";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import { executeCodeAction } from "../../src/strategies/code-action.js";
import { codeActionApprovalConflict } from "../../src/strategies/code-action/approval-scope.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope, buildRunEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import type { ResolvedApprovalPolicy } from "../../src/kernel/capabilities/act/approval-gate.js";

const PREFIX = "code-action cannot honor .withApprovalPolicy(";

const schema = (name: string) => ({
  name,
  description: `${name} tool`,
  parameters: [{ name: "query", type: "string", description: "query", required: true }],
});

const oneIteration = {
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: { ...defaultReasoningConfig.strategies.reactive, maxIterations: 1 },
  },
};

/** Calls the bound `search` tool and returns its result. */
const CODE_CALLING_SEARCH = "```typescript\n(async () => { return await search({ query: 'x' }); })()\n```";

function recordingToolLayer() {
  const executed: string[] = [];
  const layer = mockToolServiceLayer({
    execute: (req: { toolName: string }) =>
      Effect.sync(() => {
        executed.push(req.toolName);
        return { success: true, result: { ok: true } };
      }),
    getTool: (name: string) =>
      Effect.succeed({ name, description: "t", parameters: [{ name: "query", type: "string", required: true }] }),
    register: () => Effect.void,
    listTools: () => Effect.succeed([]),
    deregister: () => Effect.void,
  });
  return { layer: layer as Layer.Layer<ToolService>, executed };
}

const run = (opts: {
  readonly availableTools: readonly string[];
  readonly schemas: readonly ReturnType<typeof schema>[];
  readonly policy?: ResolvedApprovalPolicy;
}) => {
  const { layer, executed } = recordingToolLayer();
  const program = executeCodeAction({
    taskDescription: "search and finish",
    taskType: "simple",
    memoryContext: "",
    availableTools: opts.availableTools,
    availableToolSchemas: opts.schemas,
    config: oneIteration,
  }).pipe(Effect.provide(Layer.merge(TestLLMServiceLayer([{ text: CODE_CALLING_SEARCH }]), layer)));
  return Effect.runPromise(
    provideTestEnvelope(program, buildRunEnvelope(opts.policy ? { approvalPolicy: opts.policy } : {})),
  ).then((result) => ({ result, executed }));
};

const policy = (over: Partial<ResolvedApprovalPolicy> = {}): ResolvedApprovalPolicy => ({
  mode: "block",
  tools: new Set<string>(),
  ...over,
});

describe("codeActionApprovalConflict — pure predicate", () => {
  it("(f) no policy: runs", () => {
    expect(codeActionApprovalConflict({ callableTools: ["search"], policy: undefined }).refuse).toBe(false);
  });

  it("(f) empty policy: runs", () => {
    expect(codeActionApprovalConflict({ callableTools: ["search"], policy: policy() }).refuse).toBe(false);
  });

  it("(a) a gated tool the sandbox cannot call: runs", () => {
    const c = codeActionApprovalConflict({ callableTools: ["search"], policy: policy({ tools: new Set(["file-write"]) }) });
    expect(c).toEqual({ refuse: false, gatedCallable: [], requireFor: false });
  });

  it("(b) a callable gated tool: refuses and names it", () => {
    const c = codeActionApprovalConflict({
      callableTools: ["search", "file-write", "code-execute"],
      policy: policy({ tools: new Set(["file-write", "code-execute", "shell-execute"]) }),
    });
    expect(c).toEqual({ refuse: true, gatedCallable: ["code-execute", "file-write"], requireFor: false });
  });

  it("(c) a requireFor predicate refuses even with nothing callable gated", () => {
    const c = codeActionApprovalConflict({ callableTools: [], policy: policy({ requireFor: () => false }) });
    expect(c).toEqual({ refuse: true, gatedCallable: [], requireFor: true });
  });

  it("(d) a predicate that gates every call refuses, in both modes", () => {
    for (const mode of ["block", "detach"] as const) {
      const c = codeActionApprovalConflict({ callableTools: ["search"], policy: policy({ mode, requireFor: () => true }) });
      expect(c.refuse).toBe(true);
    }
  });

  it("(d) mode does not narrow a gated callable tool", () => {
    for (const mode of ["block", "detach"] as const) {
      const c = codeActionApprovalConflict({ callableTools: ["search"], policy: policy({ mode, tools: new Set(["search"]) }) });
      expect(c.refuse).toBe(true);
    }
  });

  it("command rules refuse when a shell tool is callable", () => {
    for (const shell of ["shell-execute", "git-cli", "gh-cli"]) {
      const c = codeActionApprovalConflict({ callableTools: ["search", shell], policy: policy({ commands: ["git push"] }) });
      expect(c).toEqual({ refuse: true, gatedCallable: [shell], requireFor: false });
    }
  });

  it("command rules alone run when no shell tool is callable", () => {
    const c = codeActionApprovalConflict({ callableTools: ["search"], policy: policy({ commands: ["git push"] }) });
    expect(c.refuse).toBe(false);
  });
});

describe("code-action — approval scope in the strategy", () => {
  it("(a) gated tool registered but not callable: the run proceeds and the gated tool never runs", async () => {
    const { result, executed } = await run({
      availableTools: ["search"],
      schemas: [schema("search")],
      policy: policy({ mode: "detach", tools: new Set(["file-write"]) }),
    });
    expect(result.error ?? "").not.toContain(PREFIX);
    expect(result.metadata.llmCalls ?? 0).toBeGreaterThan(0);
    expect(executed).toEqual(["search"]);
    expect(result.status).toBe("completed");
  }, 15000);

  it("(b) a callable tool is gated: refuses before any model call or tool, naming the tool", async () => {
    const { result, executed } = await run({
      availableTools: ["search"],
      schemas: [schema("search")],
      policy: policy({ mode: "detach", tools: new Set(["search", "file-write"]) }),
    });
    expect(result.status).toBe("failed");
    expect(result.error ?? "").toContain(`${PREFIX}{ mode: "detach" }): it can call gated tool(s) search,`);
    expect(result.error ?? "").toContain("past the approval gate");
    expect(result.error ?? "").not.toContain("file-write");
    expect(result.metadata.llmCalls ?? 0).toBe(0);
    expect(executed).toEqual([]);
  }, 15000);

  it("(c) requireFor set: refuses before any model call", async () => {
    const { result, executed } = await run({
      availableTools: ["search"],
      schemas: [schema("search")],
      policy: policy({ requireFor: () => false }),
    });
    expect(result.error ?? "").toContain(PREFIX);
    expect(result.error ?? "").toContain("requireFor");
    expect(result.metadata.llmCalls ?? 0).toBe(0);
    expect(executed).toEqual([]);
  }, 15000);

  it("(e) callable = what the sandbox binds: a gated schema outside availableTools still refuses", async () => {
    const { result, executed } = await run({
      availableTools: [],
      schemas: [schema("search")],
      policy: policy({ tools: new Set(["search"]) }),
    });
    expect(result.error ?? "").toContain(`${PREFIX}{ mode: "block" }): it can call gated tool(s) search,`);
    expect(executed).toEqual([]);
  }, 15000);

  it("(e) a gated name in availableTools with no schema has no handler: runs, and the tool never executes", async () => {
    const { result, executed } = await run({
      availableTools: ["search", "file-write"],
      schemas: [schema("search")],
      policy: policy({ tools: new Set(["file-write"]) }),
    });
    expect(result.error ?? "").not.toContain(PREFIX);
    expect(executed).not.toContain("file-write");
  }, 15000);

  it("(f) no policy: runs", async () => {
    const { result, executed } = await run({ availableTools: ["search"], schemas: [schema("search")] });
    expect(result.status).toBe("completed");
    expect(executed).toEqual(["search"]);
  }, 15000);
});
