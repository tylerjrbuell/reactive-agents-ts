/**
 * shared/service-utils.ts — Effect-TS service resolution utilities.
 *
 * Eliminates the identical ~20-line service acquisition block found at the
 * top of every strategy file, and the copy-pasted `compilePromptOrFallback`
 * and EventBus publish boilerplate.
 */
import { Context, Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { ToolService } from "@reactive-agents/tools";
import { EventBus, EntropySensorService } from "@reactive-agents/core";
import { MemoryService } from "@reactive-agents/memory";

// ── Narrow types — shared types from kernel-state, prompt type local ─────────

import type {
  MaybeService,
  ToolServiceInstance,
  EventBusInstance,
  MemoryServiceInstance,
} from "../state/kernel-state.js";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";

/** Minimal PromptService surface used by strategies */
type PromptServiceInstance = {
  readonly compile: (
    id: string,
    vars: Record<string, unknown>,
    options?: { tier?: string },
  ) => Effect.Effect<{ content: string }, unknown>;
};

/** Local tag for PromptService to avoid coupling with @reactive-agents/prompts */
class PromptServiceTag extends Context.Tag("PromptService")<
  PromptServiceTag,
  PromptServiceInstance
>() {}

/** Narrow EntropySensorService surface used by kernel runner */
type EntropySensorInstance = EntropySensorService["Type"];

/** Narrow ReactiveControllerService surface — resolved via GenericTag to avoid
 *  depending on @reactive-agents/reactive-intelligence from the reasoning package. */
type ReactiveControllerInstance = {
  readonly evaluate: (params: {
    readonly entropyHistory: readonly {
      readonly composite: number;
      readonly trajectory: { readonly shape: string; readonly derivative: number; readonly momentum: number };
    }[];
    readonly iteration: number;
    readonly maxIterations: number;
    readonly strategy: string;
    readonly calibration: {
      readonly highEntropyThreshold: number;
      readonly convergenceThreshold: number;
      readonly calibrated: boolean;
      readonly sampleCount: number;
    };
    readonly config: {
      readonly earlyStop: boolean;
      readonly contextCompression: boolean;
      readonly strategySwitch: boolean;
    };
    readonly contextPressure: number;
    readonly behavioralLoopScore: number;
    // Optional params for living-intelligence evaluators
    readonly currentTemperature?: number;
    readonly availableToolNames?: readonly string[];
    readonly priorDecisionsThisRun?: readonly string[];
    readonly consecutiveToolFailures?: number;
    readonly failingToolName?: string;
  }) => Effect.Effect<readonly { readonly decision: string; readonly reason: string }[]>;
};

/** GenericTag for ReactiveControllerService — avoids cross-package dependency */
const ReactiveControllerTag = Context.GenericTag<ReactiveControllerInstance>("ReactiveControllerService");

/** Narrow InterventionDispatcherService surface — structural type to avoid
 *  depending on @reactive-agents/reactive-intelligence from the reasoning package. */
type DispatcherInstance = {
  readonly dispatch: (
    decisions: readonly { readonly decision: string; readonly reason: string }[],
    state: Readonly<Record<string, unknown>>,
    context: {
      readonly iteration: number;
      readonly entropyScore: {
        readonly composite: number;
        readonly token: number;
        readonly structural: number;
        readonly semantic: number;
        readonly behavioral: number;
        readonly contextPressure: number;
      };
      readonly recentDecisions: readonly { readonly decision: string; readonly reason: string }[];
      readonly budget: {
        readonly tokensSpentOnInterventions: number;
        readonly interventionsFiredThisRun: number;
      };
      readonly adaptiveMinEntropy?: number;
    },
  ) => Effect.Effect<{
    readonly appliedPatches: readonly { readonly kind: string; readonly [k: string]: unknown }[];
    readonly skipped: readonly { decisionType: string; reason: string }[];
    readonly totalCost: { tokens: number; latencyMs: number };
  }>;
};

/** GenericTag for InterventionDispatcherService — avoids cross-package dependency */
const InterventionDispatcherTag = Context.GenericTag<DispatcherInstance>("InterventionDispatcherService");

// ── Resolved services bundle ──────────────────────────────────────────────────

export type StrategyServices = {
  /** LLM service instance (always present — required dependency) */
  llm: LLMService["Type"];
  /** Tool service — None when no tools are registered */
  toolService: MaybeService<ToolServiceInstance>;
  /** Prompt template service — None when prompts layer is absent */
  promptService: MaybeService<PromptServiceInstance>;
  /** EventBus — None when observability layer is absent */
  eventBus: MaybeService<EventBusInstance>;
  /** Entropy sensor — None when reactive intelligence layer is absent */
  entropySensor: MaybeService<EntropySensorInstance>;
  /** Reactive controller — None when reactive intelligence controller is absent */
  reactiveController: MaybeService<ReactiveControllerInstance>;
  /** Intervention dispatcher — None when reactive intelligence controller is absent */
  dispatcher: MaybeService<DispatcherInstance>;
  /** Memory service — None when memory layer is absent. Used by tool-execution
   *  to populate semantic memory from successful tool results (fire-and-forget
   *  via Effect.forkDaemon — does not block the kernel hot path). */
  memoryService: MaybeService<MemoryServiceInstance>;
};

/**
 * Resolve all optional services needed by reasoning strategies in one Effect call.
 *
 * Replaces the identical service acquisition block that appears in every strategy:
 * ```typescript
 * const llm = yield* LLMService;
 * const promptServiceOptRaw = yield* Effect.serviceOption(PromptService).pipe(
 *   Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
 * );
 * const ebOptRaw = yield* Effect.serviceOption(EventBus).pipe(
 *   Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
 * );
 * ```
 */
export const resolveStrategyServices: Effect.Effect<
  StrategyServices,
  never,
  LLMService
> = Effect.gen(function* () {
  const llm = yield* LLMService;

  const toolServiceOptRaw = yield* Effect.serviceOption(ToolService);
  const toolService = toolServiceOptRaw as MaybeService<ToolServiceInstance>;

  const promptServiceOptRaw = yield* Effect.serviceOption(PromptServiceTag).pipe(
    Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
  );
  const promptService = promptServiceOptRaw as MaybeService<PromptServiceInstance>;

  const ebOptRaw = yield* Effect.serviceOption(EventBus).pipe(
    Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
  );
  const eventBus = ebOptRaw as MaybeService<EventBusInstance>;

  const entropySensorOptRaw = yield* Effect.serviceOption(EntropySensorService).pipe(
    Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
  );
  const entropySensor = entropySensorOptRaw as MaybeService<EntropySensorInstance>;

  const reactiveControllerOptRaw = yield* Effect.serviceOption(ReactiveControllerTag).pipe(
    Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
  );
  const reactiveController = reactiveControllerOptRaw as MaybeService<ReactiveControllerInstance>;

  const dispatcherOptRaw = yield* Effect.serviceOption(InterventionDispatcherTag).pipe(
    Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
  );
  const dispatcher = dispatcherOptRaw as MaybeService<DispatcherInstance>;

  const memoryServiceOptRaw = yield* Effect.serviceOption(MemoryService).pipe(
    Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
  );
  const memoryService = memoryServiceOptRaw as MaybeService<MemoryServiceInstance>;

  return {
    llm,
    toolService,
    promptService,
    eventBus,
    entropySensor,
    reactiveController,
    dispatcher,
    memoryService,
  };
});

/**
 * Compile a prompt template with fallback to a hardcoded string.
 *
 * Replaces the identical `compilePromptOrFallback()` defined in all 5 strategy files.
 * The `tier` argument enables model-adaptive template resolution (e.g., `"local"` vs
 * `"frontier"`), matching the context-engineering sprint's prompt variant system.
 */
export function compilePromptOrFallback(
  promptService: MaybeService<PromptServiceInstance>,
  templateId: string,
  variables: Record<string, unknown>,
  fallback: string,
  tier?: string,
): Effect.Effect<string, never> {
  if (promptService._tag === "None") {
    return Effect.succeed(fallback);
  }
  return promptService.value
    .compile(templateId, variables, tier ? { tier } : undefined)
    .pipe(
      Effect.map((compiled) => compiled.content),
      Effect.catchAll(() => Effect.succeed(fallback)),
    );
}

/**
 * Publish a reasoning step event to EventBus if available.
 *
 * Replaces the repeated pattern:
 * ```typescript
 * if (eb._tag === "Some") {
 *   yield* eb.value.publish({ ... }).pipe(Effect.catchAll(() => Effect.void));
 * }
 * ```
 * This boilerplate appears 20+ times across the 5 strategy files.
 */
export function publishReasoningStep(
  eventBus: MaybeService<EventBusInstance>,
  payload: unknown,
): Effect.Effect<void, never> {
  if (eventBus._tag === "None") return Effect.void;
  return eventBus.value.publish(payload).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/utils/service-utils.ts:216", tag: errorTag(err) })));
}
