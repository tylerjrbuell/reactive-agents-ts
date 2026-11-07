import { Effect, Ref } from "effect";
import {
  ToolService,
  briefTool,
  pulseTool,
  todoTool,
  activateSkillTool,
  recallTool,
  makeRecallHandler,
  relateTool,
  makeRelateHandler,
  findTool,
  makeFindHandler,
  checkpointTool,
  makeCheckpointHandler,
  discoverToolsTool,
  makeDiscoverToolsHandler,
  currentDiscoveredToolsStore,
  webSearchHandler,
} from "@reactive-agents/tools";
import type { KernelMetaToolsConfig } from "../../../types/kernel-meta-tools.js";
import { filterToolsByRelevance, type ToolSchema } from "../attend/tool-formatting.js";
import { META_TOOLS } from "../../state/kernel-constants.js";
import { hasActivatableSkills, type SkillsContext } from "../../state/skills-context.js";
import { emitErrorSwallowed, errorTag, AgentMemory } from "@reactive-agents/core";
import { resolveHarnessConfig, type ResolvedHarness } from "../../../harness-config.js";

type ToolCapabilitySnapshot = {
  readonly availableToolSchemas: readonly ToolSchema[];
  readonly allToolSchemas: readonly ToolSchema[];
};

function toToolSchema(definition: Pick<ToolSchema, "name" | "description" | "parameters">): ToolSchema {
  return {
    name: definition.name,
    description: definition.description,
    // Parameters pass through whole (no field picks), so `enum`, `items`,
    // `semantic`, ... reach the wire and the healing pipeline.
    parameters: definition.parameters,
    // Every caller of this helper appends a schema ONLY when the caller
    // explicitly opted in (`input.metaTools?.brief` etc.) — these are
    // genuinely user-configured, model-callable tools, not harness-internal
    // protocol tools. Without this, P2's native-FC wire filter
    // (think.ts:746, `ts.scope !== "harness" && !META_TOOL_SET.has(ts.name)`)
    // strips them unconditionally because `META_TOOLS` (kernel-constants.ts)
    // lists brief/pulse/todo/find/recall/checkpoint alongside the TRUE
    // protocol-only tools (final-answer, discover-tools) it was meant to
    // catch — silently dropping an explicitly-configured tool from the wire
    // regardless of `.withMetaTools()`.
    scope: "domain",
  };
}

function dedupeToolSchemas(schemas: readonly ToolSchema[]): readonly ToolSchema[] {
  const deduped = new Map<string, ToolSchema>();
  for (const schema of schemas) {
    deduped.set(schema.name, schema);
  }
  return [...deduped.values()];
}

/**
 * Task-relevant tool names for `discover-tools`, from the kernel's one
 * relevance scorer (`filterToolsByRelevance`) over the permitted catalog
 * minus META tools. Computed once, on the first discover-tools call. Without
 * it, discover-tools ranks only the model's query, so a task needing two
 * capabilities loaded only the one the query named (spike 2026-11-06).
 */
export function taskRelevantToolNames(
  task: string | undefined,
  catalog: readonly ToolSchema[],
): () => readonly string[] {
  let memo: readonly string[] | undefined;
  return () => {
    if (memo === undefined) {
      memo =
        task && task.trim() !== ""
          ? filterToolsByRelevance(task, catalog.filter((ts) => !META_TOOLS.has(ts.name))).primary.map((ts) => ts.name)
          : [];
    }
    return memo;
  };
}

