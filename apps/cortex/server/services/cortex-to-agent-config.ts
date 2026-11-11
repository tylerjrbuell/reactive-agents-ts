/**
 * Maps BuildCortexAgentParams → AgentConfig (framework schema).
 *
 * Every setting with an AgentConfig path goes through here, so the config a
 * saved agent, an export or the CLI sees is the agent Cortex runs. Only the
 * true overlays stay in build-cortex-agent.ts: values that are not data (host
 * tool code, a scripted test scenario, the output schema object, a saved
 * provider key) and Cortex host wiring (trace dir, user-interaction rail).
 */
import { Schema } from "effect";
import { AgentConfigSchema, type AgentConfig } from "@reactive-agents/runtime";
import type { ShellExecuteConfig } from "@reactive-agents/tools";
import type { BuildCortexAgentParams } from "./build-cortex-agent.js";
import { migrateLegacyCliToolNames } from "./legacy-cli-tools.js";
import {
  mergeCortexAllowedTools,
  mergeCortexUiToolNames,
  splitCortexListInput,
} from "./cortex-agent-config.js";
import { isDurableBuild } from "./crashed-runs.js";

/**
 * `.withMetaTools` `todoGuidance` option: passed only when the to-do tool is on AND at least one
 * guidance flag is true (opt-in, default off; ablation ruling V5). Otherwise nothing is passed.
 */
export function todoGuidanceOption(
  metaTools: BuildCortexAgentParams["metaTools"],
): { todoGuidance?: { reminder?: boolean; systemLine?: boolean } } {
  const g = metaTools?.todoGuidance;
  if (!metaTools?.todo || !g || (g.reminder !== true && g.systemLine !== true)) return {};
  return { todoGuidance: { reminder: g.reminder === true, systemLine: g.systemLine === true } };
}

/**
 * The `.withTools({ terminal })` value for a shell-enabled build: `true` (framework defaults)
 * when nothing is customised, else one `ShellExecuteConfig` carrying the command lists and
 * {@link CortexShellOptions}. Pure — exported for the pin.
 */
export function shellTerminalOption(
  params: Pick<BuildCortexAgentParams, "terminalShellAdditionalCommands" | "terminalShellAllowedCommands" | "terminalShellOptions">,
): true | ShellExecuteConfig {
  const addl = splitCortexListInput(params.terminalShellAdditionalCommands);
  const allowOnly = splitCortexListInput(params.terminalShellAllowedCommands);
  const o = params.terminalShellOptions;
  const cfg: ShellExecuteConfig = {
    ...(allowOnly.length > 0 ? { allowedCommands: allowOnly } : {}),
    ...(addl.length > 0 ? { additionalCommands: addl } : {}),
    ...(o?.cwd ? { cwd: o.cwd } : {}),
    ...(o?.allowUnsafeCwd === true ? { allowUnsafeCwd: true } : {}),
    ...(o?.timeoutMs ? { timeoutMs: o.timeoutMs } : {}),
    ...(o?.maxOutputChars ? { maxOutputChars: o.maxOutputChars } : {}),
    ...(o?.commandAccess && o.commandAccess.length > 0 ? { commandAccess: { capabilities: [...o.commandAccess] } } : {}),
    ...(o?.sandbox ? { sandbox: o.sandbox } : {}),
  };
  return Object.keys(cfg).length > 0 ? cfg : true;
}

/**
 * Whether a build registers host `shell-execute`: `terminalTools`, `shell-execute` in the tool
 * pick, or shell command lists (stale client JSON may carry those without the pick). Pure,
 * exported for the pin that a tools-off chat never gets the shell.
 */
export function shellExecuteRequested(
  params: Pick<
    BuildCortexAgentParams,
    "terminalTools" | "tools" | "additionalToolNames" | "terminalShellAdditionalCommands" | "terminalShellAllowedCommands"
  >,
): boolean {
  return (
    params.terminalTools === true ||
    mergeCortexUiToolNames(params.tools, params.additionalToolNames).includes("shell-execute") ||
    splitCortexListInput(params.terminalShellAdditionalCommands).length > 0 ||
    splitCortexListInput(params.terminalShellAllowedCommands).length > 0
  );
}

