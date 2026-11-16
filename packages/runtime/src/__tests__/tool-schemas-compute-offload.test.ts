import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import type { Task } from "@reactive-agents/core";
import {
  prepareReasoningToolSchemas,
  type ToolSchema,
} from "../engine/phases/agent-loop/setup/tool-schemas.js";
import { defaultReactiveAgentsConfig, type ReactiveAgentsConfig } from "../types.js";

/**
 * computeOffload (harness switch, default OFF) lifts `code-execute` past the
 * builtins opt-in filter for aggregation tasks. Spike 2026-11-15.
 */

const schema = (name: string): ToolSchema => ({ name, description: `${name} tool`, parameters: [] });
const registry = [schema("code-execute"), schema("file-read"), schema("final-answer")];

const AGG = { input: "Read sales.csv and report the total of the amount column." } as Task;
const PLAIN = { input: "Summarise the plot of the movie." } as Task;

const cfg = (computeOffload: boolean | undefined, extra: Partial<ReactiveAgentsConfig> = {}): ReactiveAgentsConfig => ({
  ...defaultReactiveAgentsConfig("test-agent", {}),
  ...(computeOffload === undefined ? {} : { reasoningOptions: { harness: { computeOffload } } }),
  ...extra,
});

const run = (
  config: ReactiveAgentsConfig,
  task: Task,
  effectiveAllowedTools: readonly string[] = [],
) =>
  Effect.runPromise(
    prepareReasoningToolSchemas({
      config,
      task,
      availableToolSchemas: registry,
      availableToolNames: registry.map((s) => s.name),
      effectiveAllowedTools,
      effectiveFocusedTools: [],
      effectiveRequiredTools: undefined,
      classifiedRelevantTools: undefined,
      resolvedCalibration: undefined,
      obs: null,
      isNormal: false,
    }),
  );

const names = (xs: readonly ToolSchema[]) => xs.map((s) => s.name);

describe("computeOffload tool-schema opt-in", () => {
  it("flag on + aggregation task: code-execute reaches available and exposed schemas", async () => {
    const out = await run(cfg(true), AGG);
    expect(names(out.availableToolSchemas)).toContain("code-execute");
    expect(names(out.exposedToolSchemas)).toContain("code-execute");
  });

  it("flag off: code-execute stays filtered (unchanged)", async () => {
    const out = await run(cfg(undefined), AGG);
    expect(names(out.availableToolSchemas)).not.toContain("code-execute");
    expect(names(out.exposedToolSchemas)).not.toContain("code-execute");
  });

  it("flag on + non-aggregation task: not added", async () => {
    const out = await run(cfg(true), PLAIN);
    expect(names(out.availableToolSchemas)).not.toContain("code-execute");
  });

  it("flag on + explicit allowedTools omitting code-execute: stays filtered", async () => {
    const out = await run(cfg(true), AGG, ["file-read"]);
    expect(names(out.availableToolSchemas)).not.toContain("code-execute");
    expect(names(out.exposedToolSchemas)).not.toContain("code-execute");
  });

  it("flag on + forbidden code-execute: forbidden wins", async () => {
    const out = await run(cfg(true, { forbiddenTools: ["code-execute"] }), AGG);
    expect(names(out.availableToolSchemas)).not.toContain("code-execute");
    expect(names(out.exposedToolSchemas)).not.toContain("code-execute");
  });
});
