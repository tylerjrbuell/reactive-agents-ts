/**
 * Cortex agent config → TypeScript ("Export as code").
 *
 * The code is the framework's own `agentConfigToSource` over the same AgentConfig
 * `buildCortexAgent` builds from (`cortexParamsToAgentConfig`), so the exported
 * chain and the live agent start from one config. Cortex keeps no emitter.
 *
 * `buildCortexAgent` then applies an overlay of builder calls that have no
 * AgentConfig path in Cortex today. Those cannot be in the exported code, so
 * {@link cortexOnlySettings} lists each one that is set, in plain words, and the
 * export shows the list beside the code. `CORTEX_OVERLAY_CALLS` names every
 * overlay call; `cortex-agent-source.test.ts` fails when `build-cortex-agent.ts`
 * gains a `.with*` call that is not in it.
 *
 * Secrets: a key saved in Settings · Providers is applied by the overlay and is
 * never in the AgentConfig, so it cannot reach the code; the note names the env
 * variable to set instead. MCP `env` / `headers` values print as `process.env`
 * references (framework redaction).
 */
import { agentConfigToSource, type AgentConfig } from "@reactive-agents/runtime";
import type { BuildCortexAgentParams } from "./build-cortex-agent.js";
import { shellExecuteRequested } from "./build-cortex-agent.js";
import { cortexParamsToAgentConfig } from "./cortex-to-agent-config.js";
import { mergeCortexUiToolNames } from "./cortex-agent-config.js";
import { KEYED_PROVIDER_ENV, providerKeyForAgent } from "./provider-key-store.js";

/** A setting the agent runs with in Cortex that the exported code does not contain. */
export interface CortexOnlySetting {
  /** What the setting is, in plain words. */
  readonly setting: string;
  /** The builder call Cortex applies for it (add it by hand to match Cortex). */
  readonly call: string;
  /** Extra context: the value, or why it is left out. */
  readonly detail?: string;
}

/** Exported code plus the Cortex-only settings it leaves out. */
export interface CortexAgentSource {
  /** TypeScript module from `agentConfigToSource`. */
  readonly source: string;
  /** Settings Cortex applies on top of the AgentConfig; not in {@link source}. */
  readonly notInCode: readonly CortexOnlySetting[];
}

/**
 * Every builder call `buildCortexAgent` applies after `agentConfigToBuilder`.
 * Pinned against the source of `build-cortex-agent.ts`, so a new overlay call
 * must be added here (and to {@link cortexOnlySettings}) or the pin fails.
 */
export const CORTEX_OVERLAY_CALLS: readonly string[] = [
  "withProvider",
  "withAgentId",
  "withTestScenario",
  "withMemory",
  "withReasoning",
  "withAgentTool",
  "withRemoteAgent",
  "withDynamicSubAgents",
  "withTools",
  "withTaskContext",
  "withSkills",
  "withMinIterations",
  "withVerificationStep",
  "withVerification",
  "withMetaTools",
  "withObservability",
  "withTracing",
  "withStreaming",
  "withBudget",
  "withGrounding",
  "withFabricationGuard",
  "withHarness",
  "withDocuments",
  "withModelRouting",
  "withOutputSchema",
  "withDurableRuns",
  "withUserInteraction",
  "withKillSwitch",
];

const SYNTHESIS: Readonly<Record<string, string>> = { auto: "auto", template: "fast", llm: "deep" };

const list = (xs: readonly string[]): string => xs.join(", ");

/**
 * The Cortex overlay settings `params` turns on, in the order `buildCortexAgent`
 * applies them. Mirrors its conditions; pure apart from reading the installed
 * provider key store (whether a saved key applies, never the key itself).
 */