export const resolveExecutableToolCapabilities = (input: {
  readonly availableToolSchemas?: readonly ToolSchema[];
  readonly allToolSchemas?: readonly ToolSchema[];
  readonly metaTools?: KernelMetaToolsConfig;
  /** Resolved harness config for this pass (`KernelInput.harness`, Task 3). */
  readonly harness?: ResolvedHarness;
  /** The run's task text; seeds discover-tools' task-relevant appendix. */
  readonly task?: string;
  /** The run's skills; `activate-skill` is offered when it holds any. */
  readonly skillsContext?: SkillsContext;
}): Effect.Effect<ToolCapabilitySnapshot, never> =>
  Effect.gen(function* () {
    const h = input.harness ?? resolveHarnessConfig();
    const available = [...(input.availableToolSchemas ?? [])];
    const all = [...(input.allToolSchemas ?? input.availableToolSchemas ?? [])];

    const append = (schema: ToolSchema): void => {
      available.push(schema);
      all.push(schema);
    };

    if (input.metaTools?.brief) append(toToolSchema(briefTool));
    if (input.metaTools?.pulse) append(toToolSchema(pulseTool));
    if (input.metaTools?.todo) append(toToolSchema(todoTool));
    // Skills spec step 4: offered only when the run has skills to load, so a
    // run without skills keeps a byte-identical tool array. Appended once at
    // run start with a static schema: activation never changes the array.
    if (hasActivatableSkills(input.skillsContext)) append(toToolSchema(activateSkillTool));

    const toolServiceOpt = yield* Effect.serviceOption(ToolService);
    if (toolServiceOpt._tag === "Some") {
      const toolService = toolServiceOpt.value;

      // Reset discovered-set at the start of each run (idempotent across
      // re-resolutions; the kernel calls resolveExecutableToolCapabilities
      // once per run). Fixed 2026-08-19: this used to live inside the
      // `h.toolDiscovery` branch below, so a run with
      // RA_TOOL_DISCOVERY=0 never reset it — a PRIOR run's discovered set
      // (in the same process) leaked forward and widened tool-surface.ts's
      // visibility floor for every later discovery-off run. `discovered` is
      // consumed unconditionally by tool-surface.ts regardless of whether
      // discover-tools itself is registered (it also backs the lightweight
      // tool-index, RA_TOOL_INDEX), so the reset must be unconditional too.
      // The set is run-scoped (tools `runToolStoresSlot`, bound fresh per run
      // by the run scope): inside a run this clears an already-fresh store;
      // for callers outside any run scope (direct kernel use, tests) it still
      // keeps the slot's process fallback from leaking.
      yield* Ref.set(yield* currentDiscoveredToolsStore, new Set<string>());

      // Stateful meta-tool handlers below are registered WITHOUT a captured
      // store: each invocation resolves the current run's store from the
      // `runToolStoresSlot` run slot, so isolation comes from the run scope.
      if (input.metaTools?.recall) {
        yield* toolService
          .register(recallTool, makeRecallHandler(undefined, input.metaTools.recallConfig))
          .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/capabilities/act/tool-capabilities.ts:79", tag: errorTag(err) })));
        append(toToolSchema(recallTool));
      }

      // Resolved once, shared by `relate` (getRelated/link) and `find`
      // (search) below — all are optional AgentMemory port methods, only
      // present when a graph/search-capable memory adapter (e.g.
      // `.withMemory()`'s Zettelkasten-backed one) is actually wired.
      const agentMemoryOpt = yield* Effect.serviceOption(AgentMemory);

      // `relate` — only registered when BOTH the caller opted in AND a
      // memory adapter implementing `getRelated` is actually present.
      // Requesting it with no such adapter is silently a no-op (matches
      // find's webFallback precedent) — not an error, since the caller may
      // share a builder config across agents where memory is optional.
      // `link` (mode "link", writing a relationship) is independently
      // optional — passed through when present, undefined otherwise, so
      // `relate`'s own handler decides how to respond to a link request
      // an adapter doesn't support.
      if (input.metaTools?.relate) {
        if (agentMemoryOpt._tag === "Some" && agentMemoryOpt.value.getRelated) {
          const getRelated = agentMemoryOpt.value.getRelated;
          const link = agentMemoryOpt.value.link;
          yield* toolService
            .register(relateTool, makeRelateHandler({ getRelated, link }))
            .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/capabilities/act/tool-capabilities.ts:relate", tag: errorTag(err) })));
          append(toToolSchema(relateTool));
        }
      }

      if (input.metaTools?.find) {
        const searchMemory =
          agentMemoryOpt._tag === "Some" && agentMemoryOpt.value.search
            ? agentMemoryOpt.value.search
            : undefined;
        // No `ragStore` passed: find resolves the run's document store from
        // `documentStoreSlot` run slot at call time (bound per agent by the
        // run scope), so documents stay per agent by default. An
        // explicit store here would win and pin every agent to one store.
        yield* toolService
          .register(
            findTool,
            makeFindHandler({
              webSearchHandler,
              searchMemory,
              config: {},
            }),
          )
          .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/capabilities/act/tool-capabilities.ts:94", tag: errorTag(err) })));
        append(toToolSchema(findTool));
      }

      if (input.metaTools?.checkpoint) {
        yield* toolService
          .register(checkpointTool, makeCheckpointHandler())
          .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/capabilities/act/tool-capabilities.ts:101", tag: errorTag(err) })));
        append(toToolSchema(checkpointTool));
      }

      // Lazy-tool-disclosure escape hatch. When the agent's visible schema is
      // pruned (required + relevant + meta-tools), `discover-tools` lets the
      // model surface anything else it needs at runtime. Schemas already carry
      // name/description/parameters — pass them straight through.
      // Default-on as of 2026-04-26 (curator empirical validation —
      // wiki/Research/Harness-Reports/bare-vs-harness-curation-2026-04-26.md). Opt out via
      // RA_LAZY_TOOLS=0 for backward compatibility while downstream agents
      // adapt.
      if (h.toolDiscovery) {
        const catalog = input.allToolSchemas ?? [];
        yield* toolService
          .register(
            discoverToolsTool,
            makeDiscoverToolsHandler({
              getAllToolDefinitions: () => catalog,
              getTaskRelevantTools: taskRelevantToolNames(input.task, catalog),
            }),
          )
          .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/capabilities/act/tool-capabilities.ts:discover-tools", tag: errorTag(err) })));
        append(toToolSchema(discoverToolsTool));
      }
    }

    return {
      availableToolSchemas: dedupeToolSchemas(available),
      allToolSchemas: dedupeToolSchemas(all),
    };
  });