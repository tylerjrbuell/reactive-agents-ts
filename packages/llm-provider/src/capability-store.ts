// packages/llm-provider/src/capability-store.ts
//
// Wave 2a S2.4-proper (2026-10-13) — persistent capability store. Closes the
// write-through deferred at `providers/local-probe.ts` ("CalibrationStore
// write-through (cross-process) lands in S2.4"): probe results are persisted
// per (provider, model, endpoint) so a process restart doesn't re-probe the
// world.
//
// Why this lives in llm-provider instead of reusing `CalibrationStore`
// directly: CalibrationStore lives in `@reactive-agents/reactive-intelligence`
// and llm-provider MUST NOT import from RI (circular package dep — see the
// capability-resolver.ts header). The store therefore satisfies the same
// duck-typed `CapabilityCache` contract, and a real CalibrationStore (whose
// saveCapability/loadCapability signatures match structurally) can be injected
// via `setCapabilityStore()` at boot by any composition layer.
//
// Default implementation: JSON files under
//   $REACTIVE_AGENTS_CAPABILITY_STORE_DIR ?? ~/.reactive-agents/capabilities/
// mirroring the existing user-cache convention in calibration.ts
// (~/.reactive-agents/calibrations/<normalized-id>.json). One file per
// (provider, model, endpoint), content is the Capability struct itself,
// re-validated through `CapabilitySchema` on read so a corrupt or
// schema-drifted row can never poison the resolver — bad rows fall through to
// a fresh probe.
//
// W2a review hardening (2026-10-13 round 1):
//   - Rows are ENDPOINT-SCOPED: the file key folds a sanitized form of the
//     probe baseUrl. Two Ollama servers publishing the same tag with
//     different quantizations can never cross-serve rows (the baseUrl-less key
//     format pre-fix could, forever — no TTL). Pre-existing baseUrl-less rows
//     are simply unreachable (treated as a miss; the next probe writes the
//     scoped row — self-heal, no migration).
//   - Keys are SANITIZED against path escape: any character outside
//     [a-z0-9-] (model or provider names carrying "/" or ".." tricks) folds
//     to "-", so a hostile/odd model tag can never write outside the store dir.
//   - Writes are ATOMIC (tmp file + rename): a crash mid-write can't leave a
//     torn row that decodes to garbage on every future start.
//   - `REACTIVE_AGENTS_CAPABILITY_STORE_DISABLE=1` turns the default store
//     into a no-op (reads miss, writes drop — in-memory cache only). This is
//     the cross-suite contamination seam: any test harness that fetch-mocks
//     /api/show can pin this env var so mocked probes never persist fixture
//     rows into a real `~/.reactive-agents/capabilities/`. Explicit
//     `setCapabilityStore()` injections are honored regardless (the caller
//     owns that intent).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Schema } from "effect";
import { CapabilitySchema, type Capability } from "./capability.js";
import { normalizeModelId } from "./calibration.js";
import type { CapabilityCache } from "./capability-resolver.js";

// Re-export so probe code can type against the same contract the resolver
// uses (structural — a CalibrationStore satisfies it too).
export type { CapabilityCache };

/**
 * True when the default file-backed persistence is disabled via
 * `REACTIVE_AGENTS_CAPABILITY_STORE_DISABLE=1` (cross-suite test seam).
 */
export function isCapabilityStoreDisabled(): boolean {
  return process.env.REACTIVE_AGENTS_CAPABILITY_STORE_DISABLE === "1";
}

// ─── Directory resolution ─────────────────────────────────────────────────────

let storeDirOverride: string | null = null;

function capabilityStoreDir(): string {
  if (storeDirOverride) return storeDirOverride;
  const envDir = process.env.REACTIVE_AGENTS_CAPABILITY_STORE_DIR;
  if (envDir && envDir.length > 0) return envDir;
  const home = process.env.HOME ?? os.homedir();
  return path.join(home, ".reactive-agents", "capabilities");
}

/**
 * Fold the baseUrl into the row key. A sanitized suffix keeps the filename
 * human-scannable (`http://localhost:11434` → `http-localhost-11434`) while
 * staying injective enough for the realistic two-endpoint case. Empty when no
 * endpoint is given (callers that resolve by (provider, model) only).
 */
