/**
 * Normalizes Cortex UI agent `config` blobs before building `ReactiveAgents`.
 * SQLite/JSON round-trips and older clients can leave numbers as strings; some
 * fields (e.g. `temperature: 0`) must not be treated as "missing" via truthiness checks.
 */

import type { DocumentSpec } from "@reactive-agents/runtime";

function asFiniteNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asNonEmptyString(v: unknown): string | undefined {
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  }
  return undefined;
}

/**
 * Parse a persisted `documents` config value into typed {@link DocumentSpec}s.
 * Entries with neither `source` nor inline `content` are dropped; inline-only
 * entries get the label `"inline"` so retrieval chunks stay attributable.
 */
export function parseDocumentSpecs(raw: unknown): DocumentSpec[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const specs: DocumentSpec[] = [];
  for (const d of raw as unknown[]) {
    if (!d || typeof d !== "object" || Array.isArray(d)) continue;
    const r = d as Record<string, unknown>;
    const source = typeof r.source === "string" ? r.source : "";
    const content = typeof r.content === "string" && r.content.length > 0 ? r.content : undefined;
    if (source.length === 0 && content === undefined) continue;
    specs.push({
      source: source.length > 0 ? source : "inline",
      ...(content !== undefined ? { content } : {}),
      ...(typeof r.format === "string" ? { format: r.format } : {}),
      ...(typeof r.chunkStrategy === "string" ? { chunkStrategy: r.chunkStrategy } : {}),
      ...(typeof r.maxChunkSize === "number" ? { maxChunkSize: r.maxChunkSize } : {}),
    });
  }
  return specs.length > 0 ? specs : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string" && x.length > 0);
  return out.length > 0 ? out : undefined;
}

/**
 * Coerces `taskContext` to `Record<string, string>` for the builder's `withTaskContext`.
 * Non-object input yields `undefined`; values are stringified so JSON numbers/booleans round-trip safely.
 */
export function coerceTaskContextRecord(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    const key = k.trim();
    if (!key) continue;
    if (v === null || v === undefined) continue;
    const s = typeof v === "string" ? v : String(v);
    if (s.length > 0) out[key] = s;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Living skills / SKILL.md paths for `withSkills`.
 *
 * NOTE: `evolution` was a Cortex-only field that the framework's `withSkills()`
 * accepted-but-ignored; v0.14 (DEBT-REGISTER P0-10) made passing it throw
 * instead. Do not reintroduce an `evolution` key here — parse and drop it if
 * ever seen, never forward it to the builder.
 */
export type CortexSkillsConfig = {
  readonly paths: readonly string[];
  /** Skill names to ALWAYS load (bypasses task-relevance auto-activation). Framework `withSkills({ activate })`. */
  readonly activate?: readonly string[];
};

/** Parses `skills` from a raw config blob for the builder's `withSkills`. */
export function parseCortexSkillsConfig(raw: unknown): CortexSkillsConfig | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const pr = o.paths;
  if (!Array.isArray(pr)) return undefined;
  const paths = pr
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim());
  if (paths.length === 0) return undefined;

  const activate = asStringArray(o.activate);
  return { paths, ...(activate ? { activate } : {}) };
}

/**
 * Returns a shallow copy with coerced primitives and nested objects safe for
 * {@link GatewayProcessManager} / runner-style agent construction.
 */
