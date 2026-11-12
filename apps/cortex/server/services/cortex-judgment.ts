/**
 * Judgment settings for a Cortex agent (Lab · Judgment) and the TypeSafe catalog call.
 *
 * `.withJudgment()` has no AgentConfig form (runtime `AgentConfigSchema` has no
 * `judgment` field: framework gap, reported), so `judgment` is a true overlay applied in
 * `cortexAgentBuilder` (listed in `CORTEX_OVERLAY_CALLS`). The saved TypeSafe key is a
 * secret and rides the same overlay; it never enters an AgentConfig.
 *
 * Stored shape (`config.judgment`): only an enabled config is kept. Off is "absent",
 * because the framework only wires a `JudgmentService` when `.withJudgment()` is called.
 */
import { ReactiveAgents, type JudgmentBuilderOptions, type JudgmentModel } from "@reactive-agents/runtime";
import { Effect, Either } from "effect";

/** Id of the TypeSafe key in the provider key store (Settings · Providers). */
export const TYPESAFE_KEY_ID = "typesafe";

/** The backends the framework knows (`JudgmentBackendName`). */
export const JUDGMENT_BACKENDS = ["jev", "ollama", "llm"] as const;
export type CortexJudgmentBackend = (typeof JUDGMENT_BACKENDS)[number];

/** A judgment setup a desk user turned on. Absent fields keep the framework default. */
export interface CortexJudgmentConfig {
  readonly enabled: true;
  /** Absent = the framework default: `jev` when a TypeSafe key resolves, else `llm` (uncalibrated). */
  readonly backend?: CortexJudgmentBackend;
  /** Backend model id (jev catalog name, Ollama model such as `nimble`). */
  readonly model?: string;
  /** Per-request timeout in ms (framework default 3000 for jev, 30000 for Ollama). */
  readonly timeoutMs?: number;
  /** Backend base URL (TypeSafe API root for jev, Ollama server root for ollama). */
  readonly baseUrl?: string;
  /** Ollama `keep_alive` (seconds, or a `"5m"` style string). Only used by the ollama backend. */
  readonly keepAlive?: string | number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Read a stored/posted `judgment` value. Anything that is not an object with
 * `enabled: true` means judgment is off (undefined); unknown backends and bad numbers drop.
 */
export function parseCortexJudgmentConfig(raw: unknown): CortexJudgmentConfig | undefined {
  if (!isRecord(raw) || raw.enabled !== true) return undefined;
  const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
  const backend = JUDGMENT_BACKENDS.find((b) => b === raw.backend);
  const timeoutMs = typeof raw.timeoutMs === "number" && Number.isFinite(raw.timeoutMs) && raw.timeoutMs > 0 ? raw.timeoutMs : undefined;
  const keepAliveText = text(raw.keepAlive);
  const keepAlive =
    typeof raw.keepAlive === "number" && Number.isFinite(raw.keepAlive)
      ? raw.keepAlive
      : keepAliveText !== undefined && /^-?\d+$/.test(keepAliveText)
        ? Number(keepAliveText)
        : keepAliveText;
  const model = text(raw.model);
  const baseUrl = text(raw.baseUrl);
  return {
    enabled: true,
    ...(backend ? { backend } : {}),
    ...(model ? { model } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(keepAlive !== undefined ? { keepAlive } : {}),
  };
}

/**
 * `.withJudgment()` options for a config. `apiKey` is the saved TypeSafe key when it should
 * apply (absent: the framework falls back to `TYPESAFE_API_KEY`). `ollama.keepAlive` is
 * passed only for the ollama backend, as the framework documents.
 */
export function judgmentBuilderOptionsOf(cfg: CortexJudgmentConfig, apiKey?: string): JudgmentBuilderOptions {
  return {
    ...(apiKey ? { apiKey } : {}),
    ...(cfg.backend ? { backend: cfg.backend } : {}),
    ...(cfg.model ? { model: cfg.model } : {}),
    ...(cfg.timeoutMs !== undefined ? { timeoutMs: cfg.timeoutMs } : {}),
    ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}),
    ...(cfg.backend === "ollama" && cfg.keepAlive !== undefined ? { ollama: { keepAlive: cfg.keepAlive } } : {}),
  };
}

/** Result of listing the TypeSafe model catalog. */
export type JudgmentCatalogResult =
  | { readonly ok: true; readonly models: ReadonlyArray<JudgmentModel> }
  | { readonly ok: false; readonly message: string };

/** Lists the TypeSafe (Jev) model catalog with a key; injectable for tests (no network). */
export type ListJudgmentCatalog = (opts: { readonly apiKey?: string; readonly baseUrl?: string }) => Promise<JudgmentCatalogResult>;

/**
 * The framework's own catalog call (`agent.listJudgmentModels()`) on a throwaway
 * `test`-provider agent built with `.withJudgment({ backend: "jev" })`. It reads the
 * catalog only: no `ask`, so no judgment is billed.
 */
export const listJudgmentCatalog: ListJudgmentCatalog = ({ apiKey, baseUrl }) =>
  Effect.runPromise(
    Effect.either(
      Effect.tryPromise({
        try: async () => {
          const agent = await ReactiveAgents.create()
            .withName("cortex-judgment-catalog")
            .withProvider("test")
            .withJudgment({ backend: "jev", ...(apiKey ? { apiKey } : {}), ...(baseUrl ? { baseUrl } : {}), timeoutMs: 8_000 })
            .build();
          try {
            return await agent.listJudgmentModels();
          } finally {
            await agent.dispose();
          }
        },
        catch: (e) => (e instanceof Error ? e.message : String(e)),
      }),
    ).pipe(
      Effect.map((r): JudgmentCatalogResult => (Either.isRight(r) ? { ok: true, models: r.right } : { ok: false, message: r.left })),
    ),
  );
