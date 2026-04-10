/**
 * Normalizes Cortex UI agent `config` blobs before building `ReactiveAgents`.
 * SQLite/JSON round-trips and older clients can leave numbers as strings; some
 * fields (e.g. `temperature: 0`) must not be treated as "missing" via truthiness checks.
 */

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

/** Living skills / SKILL.md paths + optional evolution options for `withSkills`. */
export type CortexSkillsConfig = {
  readonly paths: readonly string[];
  readonly evolution?: {
    readonly mode?: string;
    readonly refinementThreshold?: number;
    readonly rollbackOnRegression?: boolean;
  };
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

  const evRaw = o.evolution;
  if (!evRaw || typeof evRaw !== "object" || Array.isArray(evRaw)) {
    return { paths };
  }
  const e = evRaw as Record<string, unknown>;
  const mode = typeof e.mode === "string" && e.mode.trim() ? e.mode.trim() : undefined;
  const refinementThreshold = asFiniteNumber(e.refinementThreshold);
  const rollbackOnRegression = e.rollbackOnRegression === true;
  if (!mode && refinementThreshold === undefined && !rollbackOnRegression) {
    return { paths };
  }
  return {
    paths,
    evolution: {
      ...(mode ? { mode } : {}),
      ...(refinementThreshold !== undefined ? { refinementThreshold } : {}),
      ...(rollbackOnRegression ? { rollbackOnRegression: true } : {}),
    },
  };
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
  n("maxIterations");
  n("minIterations");
  n("timeout");
  n("cacheTimeout");
  n("progressCheckpoint");

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
    const providers = asStringArray(o.providers);
    out.fallbacks = {
      enabled: o.enabled === true,
      ...(providers ? { providers } : {}),
      ...(asFiniteNumber(o.errorThreshold) !== undefined
        ? { errorThreshold: asFiniteNumber(o.errorThreshold) }
        : {}),
    };
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
    };
  }

  const vs = raw.verificationStep;
  if (vs === "none" || vs === "reflect" || vs === undefined) {
    out.verificationStep = vs;
  } else if (typeof vs === "string") {
    out.verificationStep = vs === "reflect" ? "reflect" : "none";
  }

  if (raw.runtimeVerification === true) out.runtimeVerification = true;
  else delete out.runtimeVerification;

  if (raw.terminalTools === true) out.terminalTools = true;
  else delete out.terminalTools;

  const mids = raw.mcpServerIds;
  if (Array.isArray(mids)) {
    const ids = mids.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
    if (ids.length > 0) out.mcpServerIds = ids;
  }

  const at = raw.agentTools;
  if (Array.isArray(at)) {
    const parsed = at.map(parseAgentToolEntry).filter((x): x is CortexAgentToolEntry => x != null);
    if (parsed.length > 0) out.agentTools = parsed;
  }

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
      ...(skillsParsed.evolution ? { evolution: { ...skillsParsed.evolution } } : {}),
    };
  } else delete out.skills;

  // ── Five previously dead-end fields ─────────────────────────────────────

  out.strategySwitching = raw.strategySwitching === true;

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
    out.guardrails = {
      enabled: g.enabled === true,
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

/** Conductor / kernel tools that must stay callable when `allowedTools` filtering is on. */
const CORTEX_FRAMEWORK_ALLOWED_TOOLS = [
  "final-answer",
  "task-complete",
  "context-status",
] as const;

export type CortexMetaToolsConfig = {
  readonly enabled?: boolean;
  readonly brief?: boolean;
  readonly find?: boolean;
  readonly pulse?: boolean;
  readonly recall?: boolean;
  readonly harnessSkill?: boolean;
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
 * Builds the `allowedTools` list for {@link ReactiveAgents.withTools}: Cortex builder selections
 * plus framework tools the reasoning kernel may execute or inject (so filtering does not block
 * completion), and any Conductor meta-tools the user enabled.
 */
export function mergeCortexAllowedTools(
  userTools: readonly string[],
  metaTools?: CortexMetaToolsConfig,
  extras?: CortexAllowedToolsExtras,
): string[] {
  const names = new Set<string>([...userTools, ...CORTEX_FRAMEWORK_ALLOWED_TOOLS]);
  if (metaTools?.enabled) {
    if (metaTools.brief) names.add("brief");
    if (metaTools.find) names.add("find");
    if (metaTools.pulse) names.add("pulse");
    if (metaTools.recall) names.add("recall");
  }
  if (extras?.spawnAgent) names.add("spawn-agent");
  for (const n of extras?.agentToolNames ?? []) {
    const t = n.trim();
    if (t.length > 0) names.add(t);
  }
  return [...names];
}
