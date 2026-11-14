// packages/llm-provider/src/model-digest.ts
//
// Content-digest staleness for persisted per-model records. An Ollama tag is a
// mutable pointer: re-pulling `qwen3:4b` can swap the weights under the same
// name (campaign P2a: digest 2bfd38a7daaf -> 359d7dd4bcda, median cell 33 s ->
// 55 s). Any record measured against the old weights (probed capability row,
// user calibration) must stop being trusted when the live digest differs.
//
// Contract:
//   - Only records that CARRY a digest are checked. Static-table rows and
//     shipped calibrations are version-controlled claims and carry none.
//   - Decision is a pure function of (recorded, live): deterministic and
//     replayable. `unknown` (either side absent) never invalidates anything —
//     behavior is unchanged for providers without digests.
//   - A stale verdict is surfaced through the typed listener seam below (the
//     package has no event bus; composition layers forward to theirs). Nothing
//     is deleted: the live re-probe write-through overwrites the stale row.

/** Verdict of comparing a recorded digest against the live one. */
export interface DigestStaleness {
  readonly status: "fresh" | "stale" | "unknown";
  readonly recorded?: string;
  readonly live?: string;
}

/** Typed signal emitted when a persisted record is rejected for a digest change. */
export interface ModelDigestStaleEvent {
  readonly kind: "capability" | "calibration";
  readonly provider: string;
  readonly model: string;
  readonly recordedDigest: string;
  readonly liveDigest: string;
  /** Operator-facing hint: the record must be re-measured. */
  readonly action: "recalibrate";
}

/** Pure staleness decision. Absent digest on either side is `unknown`. */
export function checkDigest(
  recorded: string | undefined,
  live: string | undefined,
): DigestStaleness {
  if (recorded === undefined || live === undefined) {
    return { status: "unknown", ...(recorded !== undefined ? { recorded } : {}), ...(live !== undefined ? { live } : {}) };
  }
  return { status: recorded === live ? "fresh" : "stale", recorded, live };
}

// ─── Stale-event listener seam ───────────────────────────────────────────────

const listeners = new Set<(event: ModelDigestStaleEvent) => void>();

/** Subscribe to digest-stale signals. Returns an unsubscribe function. */
export function onModelDigestStale(
  listener: (event: ModelDigestStaleEvent) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Publish a stale signal to subscribers (listener failures are isolated). */
export function reportModelDigestStale(event: ModelDigestStaleEvent): void {
  for (const l of listeners) {
    try {
      l(event);
    } catch {
      // a faulty subscriber must never break model resolution
    }
  }
}

// ─── Live digest registry (process-wide, written by the probe) ───────────────

const liveDigests = new Map<string, string>();

/** Record the live digest observed for a model (called by provider probe code). */
export function registerLiveDigest(provider: string, model: string, digest: string): void {
  liveDigests.set(`${provider}/${model}`, digest);
}

/** Live digest observed this process, if any. */
export function getLiveDigest(provider: string, model: string): string | undefined {
  return liveDigests.get(`${provider}/${model}`);
}

/** Test seam. */
export function _resetLiveDigestsForTesting(): void {
  liveDigests.clear();
}

// ─── Ollama digest lookup ────────────────────────────────────────────────────

/** Extract a model's digest from an Ollama `/api/tags` body. */
export function digestFromTagsBody(body: unknown, model: string): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const models = (body as { models?: unknown }).models;
  if (!Array.isArray(models)) return undefined;
  const wanted = new Set([model, model.includes(":") ? model : `${model}:latest`]);
  for (const m of models) {
    if (typeof m !== "object" || m === null) continue;
    const entry = m as { name?: unknown; model?: unknown; digest?: unknown };
    const name = typeof entry.name === "string" ? entry.name : entry.model;
    if (typeof name === "string" && wanted.has(name) && typeof entry.digest === "string" && entry.digest.length > 0) {
      return entry.digest;
    }
  }
  return undefined;
}

/**
 * Fetch the live digest for an Ollama tag via `/api/tags`. Returns undefined on
 * any failure (unreachable, non-OK, malformed) — callers then treat staleness
 * as `unknown` and keep prior behavior.
 */
export async function fetchOllamaDigest(
  model: string,
  baseUrl: string,
  apiKey?: string,
): Promise<string | undefined> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${baseUrl}/api/tags`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return undefined;
    return digestFromTagsBody(await res.json(), model);
  } catch {
    return undefined;
  }
}