export function normalizeCortexAgentConfig(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };

  const n = (key: string) => {
    const v = asFiniteNumber(raw[key]);
    if (v !== undefined) out[key] = v;
  };

  n("temperature");
  n("maxTokens");
  n("numCtx");
  // Thinking is tri-state: only a real boolean is kept; anything else means "auto".
  if (typeof raw.thinking !== "boolean") delete out.thinking;
  n("maxIterations");
  n("minIterations");
  n("timeout");

  const prov = asNonEmptyString(raw.provider);
  if (prov !== undefined) out.provider = prov;

  const model = asNonEmptyString(raw.model);
  if (model !== undefined) out.model = model;

  const strat = asNonEmptyString(raw.strategy);
  if (strat !== undefined) {
    // Framework registry key is `reactive`; Cortex UI historically used `react`.
    out.strategy = strat === "react" ? "reactive" : strat;
  }

  const sp = typeof raw.systemPrompt === "string" ? raw.systemPrompt : undefined;
  if (sp !== undefined) out.systemPrompt = sp;

  const prompt = typeof raw.prompt === "string" ? raw.prompt : undefined;
  if (prompt !== undefined) out.prompt = prompt;

  const tc = coerceTaskContextRecord(raw.taskContext);
  if (tc !== undefined) out.taskContext = tc;
  else delete out.taskContext;

  if (raw.healthCheck === true) out.healthCheck = true;
  else delete out.healthCheck;

  // Agent self-control is strictly opt-in: only a literal `true` keeps it on.
  if (raw.agentControl === true) out.agentControl = true;
  else delete out.agentControl;

  const tools = asStringArray(raw.tools);
  if (tools !== undefined) out.tools = tools;

  const addlTools = asNonEmptyString(raw.additionalToolNames);
  if (addlTools !== undefined) out.additionalToolNames = addlTools;
  else delete out.additionalToolNames;

  const shellAdd = asNonEmptyString(raw.terminalShellAdditionalCommands);
  if (shellAdd !== undefined) out.terminalShellAdditionalCommands = shellAdd;
  else delete out.terminalShellAdditionalCommands;

  const shellAllow = asNonEmptyString(raw.terminalShellAllowedCommands);
  if (shellAllow !== undefined) out.terminalShellAllowedCommands = shellAllow;
  else delete out.terminalShellAllowedCommands;

  const shellOpts = parseCortexShellOptions(raw.terminalShellOptions);
  if (shellOpts !== undefined) out.terminalShellOptions = shellOpts;
  else delete out.terminalShellOptions;

  // Working directory for file tools + shell (`.withTools({ workspace })`). Existence is checked
  // at the API boundary (workspace.ts) and again by the framework at build.
  const ws = asNonEmptyString(raw.workspace);
  if (ws !== undefined) out.workspace = ws;
  else delete out.workspace;

  // Generic framework-config overrides (type-introspected renderer); only a plain object is kept.
  if (!raw.rawConfig || typeof raw.rawConfig !== "object" || Array.isArray(raw.rawConfig) || Object.keys(raw.rawConfig).length === 0) {
    delete out.rawConfig;
  }

  const rp = raw.retryPolicy;
  if (rp && typeof rp === "object" && !Array.isArray(rp)) {
    const o = rp as Record<string, unknown>;
    const enabled = o.enabled === true;
    const maxRetries = asFiniteNumber(o.maxRetries);
    const backoffMs = asFiniteNumber(o.backoffMs);
    out.retryPolicy = {
      enabled,
      ...(maxRetries !== undefined ? { maxRetries } : {}),
      ...(backoffMs !== undefined ? { backoffMs } : {}),
    };
  }

  const fb = raw.fallbacks;
  if (fb && typeof fb === "object" && !Array.isArray(fb)) {
    const o = fb as Record<string, unknown>;
    // v0.14 (register P0-3): the runtime FallbackConfig is `{ providers }` only.
    // `enabled` stays a cortex-boundary on/off toggle (not forwarded);
    // `errorThreshold` was never wired and is dropped. The API schemas still
    // accept both for back-compat.
    if (o.enabled !== false) {
      const providers = asStringArray(o.providers);
      if (providers) {
        out.fallbacks = { providers };
      }
    }
  }

  const mt = raw.metaTools;
  if (mt && typeof mt === "object" && !Array.isArray(mt)) {
    const o = mt as Record<string, unknown>;
    out.metaTools = {
      enabled: o.enabled === true,
      brief: o.brief === true,
      find: o.find === true,
      pulse: o.pulse === true,
      recall: o.recall === true,
      harnessSkill: o.harnessSkill === true,
      todo: o.todo === true,
      ...normalizeTodoGuidance(o.todoGuidance),
    };
  }

  // Display-only live checklist toggle; only an explicit boolean is carried (absent = framework default on).
  const ob = raw.observability;
  if (ob && typeof ob === "object" && !Array.isArray(ob) && typeof (ob as Record<string, unknown>).checklist === "boolean") {
    out.observability = { checklist: (ob as Record<string, unknown>).checklist as boolean };
  } else {
    delete out.observability;
  }

  const vs = raw.verificationStep;
  if (vs === "none" || vs === "reflect" || vs === undefined) {
    out.verificationStep = vs;
  } else if (typeof vs === "string") {
    out.verificationStep = vs === "reflect" ? "reflect" : "none";
  }

  if (raw.runtimeVerification === true) out.runtimeVerification = true;
  else delete out.runtimeVerification;

  if (raw.streamReasoningSteps === true) out.streamReasoningSteps = true;
  else if (raw.streamReasoningSteps === false) out.streamReasoningSteps = false;
  else delete out.streamReasoningSteps;

  // Chat auto-naming is ON unless explicitly disabled — store only the opt-out.
  if (raw.autoName === false) out.autoName = false;
  else delete out.autoName;

  // Between-turn environment notices are ON unless explicitly disabled — store only the opt-out.
  if (raw.environmentUpdates === false) out.environmentUpdates = false;
  else delete out.environmentUpdates;

  // Chat run tracing is ON unless explicitly disabled — store only the opt-out.
  if (raw.traceRuns === false) out.traceRuns = false;
  else delete out.traceRuns;

  if (raw.terminalTools === true) out.terminalTools = true;
  else delete out.terminalTools;

  const mids = raw.mcpServerIds;
  if (Array.isArray(mids)) {
    const ids = mids.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
    if (ids.length > 0) out.mcpServerIds = ids;
  }

  const parsedAgentTools = parseAgentToolEntries(raw.agentTools);
  if (parsedAgentTools) out.agentTools = parsedAgentTools;

  const ds = raw.dynamicSubAgents;
  if (ds && typeof ds === "object" && !Array.isArray(ds)) {
    const o = ds as Record<string, unknown>;
    if (o.enabled === true) {
      out.dynamicSubAgents = {
        enabled: true,
        ...(typeof o.maxIterations === "number" && o.maxIterations > 0 ? { maxIterations: o.maxIterations } : {}),
      };
    }
  }

  const skillsParsed = parseCortexSkillsConfig(raw.skills);
  if (skillsParsed !== undefined) {
    out.skills = {
      paths: [...skillsParsed.paths],
      ...(skillsParsed.activate?.length ? { activate: [...skillsParsed.activate] } : {}),
    };
  } else delete out.skills;

  const fg = raw.fabricationGuard;
  if (fg === "off" || fg === "warn" || fg === "block") out.fabricationGuard = fg;
  else delete out.fabricationGuard;

  // ── Five previously dead-end fields ─────────────────────────────────────

  if (raw.strategySwitching === true) out.strategySwitching = true;
  else if (raw.strategySwitching === false) out.strategySwitching = false;
  else delete out.strategySwitching;

  if (raw.auditRationale === true) out.auditRationale = true;
  else delete out.auditRationale;

  if (raw.outputSchema && typeof raw.outputSchema === "string") {
    try {
      const parsed = JSON.parse(raw.outputSchema);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) out.outputSchema = parsed;
      else delete out.outputSchema;
    } catch {
      delete out.outputSchema;
    }
  } else if (raw.outputSchema && typeof raw.outputSchema === "object" && !Array.isArray(raw.outputSchema)) {
    out.outputSchema = raw.outputSchema;
  } else {
    delete out.outputSchema;
  }

  const bdg = raw.budget as { tokenLimit?: unknown; costLimit?: unknown } | undefined;
  // Only a POSITIVE limit is a real cap; 0 (the UI default) means "no budget".
  // Persisting {tokenLimit:0} makes the Arbitrator fire budget_exceeded on the
  // first token (tokens ≥ 0) — the saved-agent failure bug.
  const budTokenLimit = typeof bdg?.tokenLimit === "number" && bdg.tokenLimit > 0 ? bdg.tokenLimit : undefined;
  const budCostLimit = typeof bdg?.costLimit === "number" && bdg.costLimit > 0 ? bdg.costLimit : undefined;
  if (budTokenLimit !== undefined || budCostLimit !== undefined) {
    out.budget = {
      ...(budTokenLimit !== undefined ? { tokenLimit: budTokenLimit } : {}),
      ...(budCostLimit !== undefined ? { costLimit: budCostLimit } : {}),
    };
  } else {
    delete out.budget;
  }

  const grd = raw.grounding as { mode?: unknown; tolerance?: unknown } | undefined;
  if (grd && (grd.mode === "warn" || grd.mode === "block")) {
    out.grounding = {
      mode: grd.mode,
      ...(typeof grd.tolerance === "number" ? { tolerance: grd.tolerance } : {}),
    };
  } else {
    delete out.grounding;
  }

  const dr = raw.durableRuns;
  if (dr && typeof dr === "object" && !Array.isArray(dr) && (dr as { enabled?: boolean }).enabled) {
    const d = dr as Record<string, unknown>;
    // Accept BOTH shapes: the UI config (`approvalTools: string[]`) and the
    // build/runner shape (`approvalPolicy: { tools, mode }`). Normalize to the
    // build shape (`approvalPolicy.tools`) that buildCortexAgent consumes.
    const ap = d.approvalPolicy as { tools?: unknown; mode?: unknown } | undefined;
    const policyTools = Array.isArray(ap?.tools)
      ? (ap?.tools as unknown[])
      : Array.isArray(d.approvalTools)
        ? (d.approvalTools as unknown[])
        : undefined;
    const mode = ap?.mode === "block" || d.approvalMode === "block" ? "block" : "detach";
    out.durableRuns = {
      enabled: true,
      ...(typeof d.checkpointEvery === "number" ? { checkpointEvery: d.checkpointEvery } : {}),
      ...(typeof d.dir === "string" && d.dir.trim() !== "" ? { dir: d.dir.trim() } : {}),
      ...(policyTools && policyTools.length > 0
        ? { approvalPolicy: { tools: policyTools, mode } }
        : {}),
    };
  } else {
    delete out.durableRuns;
  }

  const mem = raw.memory;
  if (mem && typeof mem === "object" && !Array.isArray(mem)) {
    const m = mem as Record<string, unknown>;
    out.memory = {
      working: m.working === true,
      episodic: m.episodic === true,
      semantic: m.semantic === true,
    };
  } else {
    delete out.memory;
  }

  const validSynthesisModes = new Set(["auto", "template", "llm", "none"]);
  const cs = asNonEmptyString(raw.contextSynthesis);
  if (cs && validSynthesisModes.has(cs)) {
    out.contextSynthesis = cs;
  } else {
    delete out.contextSynthesis;
  }

  const gr = raw.guardrails;
  if (gr && typeof gr === "object" && !Array.isArray(gr)) {
    const g = gr as Record<string, unknown>;
    const blocklist = asStringArray(g.customBlocklist);
    out.guardrails = {
      enabled: g.enabled === true,
      // Real detector switches (framework `withGuardrails({ injection, pii, toxicity })`); absent = on.
      ...(typeof g.injection === "boolean" ? { injection: g.injection } : {}),
      ...(typeof g.pii === "boolean" ? { pii: g.pii } : {}),
      ...(typeof g.toxicity === "boolean" ? { toxicity: g.toxicity } : {}),
      ...(blocklist ? { customBlocklist: blocklist } : {}),
      ...(asFiniteNumber(g.injectionThreshold) !== undefined
        ? { injectionThreshold: asFiniteNumber(g.injectionThreshold) }
        : {}),
      ...(asFiniteNumber(g.piiThreshold) !== undefined
        ? { piiThreshold: asFiniteNumber(g.piiThreshold) }
        : {}),
      ...(asFiniteNumber(g.toxicityThreshold) !== undefined
        ? { toxicityThreshold: asFiniteNumber(g.toxicityThreshold) }
        : {}),
    };
  } else {
    delete out.guardrails;
  }

  const pe = raw.persona;
  if (pe && typeof pe === "object" && !Array.isArray(pe)) {
    const p = pe as Record<string, unknown>;
    out.persona = {
      enabled: p.enabled === true,
      ...(asNonEmptyString(p.role) !== undefined ? { role: asNonEmptyString(p.role) } : {}),
      ...(asNonEmptyString(p.tone) !== undefined ? { tone: asNonEmptyString(p.tone) } : {}),
      ...(asNonEmptyString(p.traits) !== undefined ? { traits: asNonEmptyString(p.traits) } : {}),
      ...(asNonEmptyString(p.responseStyle) !== undefined ? { responseStyle: asNonEmptyString(p.responseStyle) } : {}),
    };
  } else {
    delete out.persona;
  }

  return out;
}

