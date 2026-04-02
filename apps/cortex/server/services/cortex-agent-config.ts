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
