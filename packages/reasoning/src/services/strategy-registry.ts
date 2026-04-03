// File: src/services/strategy-registry.ts
import { Context, Effect, Layer, Ref } from "effect";
import type { ReasoningResult, ReasoningStrategy } from "../types/index.js";
import type { ReasoningConfig } from "../types/config.js";
import {
  StrategyNotFoundError,
  type ExecutionError,
  type IterationLimitError,
} from "../errors/errors.js";
import type { LLMService } from "@reactive-agents/llm-provider";
import type { ContextProfile } from "../context/context-profile.js";
import type { ToolSchema } from "../strategies/kernel/utils/tool-utils.js";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import type { ThoughtKernel } from "../strategies/kernel/kernel-state.js";
import { reactKernel } from "../strategies/kernel/react-kernel.js";
import { executeReactive } from "../strategies/reactive.js";
import { executeReflexion } from "../strategies/reflexion.js";
import { executePlanExecute } from "../strategies/plan-execute.js";
import { executeTreeOfThought } from "../strategies/tree-of-thought.js";
import { executeAdaptive } from "../strategies/adaptive.js";
import type { KernelMetaToolsConfig } from "../types/kernel-meta-tools.js";

// ─── Strategy function type ───

export type StrategyFn = (input: {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  readonly availableTools: readonly string[];
  readonly availableToolSchemas?: readonly ToolSchema[];
  readonly allToolSchemas?: readonly ToolSchema[];
  readonly config: ReasoningConfig;
  readonly systemPrompt?: string;
  readonly taskId?: string;
  readonly resultCompression?: ResultCompressionConfig;
  readonly contextProfile?: Partial<ContextProfile>;
  readonly agentId?: string;
  readonly sessionId?: string;
  /** Tools that MUST be called before the agent can declare success */
  readonly requiredTools?: readonly string[];
  /** Tools identified as relevant/supplementary (LLM-classified) — allowed through the required-tools gate */
  readonly relevantTools?: readonly string[];
  /** Per-tool call budget enforced by the gate */
  readonly maxCallsPerTool?: Readonly<Record<string, number>>;
  /** Max redirects when required tools are missing (default: 2) */
  readonly maxRequiredToolRetries?: number;
  /** Dynamic strategy switching configuration */
  readonly strategySwitching?: {
    readonly enabled: boolean;
    readonly maxSwitches?: number;
    readonly fallbackStrategy?: string;
  };
  /** Model ID for entropy sensor scoring (e.g. "cogito:14b", "claude-sonnet-4") */
  readonly modelId?: string;
  /** Task category for per-category entropy scoring adjustments */
  readonly taskCategory?: string;
  /** LLM sampling temperature — forwarded to entropy sensor for weight adjustment */
  readonly temperature?: number;
  /** Custom environment context key-value pairs injected into system prompt */
  readonly environmentContext?: Readonly<Record<string, string>>;
  /** Meta-tool configuration and pre-computed static data for brief/pulse/recall/find. */
  readonly metaTools?: KernelMetaToolsConfig;
  /** Runtime-resolved skills merged into `brief` alongside static catalog. */
  readonly briefResolvedSkills?: readonly { readonly name: string; readonly purpose: string }[];
  /** Initial messages to seed the kernel conversation thread (e.g. task as user message). */
  readonly initialMessages?: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
  readonly synthesisConfig?: import("../context/synthesis-types.js").SynthesisConfig;
}) => Effect.Effect<
  ReasoningResult,
  ExecutionError | IterationLimitError,
  LLMService
>;

// ─── Service Tag ───

export class StrategyRegistry extends Context.Tag("StrategyRegistry")<
  StrategyRegistry,
  {
    readonly get: (
      name: ReasoningStrategy,
    ) => Effect.Effect<StrategyFn, StrategyNotFoundError>;

    readonly register: (
      name: ReasoningStrategy,
      fn: StrategyFn,
    ) => Effect.Effect<void>;

    readonly list: () => Effect.Effect<readonly ReasoningStrategy[]>;

    /** Register a custom ThoughtKernel by name. */
    readonly registerKernel: (
      name: string,
      kernel: ThoughtKernel,
    ) => Effect.Effect<void>;

    /** Retrieve a registered ThoughtKernel by name. */
    readonly getKernel: (
      name: string,
    ) => Effect.Effect<ThoughtKernel, StrategyNotFoundError>;

    /** List all registered kernel names. */
    readonly listKernels: () => Effect.Effect<readonly string[]>;
  }
>() {}

// ─── Live Layer (Phase 1: reactive only) ───

export const StrategyRegistryLive = Layer.effect(
  StrategyRegistry,
  Effect.gen(function* () {
    // Ref-based mutable map of strategies
    const registryRef = yield* Ref.make<Map<string, StrategyFn>>(
      new Map<string, StrategyFn>([
        ["reactive", executeReactive],
        /** UI / docs alias — same implementation as `reactive` (ReAct loop). */
        ["react", executeReactive],
        ["reflexion", executeReflexion],
        ["plan-execute-reflect", executePlanExecute],
        ["tree-of-thought", executeTreeOfThought],
        ["adaptive", executeAdaptive],
      ]),
    );

    // Ref-based mutable map of ThoughtKernels
    const kernelRef = yield* Ref.make<Map<string, ThoughtKernel>>(
      new Map<string, ThoughtKernel>([["react", reactKernel]]),
    );

    return {
      get: (name) =>
        Effect.gen(function* () {
          const registry = yield* Ref.get(registryRef);
          const fn = registry.get(name);
          if (!fn) {
            return yield* Effect.fail(
              new StrategyNotFoundError({ strategy: name }),
            );
          }
          return fn;
        }),

      register: (name, fn) =>
        Ref.update(registryRef, (m) => {
          const next = new Map(m);
          next.set(name, fn);
          return next;
        }),

      list: () =>
        Ref.get(registryRef).pipe(
          Effect.map((m) => Array.from(m.keys()) as ReasoningStrategy[]),
        ),

      registerKernel: (name, kernel) =>
        Ref.update(kernelRef, (m) => {
          const next = new Map(m);
          next.set(name, kernel);
          return next;
        }),

      getKernel: (name) =>
        Effect.gen(function* () {
          const kernels = yield* Ref.get(kernelRef);
          const kernel = kernels.get(name);
          if (!kernel) {
            return yield* Effect.fail(
              new StrategyNotFoundError({ strategy: name as ReasoningStrategy }),
            );
          }
          return kernel;
        }),

      listKernels: () =>
        Ref.get(kernelRef).pipe(
          Effect.map((m) => Array.from(m.keys())),
        ),
    };
  }),
);