/**
 * Validates an untyped `agentTools` list (request body or saved config): keeps the
 * well-formed local/remote entries, drops the rest. `undefined` when none survive.
 */
export function parseAgentToolEntries(raw: unknown): CortexAgentToolEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const parsed = raw.map(parseAgentToolEntry).filter((x): x is CortexAgentToolEntry => x != null);
  return parsed.length > 0 ? parsed : undefined;
}

function parseAgentToolEntry(x: unknown): CortexAgentToolEntry | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const kind = o.kind;
  const toolName = typeof o.toolName === "string" ? o.toolName.trim() : "";
  if (!toolName) return null;
  if (kind === "remote") {
    const remoteUrl = typeof o.remoteUrl === "string" ? o.remoteUrl.trim() : "";
    if (!remoteUrl) return null;
    return { kind: "remote", toolName, remoteUrl };
  }
  if (kind === "local") {
    const ag = o.agent;
    if (!ag || typeof ag !== "object" || Array.isArray(ag)) return null;
    const a = ag as Record<string, unknown>;
    const name = typeof a.name === "string" ? a.name.trim() : "";
    if (!name) return null;
    const tools = Array.isArray(a.tools)
      ? a.tools.filter((t): t is string => typeof t === "string" && t.length > 0)
      : undefined;
    return {
      kind: "local",
      toolName,
      agent: {
        name,
        ...(typeof a.description === "string" && a.description.trim() ? { description: a.description.trim() } : {}),
        ...(typeof a.provider === "string" && a.provider.trim() ? { provider: a.provider.trim() } : {}),
        ...(typeof a.model === "string" && a.model.trim() ? { model: a.model.trim() } : {}),
        ...(tools && tools.length > 0 ? { tools } : {}),
        ...(typeof a.maxIterations === "number" && a.maxIterations > 0 ? { maxIterations: a.maxIterations } : {}),
        ...(typeof a.systemPrompt === "string" && a.systemPrompt.trim()
          ? { systemPrompt: a.systemPrompt.trim() }
          : {}),
      },
    };
  }
  return null;
}

