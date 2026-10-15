/**
 * ModelCalibration — per-model behavior measurements that drive harness adaptation.
 *
 * Calibration data answers questions that cannot be derived from model card, tier,
 * or general LLM knowledge. Live downstream consumers (verified 2026-07-19):
 *
 * - parallelCallCapability → blueprint strategy batch cap (blueprint.ts)
 * - observationHandling → recall force-on (think.ts) + hallucinate-risk
 *   scaffolding/verifier bump (harness-plan.ts)
 * - systemPromptAttention → weak-attention scaffolding bump (harness-plan.ts)
 * - optimalToolResultChars → ProfileOverrides.toolResultMaxChars, applied to
 *   the runtime ContextProfile (kernel loop runner)
 * - classifierReliability → classifier bypass (runtime classifier-bypass.ts)
 *
 * (An earlier ContextManager.build() consumer for steeringCompliance was
 * deleted in `279b61fb`; the field remains measured for future spine work.)
 */
import { Schema } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ProviderAdapter } from "./adapter.js";
import type { ToolCallObservation } from "@reactive-agents/memory";

/**
 * Structural shape for ContextProfile fields that calibration may override.
 * Kept minimal here to avoid a runtime dependency on @reactive-agents/reasoning.
 * Downstream callers spread this into their full ContextProfile.
 */
export interface ProfileOverrides {
  toolResultMaxChars?: number;
  toolResultPreviewItems?: number;
  maxIterations?: number;
  temperature?: number;
  maxTokens?: number;
}

// ── Schema ────────────────────────────────────────────────────────────────────

export const ModelCalibrationSchema = Schema.Struct({
  /** The model identifier (e.g., "gemma4:e4b", "llama3.2:3b") */
  modelId: Schema.String,

  /** ISO timestamp of calibration run */
  calibratedAt: Schema.String,

  /** Probe suite version — old calibrations degrade gracefully when this increments */
  probeVersion: Schema.Number,

  /** Number of probe runs averaged for stability */
  runsAveraged: Schema.Number,

  /** Does this model follow steering better in system prompt, user message, or both? */
  steeringCompliance: Schema.Literal("system-prompt", "user-message", "hybrid"),

  /** Can this model reliably batch independent tool calls in one turn? */
  parallelCallCapability: Schema.Literal("reliable", "partial", "sequential-only"),

  /** Given compressed preview + recall hint, does it call recall or hallucinate? */
  observationHandling: Schema.Literal("uses-recall", "needs-inline-facts", "hallucinate-risk"),

  /** After 4+ turns, does the model still follow system prompt rules? */
  systemPromptAttention: Schema.Literal("strong", "moderate", "weak"),

  /** Optimal chars per tool result before hallucination starts */
  optimalToolResultChars: Schema.Number,

  /** Derived from observed classifier false-positive rate. "low" → skip the classifier LLM call. */
  classifierReliability: Schema.optionalWith(
    Schema.Literal("high", "low", "skip"),
    { exact: true },
  ),

  // ── Tool calling dialect ──
  toolCallDialect: Schema.optionalWith(
    Schema.Literal("native-fc", "text-parse", "none"),
    { exact: true, default: () => "none" as const },
  ),

  // ── Learned alias maps (populated after N≥3 observations) ──
  knownToolAliases: Schema.optionalWith(
    Schema.Record({ key: Schema.String, value: Schema.String }),
    { exact: true },
  ),
  knownParamAliases: Schema.optionalWith(
    Schema.Record({
      key: Schema.String,
      value: Schema.Record({ key: Schema.String, value: Schema.String }),
    }),
    { exact: true },
  ),
});

export type ModelCalibration = typeof ModelCalibrationSchema.Type;

// ── Loader ────────────────────────────────────────────────────────────────────

const calibrationCache = new Map<string, ModelCalibration | null>();
const dialectClaimCache = new Map<string, DialectPriorClaim | null>();

/**
 * Normalize a model ID for filename matching.
 * Examples: "gemma4:e4b" → "gemma4-e4b", "Llama3.2:3B" → "llama3.2-3b"
 */
export function normalizeModelId(modelId: string): string {
  return modelId.toLowerCase().replace(/:/g, "-").replace(/\s+/g, "-");
}

/**
 * Candidate file paths for a model's calibration JSON, in precedence order:
 * pre-baked (from src or dist module dir) then the user cache. Shared by
 * {@link loadCalibration} and {@link loadDialectPriorClaim} so both read the
 * exact same file.
 */