/** Cortex synthesis names → framework `reasoning.synthesis` ("none" = not set). */
const SYNTHESIS: Readonly<Record<string, "auto" | "fast" | "deep">> = { auto: "auto", template: "fast", llm: "deep" };

/**
 * The `tools` block: the allow-list (the user's pick, kernel tools, meta-tools, sub-agent and
 * host tool names), the workspace and the shell. `allowedTools` is set only when the agent gets
 * a tool layer; `terminal` only when the host shell is requested.
 */
function toolsDraft(params: BuildCortexAgentParams): Record<string, unknown> | undefined {
  const shell = shellExecuteRequested(params);
  const userTools = mergeCortexUiToolNames(params.tools, params.additionalToolNames);
  if (shell && !userTools.includes("shell-execute")) userTools.push("shell-execute");
  const extraNames = (params.extraTools ?? []).map((t) => t.definition.name);
  const agentToolNames = params.agentTools?.map((t) => t.toolName) ?? [];
  const toolLayer =
    (params.mcpConfigs?.length ?? 0) > 0 ||
    agentToolNames.length > 0 ||
    params.dynamicSubAgents?.enabled === true ||
    userTools.length > 0 ||
    extraNames.length > 0 ||
    params.metaTools?.enabled === true ||
    shell;
  const workspace = params.workspace?.trim();
  const out: Record<string, unknown> = {
    ...(toolLayer
      ? {
          allowedTools: mergeCortexAllowedTools(userTools, params.metaTools, {
            spawnAgent: params.dynamicSubAgents?.enabled === true,
            agentToolNames: [...agentToolNames, ...extraNames],
          }),
        }
      : params.tools && params.tools.length > 0
        ? { allowedTools: migrateLegacyCliToolNames(params.tools) }
        : {}),
    ...(workspace ? { workspace } : {}),
    ...(shell ? { terminal: shellTerminalOption(params) } : {}),
  };
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Recursively merge `over` into `base`, returning a new object. Objects merge
 * key-by-key; scalars/arrays from `over` replace `base`. Used to layer the
 * curated cortex config (`over`) on top of the generic rawConfig overrides
 * (`base`) so curated controls always win on overlapping keys.
 */
function deepMerge(
  base: Record<string, unknown>,
  over: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const cur = out[k];
    if (
      v && typeof v === "object" && !Array.isArray(v) &&
      cur && typeof cur === "object" && !Array.isArray(cur)
    ) {
      out[k] = deepMerge(cur as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function cortexParamsToAgentConfig(
  params: BuildCortexAgentParams,
  nameFallback?: string,
): AgentConfig {
  const name = params.agentName?.trim() || nameFallback || `cortex-desk-${Date.now()}`;
  const provider = (params.provider ?? process.env.CORTEX_RUNNER_PROVIDER ?? "test") as AgentConfig["provider"];

  const draft: Record<string, unknown> = { name, provider };
  // Stable identity (chat session / saved agent): memory keyed on it survives restarts.
  if (params.agentId) draft.agentId = params.agentId;

  const modelStr = params.model?.trim();
  if (modelStr) draft.model = modelStr;

  if (params.temperature != null) draft.temperature = params.temperature;
  if (params.maxTokens) draft.maxTokens = params.maxTokens;
  if (typeof params.thinking === "boolean") draft.thinking = params.thinking;
  // num_ctx only when the user set one. Unset, the framework sizes it per model:
  // Ollama's probed capability gives min(model max, 32768) (llm-provider
  // `local-probe.ts`), and `.withHarness({ numCtxPolicy: "demand" })` grows it per
  // request. The old fixed 8192 here overrode both: a 262k-context model ran out of
  // window at a 7.5k prompt (trace 01M73GND, 2026-11-10).
  if (typeof params.numCtx === "number" && params.numCtx > 0) {
    draft.numCtx = params.numCtx;
  }

  // No model sentinel needed: agentConfigToBuilder applies temperature/maxTokens/
  // numCtx/thinking independently of `model` (framework fix, audit C1/C2).

  if (params.systemPrompt?.trim()) draft.systemPrompt = params.systemPrompt.trim();

  const reasoning: Record<string, unknown> = {};
  if (params.strategy) {
    reasoning.defaultStrategy = params.strategy;
  }
  if (params.strategySwitching === true) reasoning.enableStrategySwitching = true;
  if (params.auditRationale === true) reasoning.auditRationale = true;
  const synthesis = params.contextSynthesis ? SYNTHESIS[params.contextSynthesis] : undefined;
  if (synthesis) reasoning.synthesis = synthesis;
  if (params.harness && Object.keys(params.harness).length > 0) reasoning.harness = { ...params.harness };
  if (Object.keys(reasoning).length > 0) draft.reasoning = reasoning;

  // Cortex agents always run the full reasoning kernel (calibration, tool-call
  // healing, strategy selection/switching, durable checkpoint + HITL approval
  // gate). The legacy `useReasoning: false` inline-think toggle is gone (the
  // framework deleted the inline execution arm in v0.16) — durable runs still
  // force reasoning on, but that is now the only mode.
  const enableReasoning = true;
  const prevFeatures =
    draft.features && typeof draft.features === "object" && !Array.isArray(draft.features)
      ? (draft.features as Record<string, unknown>)
      : {};
  draft.features = { ...prevFeatures, reasoning: enableReasoning };

  const execution: Record<string, unknown> = {};
  if (params.maxIterations && params.maxIterations > 0) execution.maxIterations = params.maxIterations;
  if (params.minIterations && params.minIterations > 0) execution.minIterations = params.minIterations;
  if (params.timeout && params.timeout > 0) execution.timeoutMs = params.timeout;
  if (params.retryPolicy?.enabled === true && params.retryPolicy.maxRetries > 0) {
    execution.retryPolicy = {
      maxRetries: params.retryPolicy.maxRetries,
      backoffMs: params.retryPolicy.backoffMs ?? 1000,
    };
  }
  if (Object.keys(execution).length > 0) draft.execution = execution;

  const tools = toolsDraft(params);
  if (tools) draft.tools = tools;

  // All tiers off = memory off (no layer, nothing recalled into the prompt).
  if (params.memory && (params.memory.working === true || params.memory.episodic === true || params.memory.semantic === true)) {
    const tier =
      params.memory.episodic === true || params.memory.semantic === true ? "enhanced" : "standard";
    draft.memory = { tier };
  }
  // Cortex default: memory on when the caller made no memory choice (no tiers, no raw
  // `memory`). An explicit all-off `memory` is a choice: no layer.
  const memoryOn = !params.memory && !draft.memory && params.rawConfig?.memory === undefined;

  // Cortex default: meta-tools on unless `enabled: false`. Desk users get the agent's
  // own inspection tools (brief/find/recall) without opting in; `pulse`, `harnessSkill`
  // and `todo` stay opt-in.
  if ((params.metaTools?.enabled ?? true) === true) {
    const m = params.metaTools;
    draft.metaTools = {
      brief: m?.brief ?? true,
      find: m?.find ?? true,
      pulse: m?.pulse ?? false,
      recall: m?.recall ?? true,
      harnessSkill: m?.harnessSkill ?? false,
      todo: m?.todo ?? false,
      ...todoGuidanceOption(m),
    };
  }

  // Any skills config turns skills on: `withSkills()` with no paths still discovers the
  // run's workspace skills. Chat sessions always pass one; desk runs and saved agents
  // only when they set paths, pins or `global` (parseCortexSkillsConfig).
  if (params.skills) {
    draft.skills = {
      ...(params.skills.paths.length > 0 ? { paths: [...params.skills.paths] } : {}),
      ...(params.skills.activate?.length ? { activate: [...params.skills.activate] } : {}),
      ...(params.skills.global === true ? { global: true } : {}),
    };
  }

  if (params.agentTools && params.agentTools.length > 0) {
    draft.agentTools = params.agentTools.map((at) =>
      at.kind === "remote"
        ? { name: at.toolName, remoteUrl: at.remoteUrl }
        : {
            name: at.toolName,
            agent: {
              name: at.agent.name,
              ...(at.agent.description ? { description: at.agent.description } : {}),
              ...(at.agent.provider ? { provider: at.agent.provider } : {}),
              ...(at.agent.model ? { model: at.agent.model } : {}),
              ...(at.agent.tools && at.agent.tools.length > 0 ? { tools: [...at.agent.tools] } : {}),
              ...(at.agent.maxIterations ? { maxIterations: at.agent.maxIterations } : {}),
              ...(at.agent.systemPrompt ? { systemPrompt: at.agent.systemPrompt } : {}),
            },
          },
    );
  }
  if (params.dynamicSubAgents?.enabled) {
    const { maxIterations, maxRecursionDepth } = params.dynamicSubAgents;
    draft.dynamicSubAgents = {
      ...(maxIterations ? { maxIterations } : {}),
      ...(maxRecursionDepth && maxRecursionDepth > 0 ? { maxRecursionDepth } : {}),
    };
  }

  if (params.verificationStep === "reflect") draft.verificationStep = { mode: "reflect" };

  const tc = params.taskContext;
  if (tc && Object.keys(tc).length > 0) draft.taskContext = { ...tc };

  if (params.documents && params.documents.length > 0) {
    draft.documents = params.documents.map((d) => ({
      source: d.source,
      ...(d.content !== undefined ? { content: d.content } : {}),
      ...(d.format !== undefined ? { format: d.format } : {}),
      ...(d.chunkStrategy !== undefined ? { chunkStrategy: d.chunkStrategy } : {}),
      ...(d.maxChunkSize !== undefined ? { maxChunkSize: d.maxChunkSize } : {}),
      ...(d.allowPrivateHosts !== undefined ? { allowPrivateHosts: d.allowPrivateHosts } : {}),
    }));
  }

  if (params.modelRouting?.enabled) {
    draft.modelRouting = {
      ...(params.modelRouting.minTier ? { minTier: params.modelRouting.minTier } : {}),
      ...(params.modelRouting.tierModels ? { tierModels: { ...params.modelRouting.tierModels } } : {}),
    };
  }

  // A limit of 0 (the UI's "unset" default) means NO cap — never pass it as a real
  // limit, or the guard fires on the first token (tokens ≥ 0 → budget_exceeded).
  const tokenLimit = typeof params.budget?.tokenLimit === "number" && params.budget.tokenLimit > 0 ? params.budget.tokenLimit : undefined;
  const costLimit = typeof params.budget?.costLimit === "number" && params.budget.costLimit > 0 ? params.budget.costLimit : undefined;
  if (tokenLimit !== undefined || costLimit !== undefined) {
    draft.budget = {
      ...(tokenLimit !== undefined ? { tokenLimit } : {}),
      ...(costLimit !== undefined ? { costLimit } : {}),
    };
  }

  if (params.grounding?.mode) {
    draft.grounding = {
      mode: params.grounding.mode,
      ...(params.grounding.tolerance != null ? { tolerance: params.grounding.tolerance } : {}),
    };
  }
  // Always-on at "block" in the framework; set only to override.
  if (params.fabricationGuard) draft.fabricationGuard = params.fabricationGuard;

  // Durable runs: opted in, or forced by a `detach` approval policy (build refuses
  // detach without a store: the pause has to persist).
  if (isDurableBuild(params)) {
    draft.durableRuns = {
      ...(params.durableRuns?.dir ? { dir: params.durableRuns.dir } : {}),
      ...(params.durableRuns?.checkpointEvery !== undefined ? { checkpointEvery: params.durableRuns.checkpointEvery } : {}),
    };
    // Agentic-UI interaction rail (`request_user_input` pauses): on with durable
    // runs, where a pause can persist and resume. An AgentConfig path since
    // runtime 078365780 (was a Cortex overlay).
    draft.userInteraction = true;
  }

  if (params.guardrails?.enabled === true) {
    const g = params.guardrails;
    // Explicit detector switch wins; else the legacy threshold (> 0 = on); else on.
    const on = (flag: boolean | undefined, threshold: number | undefined): boolean =>
      flag ?? (threshold != null ? threshold > 0 : true);
    draft.guardrails = {
      injection: on(g.injection, g.injectionThreshold),
      pii: on(g.pii, g.piiThreshold),
      toxicity: on(g.toxicity, g.toxicityThreshold),
      ...(g.customBlocklist && g.customBlocklist.length > 0 ? { customBlocklist: [...g.customBlocklist] } : {}),
    };
  }

  if (params.persona?.enabled === true) {
    const p = params.persona;
    const instructionParts: string[] = [];
    if (p.traits) instructionParts.push(p.traits);
    if (p.responseStyle) instructionParts.push(`Response style: ${p.responseStyle}`);
    draft.persona = {
      ...(p.role ? { role: p.role } : {}),
      ...(p.tone ? { tone: p.tone } : {}),
      ...(instructionParts.length > 0 ? { instructions: instructionParts.join("\n") } : {}),
    };
  }

  if (params.observabilityVerbosity && params.observabilityVerbosity !== "off") {
    draft.observability = {
      verbosity: params.observabilityVerbosity,
      live: true,
    };
    draft.logging = {
      level: params.observabilityVerbosity === "verbose" ? "debug" : "info",
      format: "json",
      output: "file",
      filePath: process.env.CORTEX_AGENT_LOG_FILE ?? ".cortex/logs/agent-debug.log",
    };
  }

  if (params.observability?.checklist !== undefined) {
    const prevObs =
      draft.observability && typeof draft.observability === "object" && !Array.isArray(draft.observability)
        ? (draft.observability as Record<string, unknown>)
        : {};
    draft.observability = { ...prevObs, checklist: params.observability.checklist };
  }

  // Run traces off (chat `traceRuns: false`). A trace dir (`tracing: { dir }`) is
  // Cortex host wiring and stays an overlay in build-cortex-agent.ts.
  if (params.tracing === false) {
    const prevObs =
      draft.observability && typeof draft.observability === "object" && !Array.isArray(draft.observability)
        ? (draft.observability as Record<string, unknown>)
        : {};
    draft.observability = { ...prevObs, tracing: false };
  }

  if (params.fallbacks?.enabled === true && params.fallbacks.providers?.length) {
    draft.fallbacks = {
      providers: [...params.fallbacks.providers],
      ...(params.fallbacks.errorThreshold != null ? { errorThreshold: params.fallbacks.errorThreshold } : {}),
    };
  }

  if (params.mcpConfigs && params.mcpConfigs.length > 0) {
    draft.mcpServers = params.mcpConfigs;
  }

  if (params.healthCheck === true) {
    const prev =
      draft.features && typeof draft.features === "object" && !Array.isArray(draft.features)
        ? (draft.features as Record<string, unknown>)
        : {};
    draft.features = { ...prev, healthCheck: true };
  }

  draft.features = {
    ...(draft.features as Record<string, unknown>),
    ...(memoryOn ? { memory: true } : {}),
    ...(params.runtimeVerification === true ? { verification: true } : {}),
    ...(params.streaming === true ? { streaming: true } : {}),
    // Desk / runner pause, resume and stop call ReactiveAgent.pause|resume|stop (KillSwitchService).
    killSwitch: true,
  };

  // Approval gate: the framework key as is (mode, tools, shell command rules).
  if (params.approvalPolicy) {
    const ap = params.approvalPolicy;
    draft.approvalPolicy = {
      mode: ap.mode,
      ...(ap.tools && ap.tools.length > 0 ? { tools: [...ap.tools] } : {}),
      ...(ap.commands && ap.commands.length > 0 ? { commands: [...ap.commands] } : {}),
    };
  }

  // Generic framework-config overrides (type-introspected renderer): layer the
  // curated `draft` OVER rawConfig so curated cortex controls win, while
  // advanced framework-only fields the UI doesn't curate still flow through.
  // Decode validates the merged result — an invalid override fails cleanly here.
  const effective =
    params.rawConfig && Object.keys(params.rawConfig).length > 0
      ? deepMerge(params.rawConfig, draft)
      : draft;

  return Schema.decodeUnknownSync(AgentConfigSchema)(effective);
}