/** Splits comma- or newline-separated Cortex builder list fields into trimmed tokens. */
export function splitCortexListInput(raw: string | undefined): string[] {
  if (!raw || typeof raw !== "string") return [];
  const out: string[] = [];
  for (const part of raw.split(/[\n,]+/)) {
    const s = part.trim();
    if (s.length > 0) out.push(s);
  }
  return out;
}

/**
 * Merges the Builder “quick pick” `tools[]` with optional comma/newline-separated
 * extra names (Lab custom tools, uncommon builtins, typos you fix manually).
 * Used by {@link buildCortexAgent} so gateway + POST runs behave the same as the UI.
 */
export function mergeCortexUiToolNames(
  tools: readonly string[] | undefined,
  additional: string | undefined,
): string[] {
  const names = new Set<string>();
  for (const t of tools ?? []) {
    const s = typeof t === "string" ? t.trim() : "";
    if (s.length > 0) names.add(s);
  }
  for (const s of splitCortexListInput(additional)) {
    names.add(s);
  }
  return [...names];
}

/**
 * Tools the reasoning kernel itself needs to complete or inspect a run. These are
 * always whitelisted. Capability tools (web-search, file-write, code-execute, …)
 * are deliberately NOT here: the agent gets exactly the builder selection, so the
 * config the user sees is the config the agent runs with.
 */
