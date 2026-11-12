/**
 * Cortex agent config → TypeScript ("Export as code").
 *
 * The code is the framework's own `agentConfigToSource` over the same AgentConfig
 * `buildCortexAgent` builds from (`cortexParamsToAgentConfig`), so the exported
 * chain and the live agent start from one config. Cortex keeps no emitter.
 *
 * `buildCortexAgent` then applies an overlay of the few builder calls that have
 * no AgentConfig form (host tool code, the test scenario, Cortex's trace dir, the
 * a saved key). Those cannot be
 * in the exported code, so
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
import { cortexParamsToAgentConfig } from "./cortex-to-agent-config.js";
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
 * Every builder call `buildCortexAgent` applies after `agentConfigToBuilder`: the
 * true overlays, each with no AgentConfig form. Pinned against the source of
 * `build-cortex-agent.ts`, so a new overlay call must be added here (and to
 * {@link cortexOnlySettings}) or the pin fails.
 */
export const CORTEX_OVERLAY_CALLS: readonly string[] = [
  "withProvider",
  "withTestScenario",
  "withTools",
  "withTracing",
];

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
  if (params.testScenario && params.testScenario.length > 0) add("Scripted test turns", "withTestScenario");
  if ((params.extraTools?.length ?? 0) > 0) {
    add("Host tools", "withTools", list((params.extraTools ?? []).map((t) => t.definition.name)));
  }
  if (params.tracing) add("Run traces", "withTracing", params.tracing.dir);
  // The output schema is plain JSON Schema in the AgentConfig (runtime 7d4664da2), so it is in the code.
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