function calibrationCandidatePaths(modelId: string): string[] {
  const key = normalizeModelId(modelId);
  const prebakedCandidates: string[] = [];
  // Try pre-baked calibrations shipped with framework.
  // When running from source, import.meta.url resolves to src/calibration.ts → src/calibrations/<key>.json.
  // When running from dist, it resolves to dist/index.js → dist/calibrations/ (populated by build) or
  // ../src/calibrations/ as a fallback (for test/dev scenarios where dist was produced without copying).
  // import.meta.url is undefined on some bundled edge runtimes (e.g. workerd),
  // so this must not throw — fall through to just the user cache path there.
  try {
    const moduleDir = path.dirname(new URL(import.meta.url).pathname);
    prebakedCandidates.push(
      path.join(moduleDir, "calibrations", `${key}.json`),
      path.join(moduleDir, "..", "src", "calibrations", `${key}.json`),
    );
  } catch {
    // no resolvable module URL — skip pre-baked lookup
  }

  // Try user cache
  const userHome = process.env.HOME ?? "~";
  prebakedCandidates.push(path.join(userHome, ".reactive-agents", "calibrations", `${key}.json`));
  return prebakedCandidates;
}

/**
 * An EXPLICIT dialect claim from a calibration prior. GH #243: the schema
 * default (`toolCallDialect` absent → `"none"`) turned every pre-May prior
 * into a phantom "none" claim that could strand a tool-capable model. A prior
 * may influence routing ONLY when the field is literally present in the file.
 */
export interface DialectPriorClaim {
  readonly dialect: "native-fc" | "text-parse" | "none";
  readonly runsAveraged: number;
}

/**
 * Read the raw calibration JSON for an explicit `toolCallDialect` claim.
 * Returns undefined when no file exists OR the file omits the field — the
 * schema default is NOT treated as a claim (see {@link DialectPriorClaim}).
 * `runsAveraged` defaults to 0 when absent/non-numeric (zero confidence).
 */
export function loadDialectPriorClaim(modelId: string): DialectPriorClaim | undefined {
  const key = normalizeModelId(modelId);
  if (dialectClaimCache.has(key)) return dialectClaimCache.get(key) ?? undefined;
  let claim: DialectPriorClaim | null = null;
  for (const candidatePath of calibrationCandidatePaths(modelId)) {
    try {
      if (!fs.existsSync(candidatePath)) continue;
      const data = JSON.parse(fs.readFileSync(candidatePath, "utf-8")) as Record<string, unknown>;
      const dialect = data.toolCallDialect;
      if (dialect === "native-fc" || dialect === "text-parse" || dialect === "none") {
        const runs = data.runsAveraged;
        claim = {
          dialect,
          runsAveraged: typeof runs === "number" && Number.isFinite(runs) ? runs : 0,
        };
      }
      // First existing file wins (explicit or not) — same precedence as
      // loadCalibration, which also stops at the first readable file.
      break;
    } catch {
      // Ignore parse errors, try next path
    }
  }
  dialectClaimCache.set(key, claim);
  return claim ?? undefined;
}

/**
 * Load a pre-baked or cached calibration for the given modelId.
 * Returns undefined if no calibration exists.
 *
 * Lookup order:
 *   1. In-memory cache (per process)
 *   2. Pre-baked JSON in packages/llm-provider/src/calibrations/<normalized-id>.json
 *   3. User cache at ~/.reactive-agents/calibrations/<normalized-id>.json
 */
export function loadCalibration(modelId: string): ModelCalibration | undefined {
  const key = normalizeModelId(modelId);
  if (calibrationCache.has(key)) return calibrationCache.get(key) ?? undefined;

  for (const candidatePath of calibrationCandidatePaths(modelId)) {
    try {
      if (!fs.existsSync(candidatePath)) continue;
      const data = JSON.parse(fs.readFileSync(candidatePath, "utf-8"));
      const cal = Schema.decodeUnknownSync(ModelCalibrationSchema)(data);
      calibrationCache.set(key, cal);
      return cal;
    } catch {
      // Ignore parse errors, try next path
    }
  }

  calibrationCache.set(key, null);
  return undefined;
}

/**
 * Clear the in-memory calibration cache. Primarily for testing.
 */
export function clearCalibrationCache(): void {
  calibrationCache.clear();
  dialectClaimCache.clear();
}

// ── Compile calibration to adapter + profile overrides ───────────────────────