const CORTEX_KERNEL_REQUIRED_TOOLS = ["final-answer", "task-complete", "context-status"] as const;

/** Carry `todoGuidance` only when it holds at least one explicit boolean; absent/junk drops (guidance stays off). */
function normalizeTodoGuidance(raw: unknown): { todoGuidance?: { reminder?: boolean; systemLine?: boolean } } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const g = raw as Record<string, unknown>;
  const reminder = typeof g.reminder === "boolean" ? g.reminder : undefined;
  const systemLine = typeof g.systemLine === "boolean" ? g.systemLine : undefined;
  if (reminder === undefined && systemLine === undefined) return {};
  return { todoGuidance: { ...(reminder !== undefined ? { reminder } : {}), ...(systemLine !== undefined ? { systemLine } : {}) } };
}

export type CortexMetaToolsConfig = {
  readonly enabled?: boolean;
  readonly brief?: boolean;
  readonly find?: boolean;
  readonly pulse?: boolean;
  readonly recall?: boolean;
  readonly harnessSkill?: boolean;
  /** Advisory `todo` list tool. Default off everywhere (lift-rule ruling V2); opt in via the settings toggle. */
  readonly todo?: boolean;
  /** Opt-in (experimental, default off): nudge the agent to keep its to-do list current. Only meaningful with `todo`. */
  readonly todoGuidance?: { readonly reminder?: boolean; readonly systemLine?: boolean };
};

/** `ShellExecuteConfig.commandAccess.capabilities` groups (framework `shell-execution.ts`). */
export const SHELL_COMMAND_CAPABILITIES = ["github", "web", "javascript", "python", "archive", "environment"] as const;
export type ShellCommandCapability = (typeof SHELL_COMMAND_CAPABILITIES)[number];

