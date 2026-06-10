/**
 * kernel/state/kernel-codec.ts — Lossless KernelState ⇄ JSON-string codec.
 *
 * Durable execution (v0.12.0 track 1, design spec
 * wiki/Architecture/Design-Specs/2026-06-10-durable-execution.md): crash-resume
 * requires serializing the full KernelState at iteration boundaries and
 * restoring it later. This codec is the storage-agnostic half — it produces /
 * consumes strings; persistence (RunStore, SQLite) is Phase B runtime work.
 *
 * Relationship to `kernel-state.ts` serializeKernelState/deserializeKernelState
 * (object-form, pre-existing, zero callers): those helpers are LOSSY — they drop
 * six optional fields (maxOutputTokensOverride, maxOutputTokensRecoveryCount,
 * readyToAnswerNudgeCount, environmentContext, lastMetaToolCall,
 * consecutiveMetaToolCount), pass `meta` through unsanitized, and do not revive
 * `Date` step timestamps after a JSON round-trip. This codec is the durable-
 * execution-grade replacement: full-field, deep, tagged, versioned.
 *
 * Encoding rules (applied recursively at any depth):
 *   - Map  → { "$ra": "map",  v: [[K, V], ...] }
 *   - Set  → { "$ra": "set",  v: [...] }
 *   - Date → { "$ra": "date", v: ISO-8601 string }
 *   - plain object that itself owns a "$ra" key → { "$ra": "obj", v: {...} }
 *     (escape hatch so user data can never collide with codec tags)
 *   - function / symbol / circular reference → WARN-skipped (key omitted in
 *     objects, `null` in arrays), never a crash. KernelState's own fields are
 *     all data; this guards `meta: Record<string, unknown>` smuggling.
 *   - `undefined` object values → key omitted (JSON-equivalent semantics).
 *
 * The envelope carries CODEC_VERSION for forward migration: decoding refuses a
 * NEWER version with a descriptive error; older versions migrate here later.
 */
import type { KernelState } from "./kernel-state.js";

/** Bump when the encoding scheme changes shape. Decoder refuses newer versions. */
export const KERNEL_CODEC_VERSION = 1;

/** Reserved tag key — see escape-hatch rule above. */
const TAG = "$ra";

/** JSON-compatible value produced by the encoder. */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Sentinel returned by encodeValue for values that cannot be represented. */
const SKIP: unique symbol = Symbol("kernel-codec-skip");

const warn = (path: string, reason: string): void => {
  console.warn(`[kernel-codec] Skipped non-serializable value at ${path}: ${reason}`);
};

const isPlainRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Recursively encode an arbitrary value into a JSON-safe tagged form.
 * `seen` tracks the CURRENT ancestor chain (push/pop) — true cycles are
 * skipped with a warning; shared (DAG) references are duplicated, which is
 * correct for a value codec.
 */
function encodeValue(value: unknown, path: string, seen: Set<object>): JsonValue | typeof SKIP {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      if (!Number.isFinite(value)) {
        warn(path, `non-finite number (${String(value)})`);
        return SKIP;
      }
      return value;
    case "undefined":
      return SKIP;
    case "function":
      warn(path, "function");
      return SKIP;
    case "symbol":
      warn(path, "symbol");
      return SKIP;
    case "bigint":
      warn(path, "bigint");
      return SKIP;
    default:
      break;
  }

  const obj = value as object;
  if (seen.has(obj)) {
    warn(path, "circular reference");
    return SKIP;
  }

  if (obj instanceof Date) {
    return { [TAG]: "date", v: obj.toISOString() };
  }

  seen.add(obj);
  try {
    if (obj instanceof Map) {
      const entries: JsonValue[] = [];
      for (const [k, v] of obj as Map<unknown, unknown>) {
        const ek = encodeValue(k, `${path}.<key>`, seen);
        const ev = encodeValue(v, `${path}[${String(k)}]`, seen);
        if (ek === SKIP || ev === SKIP) continue; // warned inside
        entries.push([ek, ev]);
      }
      return { [TAG]: "map", v: entries };
    }
    if (obj instanceof Set) {
      const values: JsonValue[] = [];
      for (const v of obj as Set<unknown>) {
        const ev = encodeValue(v, `${path}.<set>`, seen);
        if (ev === SKIP) continue;
        values.push(ev);
      }
      return { [TAG]: "set", v: values };
    }
    if (Array.isArray(obj)) {
      return obj.map((v, i) => {
        const ev = encodeValue(v, `${path}[${i}]`, seen);
        return ev === SKIP ? null : ev;
      });
    }
    // Plain object (or class instance — encoded by own enumerable props).
    const out: { [key: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(obj)) {
      const ev = encodeValue(v, `${path}.${k}`, seen);
      if (ev === SKIP) continue;
      out[k] = ev;
    }
    if (Object.prototype.hasOwnProperty.call(obj, TAG)) {
      return { [TAG]: "obj", v: out };
    }
    return out;
  } finally {
    seen.delete(obj);
  }
}

/** Recursively decode a tagged JSON value back into runtime form. */
function decodeValue(value: JsonValue): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(decodeValue);

  const tag = value[TAG];
  if (typeof tag === "string") {
    const payload = (value as { v?: JsonValue }).v;
    switch (tag) {
      case "date":
        return new Date(payload as string);
      case "map": {
        const m = new Map<unknown, unknown>();
        for (const entry of (payload as JsonValue[]) ?? []) {
          const [k, v] = entry as [JsonValue, JsonValue];
          m.set(decodeValue(k), decodeValue(v));
        }
        return m;
      }
      case "set": {
        const s = new Set<unknown>();
        for (const v of (payload as JsonValue[]) ?? []) s.add(decodeValue(v));
        return s;
      }
      case "obj":
        return decodeValue(payload ?? {});
      default:
        // Unknown tag from a same-version producer — preserve as data.
        break;
    }
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = decodeValue(v);
  }
  return out;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Serialize a KernelState into a versioned JSON-string envelope.
 * Lossless for all data fields (Map/Set/Date tagged); non-serializable values
 * (functions, symbols, circulars — only reachable via `meta`'s unknown bag)
 * are WARN-skipped, never a crash.
 */
export function serializeKernelState(state: KernelState): string {
  const encoded = encodeValue(state, "state", new Set<object>());
  // KernelState is an object — encodeValue can only SKIP non-objects.
  const envelope = { codecVersion: KERNEL_CODEC_VERSION, state: encoded === SKIP ? null : encoded };
  return JSON.stringify(envelope);
}

/**
 * Reconstruct a KernelState from a codec envelope produced by
 * {@link serializeKernelState}. Throws a descriptive Error on corrupt input or
 * a NEWER codec version (forward-migration guard); callers in Effect paths
 * should wrap with Effect.try.
 */
export function deserializeKernelState(json: string): KernelState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `[kernel-codec] Corrupt envelope — not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!isPlainRecord(parsed) || typeof parsed["codecVersion"] !== "number" || !("state" in parsed)) {
    throw new Error(
      "[kernel-codec] Invalid envelope — expected { codecVersion: number, state: object }",
    );
  }
  const version = parsed["codecVersion"];
  if (version > KERNEL_CODEC_VERSION) {
    throw new Error(
      `[kernel-codec] Envelope codec version ${version} is newer than supported version ${KERNEL_CODEC_VERSION} — upgrade the framework to restore this run`,
    );
  }
  const decoded = decodeValue(parsed["state"] as JsonValue);
  if (!isPlainRecord(decoded)) {
    throw new Error("[kernel-codec] Invalid envelope — decoded state is not an object");
  }
  return decoded as unknown as KernelState;
}
