import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import type { Task } from "@reactive-agents/core";
import {
  prepareReasoningToolSchemas,
  type ToolSchema,
} from "../engine/phases/agent-loop/setup/tool-schemas.js";
import {
  defaultReactiveAgentsConfig,
  type ReactiveAgentsConfig,
} from "../types.js";

/**
 * Stage-1 builtins opt-in filter — classifier-relevant rescue (2026-07-10).
 *
 * Regression (trace 01KX6KY8ANMXC1BSQ1SNJN3DAP, gpt-4o): a task needing
 * "several individual web searches" had web-search classified as relevant,
 * but the builtins opt-in filter only rescued effectiveAllowedTools +
 * effectiveRequiredTools — stripping classifiedRelevantTools despite the
 * filter's documented contract ("Required + relevant + meta-tools are
 * unaffected"). The run died with the tool invisible in the LLM schema.
 *
 * Relevant built-ins must be VISIBLE (schema rescue only), never enforced.
 */

const schema = (name: string): ToolSchema => ({
  name,
  description: `${name} tool`,
  parameters: [],
});

// Builtins NOT opted in — the filter under test is active.
const config: ReactiveAgentsConfig = defaultReactiveAgentsConfig("test-agent", {});

// prepareReasoningToolSchemas only reads `task.input` (via extractTaskText).
const task = { input: "research the show with several web searches" } as Task;

const runPrepare = (
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

describe("prepareReasoningToolSchemas — classifier-relevant built-ins survive the opt-in filter", () => {
  it("keeps a classifier-relevant built-in visible when builtins are not opted in", async () => {
    const prepared = await runPrepare(
      [schema("web-search"), schema("file-write"), schema("custom-thing")],
      { classifiedRelevantTools: ["web-search"] },
    );
    expect(prepared.availableToolNames).toContain("web-search");
    expect(prepared.availableToolSchemas.map((s) => s.name)).toContain(
      "web-search",
    );
    // Non-builtin custom tools are never touched by this filter.
    expect(prepared.availableToolNames).toContain("custom-thing");
  });

  it("still strips a built-in that is neither required, allowed, nor relevant", async () => {
    const prepared = await runPrepare(
      [schema("web-search"), schema("file-write"), schema("custom-thing")],
      { classifiedRelevantTools: ["web-search"] },
    );
    // file-write is a built-in with no rescue path → stripped (2026-05-06
    // rationale preserved: no gratuitous filesystem writes).
    expect(prepared.availableToolNames).not.toContain("file-write");
    expect(prepared.availableToolSchemas.map((s) => s.name)).not.toContain(
      "file-write",
    );
  });

  it("strips all built-ins when classification produced nothing (filter still works)", async () => {
    const prepared = await runPrepare(
      [schema("web-search"), schema("file-write"), schema("custom-thing")],
      { classifiedRelevantTools: undefined },
    );
    expect(prepared.availableToolNames).not.toContain("web-search");
    expect(prepared.availableToolNames).not.toContain("file-write");
    expect(prepared.availableToolNames).toContain("custom-thing");
  });

  it("relevant rescue is visibility-only — names/schemas stay in sync", async () => {
    const prepared = await runPrepare(
      [schema("web-search"), schema("file-write")],
      { classifiedRelevantTools: ["web-search"] },
    );
    expect(prepared.availableToolNames).toEqual(
      prepared.availableToolSchemas.map((s) => s.name),
    );
  });
});