export function cortexOnlySettings(
  params: BuildCortexAgentParams,
  config: AgentConfig = cortexParamsToAgentConfig(params),
): CortexOnlySetting[] {
  const out: CortexOnlySetting[] = [];
  const add = (setting: string, call: string, detail?: string): void => {
    out.push(detail ? { setting, call, detail } : { setting, call });
  };

  if (providerKeyForAgent(config.provider)) {
    const envName = KEYED_PROVIDER_ENV[config.provider]?.[0];
    add(
      "API key saved in Settings",
      "withProvider",
      envName ? `Not exported. Set ${envName} where the code runs.` : "Not exported.",
    );
  }
  if (params.agentId) add("Stable agent id", "withAgentId", params.agentId);
  if (params.testScenario && params.testScenario.length > 0) add("Scripted test turns", "withTestScenario");
  if (!config.memory && !params.memory) {
    add("Memory", "withMemory", "Cortex turns memory on when no memory tier is chosen.");
  }
  if (params.contextSynthesis && params.contextSynthesis !== "none") {
    add("Context synthesis", "withReasoning", `synthesis: "${SYNTHESIS[params.contextSynthesis] ?? "auto"}"`);
  }
  const agentTools = params.agentTools ?? [];
  if (agentTools.length > 0) {
    add("Agent tools", "withAgentTool / withRemoteAgent", list(agentTools.map((t) => t.toolName)));
  }
  if (params.dynamicSubAgents?.enabled) add("Dynamic sub-agents", "withDynamicSubAgents");
  const extraNames = mergeCortexUiToolNames(undefined, params.additionalToolNames);
  if (extraNames.length > 0) add("Extra tool names", "withTools", list(extraNames));
  if ((params.extraTools?.length ?? 0) > 0) {
    add("Host tools", "withTools", list((params.extraTools ?? []).map((t) => t.definition.name)));
  }
  if (shellExecuteRequested(params)) add("Host shell (shell-execute) and its options", "withTools", "terminal");
  if (params.taskContext && Object.keys(params.taskContext).length > 0) {
    add("Task context", "withTaskContext", list(Object.keys(params.taskContext)));
  }
  if (params.skills) add("Skills", "withSkills");
  if (params.minIterations && params.minIterations > 0) {
    add("Minimum iterations", "withMinIterations", String(params.minIterations));
  }
  if (params.verificationStep === "reflect") add("Reflect verification step", "withVerificationStep");
  if (params.runtimeVerification === true) add("Verification", "withVerification");
  if ((params.metaTools?.enabled ?? true) === true) {
    add("Meta tools", "withMetaTools", params.metaTools ? undefined : "Cortex turns meta tools on by default.");
  }
  if (params.tracing === false) add("Tracing off", "withObservability");
  else if (params.tracing) add("Run traces", "withTracing", params.tracing.dir);
  if (params.streaming === true) add("Streaming", "withStreaming");
  const tokenLimit = params.budget?.tokenLimit ?? 0;
  const costLimit = params.budget?.costLimit ?? 0;
  if (tokenLimit > 0 || costLimit > 0) add("Budget", "withBudget");
  if (params.grounding?.mode) add("Numeric grounding", "withGrounding", params.grounding.mode);
  if (params.fabricationGuard) add("Fabrication guard", "withFabricationGuard", params.fabricationGuard);
  if (params.harness && Object.keys(params.harness).length > 0) add("Harness switches", "withHarness");
  if (params.documents && params.documents.length > 0) {
    add("Documents", "withDocuments", `${params.documents.length} document(s)`);
  }
  if (params.modelRouting?.enabled) add("Model routing", "withModelRouting");
  if (params.outputSchema && Object.keys(params.outputSchema).length > 0) {
    add("Structured output schema", "withOutputSchema", "The schema object is code-only.");
  }
  if (params.durableRuns?.enabled === true || params.approvalPolicy?.mode === "detach") {
    add("Durable runs and user questions", "withDurableRuns / withUserInteraction");
  }
  add("Desk pause and stop", "withKillSwitch");
  return out;
}

/**
 * TypeScript for the agent `params` describe: the framework's `agentConfigToSource`
 * over `cortexParamsToAgentConfig(params)`, plus the Cortex-only settings it leaves out.
 *
 * @param params - The build params a run, chat or saved agent would build from.
 * @param nameFallback - Agent name when `params.agentName` is blank.
 */
export function cortexAgentSource(params: BuildCortexAgentParams, nameFallback?: string): CortexAgentSource {
  const config = cortexParamsToAgentConfig(params, nameFallback);
  return { source: agentConfigToSource(config), notInCode: cortexOnlySettings(params, config) };
}