/**
 * Compile a ModelCalibration into a runtime ProviderAdapter overlay +
 * ProfileOverrides.
 *
 * The adapter overlay is layered ON TOP of the tier adapter by
 * `selectAdapter` (see `composeAdapters` in adapter.js) — it can refine tier
 * behavior but never removes it. Today the overlay is EMPTY: every measured
 * behavioral intent is delivered through a live non-adapter channel instead
 * (see module header — harness-plan scaffolding, blueprint batch cap, recall
 * force-on). Earlier versions compiled `systemPromptPatch` / `toolGuidance`
 * overrides here, but those hooks lost their only call sites in `279b61fb`
 * and were removed from the ProviderAdapter contract (2026-07-19); the writes
 * were dead. If a future calibration field needs per-turn prompt shaping,
 * add the hook back WITH a kernel call site first, then compile it here.
 *
 * profileOverrides apply to the runtime ContextProfile (tool result sizing)
 * and ARE read — the kernel loop runner spreads them into the active profile.
 */
export function buildCalibratedAdapter(
  calibration: ModelCalibration,
): { adapter: ProviderAdapter; profileOverrides: ProfileOverrides } {
  const adapter: ProviderAdapter = {};

  const profileOverrides: ProfileOverrides = {
    toolResultMaxChars: calibration.optimalToolResultChars,
  };

  return { adapter, profileOverrides };
}

// ── Alias Accumulation ──────────────────────────────────────────────────────

export const ALIAS_FREQUENCY_THRESHOLD = 3;

export interface AliasObservationState {
  readonly [attemptedName: string]: Readonly<{ target: string; count: number }>;
}

export function shouldWriteAlias(count: number): boolean {
  return count >= ALIAS_FREQUENCY_THRESHOLD;
}

export function accumulateAliasObservation(
  state: AliasObservationState,
  attempted: string,
  resolved: string,
): AliasObservationState {
  const existing = state[attempted];
  return {
    ...state,
    [attempted]: { target: resolved, count: (existing?.count ?? 0) + 1 },
  };
}

/** Returns the alias entries that have reached the frequency threshold. */
export function confirmedAliases(state: AliasObservationState): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [attempted, { target, count }] of Object.entries(state)) {
    if (shouldWriteAlias(count)) result[attempted] = target;
  }
  return result;
}

// ── Experience Summary ────────────────────────────────────────────────────────

export interface ExperienceSummary {
  readonly topWorkingParamPatterns: ReadonlyArray<{
    readonly tool: string;
    readonly params: Record<string, unknown>;
    readonly successRate: number;
    readonly occurrences: number;
  }>;
  readonly topErrorPatterns: ReadonlyArray<{
    readonly tool: string;
    readonly error: string;
    readonly recovery: string;
    readonly occurrences: number;
  }>;
  readonly lastUpdated: string;
}

export function materializeExperienceSummary(
  observations: readonly ToolCallObservation[],
): ExperienceSummary {
  const successByTool = new Map<string, Array<Record<string, unknown>>>();
  const errorByTool = new Map<string, Array<{ error: string; healing: string }>>();

  for (const obs of observations) {
    const tool = obs.toolNameResolved ?? obs.toolNameAttempted;
    if (obs.succeeded) {
      const existing = successByTool.get(tool) ?? [];
      existing.push(obs.paramsResolved);
      successByTool.set(tool, existing);
    } else if (obs.errorText) {
      const existing = errorByTool.get(tool) ?? [];
      const healing = obs.healingApplied
        .map((a) => `Use \`${a.to}\` not \`${a.from}\``)
        .join("; ");
      existing.push({ error: obs.errorText, healing });
      errorByTool.set(tool, existing);
    }
  }

  const topWorkingParamPatterns = [...successByTool.entries()].map(([tool, params]) => ({
    tool,
    params: params[0] ?? {},
    successRate: 1, // always 1.0 — only succeeded observations are stored here
    occurrences: params.length,
  }));

  const topErrorPatterns = [...errorByTool.entries()].flatMap(([tool, errors]) =>
    errors.map((e) => ({ tool, error: e.error, recovery: e.healing, occurrences: 1 })),
  );

  return { topWorkingParamPatterns, topErrorPatterns, lastUpdated: new Date().toISOString() };
}

export function formatToolGuidanceFromSummary(
  summary: ExperienceSummary | null,
  activeToolNames: readonly string[],
): string {
  if (!summary) return "";

  const relevantErrors = summary.topErrorPatterns.filter(
    (e) => activeToolNames.includes(e.tool) && e.recovery,
  );
  if (relevantErrors.length === 0) return "";

  const lines = ["Observed tool call patterns:"];
  for (const pattern of relevantErrors.slice(0, 3)) {
    lines.push(`- ${pattern.tool}: ${pattern.recovery}`);
  }
  return lines.join("\n");
}