/**
 * Host-shell options beyond the command lists, mapped onto the framework
 * `ShellExecuteConfig` by `buildCortexAgent`. Every field is optional; absent
 * keeps the framework default (30 s timeout, 4000 chars, host substrate).
 */
export type CortexShellOptions = {
  /** Shell working directory. Resolved inside the workspace when one is set; refused if it escapes unless `allowUnsafeCwd`. */
  readonly cwd?: string;
  readonly allowUnsafeCwd?: boolean;
  readonly timeoutMs?: number;
  readonly maxOutputChars?: number;
  /** Command groups granted on top of the allowlist (`commandAccess.capabilities`). */
  readonly commandAccess?: readonly ShellCommandCapability[];
  /** `"docker"` runs each command in a throwaway hardened container (no host files). */
  readonly sandbox?: "host" | "docker";
};

const isShellCapability = (x: unknown): x is ShellCommandCapability =>
  typeof x === "string" && (SHELL_COMMAND_CAPABILITIES as readonly string[]).includes(x);

/** Parse persisted `terminalShellOptions`; junk fields drop, an all-empty object yields `undefined`. */
export function parseCortexShellOptions(raw: unknown): CortexShellOptions | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const cwd = asNonEmptyString(o.cwd);
  const timeoutMs = asFiniteNumber(o.timeoutMs);
  const maxOutputChars = asFiniteNumber(o.maxOutputChars);
  const access = Array.isArray(o.commandAccess) ? [...new Set(o.commandAccess.filter(isShellCapability))] : [];
  const out: CortexShellOptions = {
    ...(cwd !== undefined ? { cwd } : {}),
    ...(o.allowUnsafeCwd === true ? { allowUnsafeCwd: true } : {}),
    ...(timeoutMs !== undefined && timeoutMs > 0 ? { timeoutMs } : {}),
    ...(maxOutputChars !== undefined && maxOutputChars > 0 ? { maxOutputChars } : {}),
    ...(access.length > 0 ? { commandAccess: access } : {}),
    ...(o.sandbox === "docker" || o.sandbox === "host" ? { sandbox: o.sandbox } : {}),
  };
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Display-only observability toggles Cortex carries (`.withObservability({ checklist })`). */
export type CortexObservabilityConfig = {
  /** Live plan/checklist display and `ChecklistUpdated` stream events. Absent = framework default (on). */
  readonly checklist?: boolean;
};

export type CortexAgentToolEntry =
  | {
      readonly kind: "local";
      readonly toolName: string;
      readonly agent: {
        readonly name: string;
        readonly description?: string;
        readonly provider?: string;
        readonly model?: string;
        readonly tools?: readonly string[];
        readonly maxIterations?: number;
        readonly systemPrompt?: string;
      };
    }
  | { readonly kind: "remote"; readonly toolName: string; readonly remoteUrl: string };

export type CortexDynamicSubAgentsConfig = {
  readonly enabled: boolean;
  readonly maxIterations?: number;
};

export type CortexAllowedToolsExtras = {
  /** Parent-callable tool names from {@link ReactiveAgents.withAgentTool} / {@link ReactiveAgents.withRemoteAgent}. */
  readonly agentToolNames?: readonly string[];
  /** When {@link ReactiveAgents.withDynamicSubAgents} is enabled. */
  readonly spawnAgent?: boolean;
};

/**
 * Builds the `allowedTools` list for {@link ReactiveAgents.withTools}: exactly the Cortex builder
 * selection, plus the kernel's completion tools (so filtering does not block completion), any
 * Conductor meta-tools the user enabled, and sub-agent tools declared in the config.
 */
export function mergeCortexAllowedTools(
  userTools: readonly string[],
  metaTools?: CortexMetaToolsConfig,
  extras?: CortexAllowedToolsExtras,
): string[] {
  const names = new Set<string>([...userTools, ...CORTEX_KERNEL_REQUIRED_TOOLS]);
  if (metaTools?.enabled) {
    if (metaTools.brief) names.add("brief");
    if (metaTools.find) names.add("find");
    if (metaTools.pulse) names.add("pulse");
    if (metaTools.recall) names.add("recall");
    if (metaTools.todo) names.add("todo");
  }
  if (extras?.spawnAgent) names.add("spawn-agent");
  for (const n of extras?.agentToolNames ?? []) {
    const t = n.trim();
    if (t.length > 0) names.add(t);
  }
  return [...names];
}