function endpointKey(endpoint: string | undefined): string {
  if (!endpoint || endpoint.trim().length === 0) return "";
  return `-${sanitizeKeyPart(endpoint)}`;
}

/**
 * Sanitize one key component. Runs the shared model-id normalization first
 * (lowercase, ":" → "-") for convention-compatibility, then folds EVERY other
 * non-[a-z0-9-] character (path separators, dots, colons in URLs, unicode) to
 * "-" — a key can never contain "/" or ".." and escape the store directory.
 */
function sanitizeKeyPart(value: string): string {
  return normalizeModelId(value).replace(/[^a-z0-9-]/g, "-");
}

function rowFileName(provider: string, model: string, endpoint?: string): string {
  return `${sanitizeKeyPart(provider)}-${sanitizeKeyPart(model)}${endpointKey(endpoint)}.json`;
}

// ─── File-backed store ────────────────────────────────────────────────────────

/**
 * Build a file-backed CapabilityCache rooted at `dir`. Exported so tests and
 * composition layers can construct stores at explicit paths.
 */
export function makeFileCapabilityStore(dir: string): CapabilityCache {
  return {
    saveCapability(cap: Capability, endpoint?: string): void {
      try {
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(
          dir,
          rowFileName(cap.provider, cap.model, endpoint),
        );
        const tmp = `${file}.${process.pid}.tmp`;
        // Atomic: write to a sibling tmp file, then rename. A process killed
        // mid-write leaves a stray .tmp, never a torn row that would decode
        // (and fail) forever under the real key.
        fs.writeFileSync(tmp, JSON.stringify(cap, null, 2), "utf-8");
        fs.renameSync(tmp, file);
      } catch {
        // Persistence is best-effort: a read-only home dir or full disk must
        // never fail an agent run whose probe already succeeded.
      }
    },
    loadCapability(provider: string, model: string, endpoint?: string): Capability | null {
      try {
        const file = path.join(dir, rowFileName(provider, model, endpoint));
        if (!fs.existsSync(file)) return null;
        const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as unknown;
        // Re-validate on read: corrupt rows or rows from an older schema
        // version decode to a failure → treated as a cache miss (re-probe).
        const decoded = Schema.decodeUnknownSync(CapabilitySchema)(raw);
        return decoded;
      } catch {
        return null;
      }
    },
  };
}

const defaultFileStore: CapabilityCache = {
  saveCapability: (cap, endpoint) =>
    makeFileCapabilityStore(capabilityStoreDir()).saveCapability(cap, endpoint),
  loadCapability: (provider, model, endpoint) =>
    makeFileCapabilityStore(capabilityStoreDir()).loadCapability(provider, model, endpoint),
};

/**
 * In-memory-only no-op store, active while
 * `REACTIVE_AGENTS_CAPABILITY_STORE_DISABLE=1` (see module header — the
 * cross-suite contamination seam).
 */
const NOOP_STORE: CapabilityCache = {
  loadCapability: () => null,
  saveCapability: () => {
    /* persistence intentionally disabled */
  },
};

// ─── Active store (injectable) ────────────────────────────────────────────────

let activeStore: CapabilityCache = defaultFileStore;

/**
 * The store the probe path writes through to and reads from. Defaults to the
 * JSON file store under `~/.reactive-agents/capabilities/` (a no-op store
 * while `REACTIVE_AGENTS_CAPABILITY_STORE_DISABLE=1`); override with
 * `setCapabilityStore` to plug a `CalibrationStore` (or any duck-typed
 * `CapabilityCache`) at composition time.
 */
export function getCapabilityStore(): CapabilityCache {
  if (isCapabilityStoreDisabled()) return NOOP_STORE;
  return activeStore;
}

/**
 * Injection seam: replace the active capability store (pass `null` to restore
 * the default file store). A `CalibrationStore` from
 * `@reactive-agents/reactive-intelligence` satisfies `CapabilityCache`
 * structurally and can be passed here without a package dependency. An
 * explicit injection is honored even under the disable env (the caller owns
 * that intent).
 */
export function setCapabilityStore(cache: CapabilityCache | null): void {
  activeStore = cache ?? defaultFileStore;
}

/**
 * Test seam — pin the file store root to a temp dir (pass `null` to restore
 * env/home resolution). Keeps tests from touching the real user home.
 */
export function setCapabilityStoreDirForTesting(dir: string | null): void {
  storeDirOverride = dir;
}
