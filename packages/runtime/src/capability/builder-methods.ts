/**
 * Machine-readable descriptor list for every public `with*` builder method.
 *
 * The list is DERIVED by reflecting `ReactiveAgentBuilder.prototype` at call
 * time — so a new builder method appears in the capability manifest with ZERO
 * hand-maintenance and cannot silently drift. The optional annotation map below
 * enriches the well-known methods (kind / configPath / description); anything
 * not annotated defaults to an `overlay` descriptor with a generated blurb.
 */
import { ReactiveAgentBuilder } from "../builder.js";

export interface BuilderMethodDescriptor {
  /** Method name, e.g. "withModelRouting". */
  readonly name: string;
  /** `config` maps to an AgentConfigSchema field (see configPath); `overlay` is wired manually by consumers. */
  readonly kind: "config" | "overlay";
  /** Dotted AgentConfig path when kind === "config". */
  readonly configPath?: string;
  readonly description: string;
  /** True when the method carried no explicit annotation (default overlay). */
  readonly inferred: boolean;
}

interface Annotation {
  kind: "config" | "overlay";
  configPath?: string;
  description: string;
}

/**
 * Enrichment for well-known builder methods. Not required for correctness —
 * unannotated methods still appear in the manifest — but gives the UI good
 * labels/help and marks which methods map to a schema field.
 */
export const BUILDER_METHOD_ANNOTATIONS: Readonly<Record<string, Annotation>> = {
  withName: { kind: "config", configPath: "name", description: "Agent name." },
  withProvider: { kind: "config", configPath: "provider", description: "LLM provider." },
  withModel: { kind: "config", configPath: "model", description: "Model id." },
  withSystemPrompt: { kind: "config", configPath: "systemPrompt", description: "System prompt." },
  withTools: { kind: "config", configPath: "tools.allowedTools", description: "Allowed tool list." },
  withMemory: { kind: "config", configPath: "memory.tier", description: "Enable memory layers." },
  withReasoning: { kind: "config", configPath: "reasoning", description: "Reasoning strategy + options." },
  withMaxIterations: { kind: "config", configPath: "execution.maxIterations", description: "Iteration cap." },
  withTimeout: { kind: "config", configPath: "execution.timeoutMs", description: "Run timeout (ms)." },
  withGuardrails: { kind: "config", configPath: "guardrails", description: "Injection/PII/toxicity guardrails." },
  withPersona: { kind: "config", configPath: "persona", description: "Role/tone/instructions persona." },
  withObservability: { kind: "config", configPath: "observability", description: "Live observability verbosity." },
  withLogging: { kind: "config", configPath: "logging", description: "Structured logging config." },
  withCostTracking: { kind: "config", configPath: "costTracking", description: "Cost budget caps." },
  withGateway: { kind: "config", configPath: "gateway", description: "Gateway (cron/webhook) config." },
  withFallbacks: { kind: "config", configPath: "fallbacks", description: "Provider fallbacks." },

  withModelRouting: { kind: "overlay", description: "Cost-aware model routing (tierModels/minTier)." },
  withGrounding: { kind: "overlay", description: "Numeric evidence grounding." },
  withOutputSchema: { kind: "overlay", description: "Typed structured output extraction." },
  withDurableRuns: { kind: "overlay", description: "Crash-resume durable execution." },
  withApprovalPolicy: { kind: "overlay", description: "Human-in-the-loop tool approval gate." },
  withHealthCheck: { kind: "overlay", description: "Enable agent.health() probes." },
  withVerification: { kind: "overlay", description: "Semantic-entropy verification package." },
  withVerificationStep: { kind: "overlay", description: "Single post-answer reflect pass." },
  withBudget: { kind: "overlay", description: "Token/cost budget caps." },
  withSkills: { kind: "overlay", description: "Living SKILL.md directories + evolution." },
  withMetaTools: { kind: "overlay", description: "Conductor's-suite meta-tools." },
  withTerminalTools: { kind: "overlay", description: "Host shell-execute tool." },
  withMCP: { kind: "overlay", description: "Connect MCP servers." },
  withAgentTool: { kind: "overlay", description: "Register a sub-agent as a tool." },
  withDynamicSubAgents: { kind: "overlay", description: "Dynamic sub-agent spawning." },
  withThinking: { kind: "overlay", description: "Extended thinking / reasoning effort." },
  withKillSwitch: { kind: "overlay", description: "Emergency stop / terminate control." },
  withCortex: { kind: "overlay", description: "Emit events to a Cortex desk." },
  withTaskContext: { kind: "overlay", description: "Background key/value facts for reasoning." },
};

/** Split "withModelRouting" → "model routing" for a default human blurb. */
function humanize(method: string): string {
  return method
    .replace(/^with/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
}

/**
 * Reflect the builder prototype for every public `with*` method and return a
 * sorted descriptor list. Pure + cheap; the manifest memoizes the result.
 */
export function deriveBuilderMethods(): BuilderMethodDescriptor[] {
  const proto = ReactiveAgentBuilder.prototype as unknown as Record<string, unknown>;
  const names = Object.getOwnPropertyNames(proto)
    .filter((n) => /^with[A-Z]/.test(n) && typeof proto[n] === "function")
    .sort();

  return names.map((name) => {
    const ann = BUILDER_METHOD_ANNOTATIONS[name];
    if (ann) {
      return {
        name,
        kind: ann.kind,
        ...(ann.configPath ? { configPath: ann.configPath } : {}),
        description: ann.description,
        inferred: false,
      };
    }
    return {
      name,
      kind: "overlay" as const,
      description: `Configure ${humanize(name)}.`,
      inferred: true,
    };
  });
}
