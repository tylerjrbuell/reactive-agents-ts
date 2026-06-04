import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import type { TaskContract } from "@reactive-agents/core";
import {
  contractForbiddenTools,
  mergeContractRequiredTools,
} from "../builder/contract-tool-set.js";
import {
  prepareReasoningToolSchemas,
  type ToolSchema,
} from "../engine/phases/agent-loop/setup/tool-schemas.js";
import { ReactiveAgents } from "../builder.js";
import { asBuilderState } from "./_helpers.js";
import {
  defaultReactiveAgentsConfig,
  type ReactiveAgentsConfig,
} from "../types.js";
import type { Task } from "@reactive-agents/core";

/**
 * Realization-plan P2b part 2 (forbidden-half, schema-exclusion mechanism).
 *
 * `task-contract.ts:33-34` DEFINES `kind === "forbidden"` as "MUST NOT be
 * visible to the LLM". The runtime enforces this by EXCLUDING those names from
 * the execute-time exposed tool schema in `prepareReasoningToolSchemas`, which
 * runs AFTER MCP/discover-tools discovery (its `availableToolSchemas` input is
 * the post-discovery registry snapshot). This closes the static-approximation
 * hole P2's build-time check could not see (MCP/discovered tools).
 *
 * `contractForbiddenTools` is the pure derivation helper (sibling to
 * `mergeContractRequiredTools`); the exclusion filter in
 * `prepareReasoningToolSchemas` is its live consumer (§4.4 — no dead field).
 */

const successOracle = { type: "regex" as const, pattern: "ok" };

const schema = (name: string): ToolSchema => ({
  name,
  description: `${name} tool`,
  parameters: [],
});

const baseConfig = (
  forbiddenTools: readonly string[] | undefined,
): ReactiveAgentsConfig =>
  defaultReactiveAgentsConfig("test-agent", {
    // Opt all builtins into the base schema so the builtins-opt-in filter
    // does not remove our builtin fixtures for an unrelated reason —
    // isolating the forbidden-exclusion behavior under test.
    builtins: true,
    forbiddenTools,
  });

// prepareReasoningToolSchemas only reads `task.input` (via extractTaskText);
// a minimal shape is sufficient. Single `as Task` keeps the fixture honest
// without an `as unknown as` double-cast.
const task = { input: "do the thing" } as Task;

const runPrepare = (
  config: ReactiveAgentsConfig,
  schemas: ToolSchema[],
  overrides: Partial<Parameters<typeof prepareReasoningToolSchemas>[0]> = {},
) =>
  Effect.runPromise(
    prepareReasoningToolSchemas({
      config,
      task,
      availableToolSchemas: schemas,
      availableToolNames: schemas.map((s) => s.name),
      effectiveAllowedTools: [],
      effectiveFocusedTools: [],
      effectiveRequiredTools: undefined,
      classifiedRelevantTools: undefined,
      resolvedCalibration: undefined,
      obs: null,
      isNormal: false,
      ...overrides,
    }),
  );

describe("contractForbiddenTools — derives forbidden names from a contract", () => {
  it("returns only kind === 'forbidden' tool names", () => {
    const contract: TaskContract = {
      prompt: "x",
      tools: [
        { kind: "required", name: "file-read" },
        { kind: "available", name: "find" },
        { kind: "forbidden", name: "shell-execute" },
        { kind: "forbidden", name: "web-search" },
      ],
      success: successOracle,
    };
    expect(contractForbiddenTools(contract)).toEqual(
      expect.arrayContaining(["shell-execute", "web-search"]),
    );
    expect(contractForbiddenTools(contract)).not.toContain("file-read");
    expect(contractForbiddenTools(contract)).not.toContain("find");
  });

  it("returns an empty array for no contract or no forbidden tools", () => {
    expect(contractForbiddenTools(undefined)).toEqual([]);
    expect(
      contractForbiddenTools({
        prompt: "x",
        tools: [{ kind: "required", name: "file-read" }],
        success: successOracle,
      }),
    ).toEqual([]);
  });

  it("does not duplicate the required-half (still ignores forbidden for required)", () => {
    const contract: TaskContract = {
      prompt: "x",
      tools: [{ kind: "forbidden", name: "shell-execute" }],
      success: successOracle,
    };
    const required = mergeContractRequiredTools(undefined, contract, false, false);
    expect(required?.tools ?? []).not.toContain("shell-execute");
  });
});

