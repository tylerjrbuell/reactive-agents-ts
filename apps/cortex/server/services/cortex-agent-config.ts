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

  return out;
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

/**
 * Builds the `allowedTools` list for {@link ReactiveAgents.withTools}: Cortex builder selections
 * plus framework tools the reasoning kernel may execute or inject (so filtering does not block
 * completion), and any Conductor meta-tools the user enabled.
 */
export function mergeCortexAllowedTools(
  userTools: readonly string[],
  metaTools?: CortexMetaToolsConfig,
): string[] {
  const names = new Set<string>([...userTools, ...CORTEX_FRAMEWORK_ALLOWED_TOOLS]);
  if (metaTools?.enabled) {
    if (metaTools.brief) names.add("brief");
    if (metaTools.find) names.add("find");
    if (metaTools.pulse) names.add("pulse");
    if (metaTools.recall) names.add("recall");
  }
  return [...names];
}