describe("prepareReasoningToolSchemas — forbidden tools excluded from exposed schema", () => {
  it("removes a forbidden tool from BOTH schemas and names", async () => {
    const config = baseConfig(["web-search"]);
    const prepared = await runPrepare(config, [
      schema("file-read"),
      schema("web-search"),
      schema("custom-thing"),
    ]);
    expect(prepared.availableToolNames).not.toContain("web-search");
    expect(prepared.availableToolSchemas.map((s) => s.name)).not.toContain(
      "web-search",
    );
    // non-forbidden custom tools survive
    expect(prepared.availableToolNames).toContain("file-read");
    expect(prepared.availableToolNames).toContain("custom-thing");
  });

  it("excludes a discovered/MCP-style forbidden tool (origin-agnostic — input is post-discovery snapshot)", async () => {
    const config = baseConfig(["mcp__github__create_issue"]);
    const prepared = await runPrepare(config, [
      schema("file-read"),
      schema("mcp__github__create_issue"),
    ]);
    expect(prepared.availableToolNames).not.toContain(
      "mcp__github__create_issue",
    );
    expect(prepared.availableToolSchemas.map((s) => s.name)).not.toContain(
      "mcp__github__create_issue",
    );
  });

  it("forbidden wins over the adaptive ALWAYS_INCLUDE / required re-additions", async () => {
    // adaptive block force-adds required + ALWAYS_INCLUDE; forbidden must still win.
    const config: ReactiveAgentsConfig = {
      ...baseConfig(["find"]),
      adaptiveToolFiltering: true,
    };
    const many = Array.from({ length: 14 }, (_, i) => schema(`tool-${i}`));
    const prepared = await runPrepare(
      config,
      [...many, schema("find"), schema("file-read")],
      {
        effectiveRequiredTools: ["find"],
        classifiedRelevantTools: ["file-read"],
      },
    );
    // "find" is both required AND in ALWAYS_INCLUDE, yet forbidden → absent.
    expect(prepared.availableToolNames).not.toContain("find");
    expect(prepared.availableToolSchemas.map((s) => s.name)).not.toContain(
      "find",
    );
  });

  it("no-op when forbiddenTools is empty/undefined", async () => {
    const prepared = await runPrepare(baseConfig(undefined), [
      schema("file-read"),
      schema("web-search"),
    ]);
    expect(prepared.availableToolNames).toContain("web-search");
    expect(prepared.availableToolNames).toContain("file-read");
  });
});

describe("withContract — forbidden tools bind to the construction-read state", () => {
  it(".withContract({forbidden}) stores _taskContract on the SAME view runtime-construction.ts reads", () => {
    // `runtime-construction.ts` reads builder state via the
    // `BuilderRuntimeStateView` and passes `_taskContract` into
    // `contractForbiddenTools(state._taskContract)` at the `forbiddenTools:`
    // config-assembly site (beside allowedTools/focusedTools). `asBuilderState`
    // widens to a SUPERSET of that view, so a passing assertion here proves the
    // helper receives this contract at run time. `config.forbiddenTools` then
    // reaches the engine unmodified (intersection-only field, like
    // allowedTools/focusedTools — no Schema decode strips it on the
    // construction→engine path), where `prepareReasoningToolSchemas` reads it
    // and excludes the names from the exposed schema (proven by the suite
    // above). This mirrors the required-half's binding test
    // (contract-required-tools-execute.test.ts) at the same seam boundary.
    const contract: TaskContract = {
      prompt: "do the thing",
      tools: [{ kind: "forbidden", name: "shell-execute" }],
      success: successOracle,
    };
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withReasoning()
      .withTools({ builtins: true })
      .withContract(contract);
    const state = asBuilderState(builder);
    expect(state._taskContract).toBeDefined();
    expect(state._taskContract?.tools).toEqual(contract.tools);

    // Spot-prove the exact derivation the construction site performs lands
    // shell-execute in the forbiddenTools config the engine reads.
    expect(contractForbiddenTools(state._taskContract)).toContain(
      "shell-execute",
    );
  });
});
