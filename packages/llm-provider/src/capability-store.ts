// packages/llm-provider/src/capability-store.ts
//
// Wave 2a S2.4-proper (2026-10-13) — persistent capability store. Closes the
// write-through deferred at `providers/local-probe.ts` ("CalibrationStore
// write-through (cross-process) lands in S2.4"): probe results are persisted
// per (provider, model) so a process restart doesn't re-probe the world.
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
// (provider, model), content is the Capability struct itself, re-validated
// through `CapabilitySchema` on read so a corrupt or schema-drifted row can
// never poison the resolver — bad rows fall through to a fresh probe.

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

// ─── Directory resolution ─────────────────────────────────────────────────────

let storeDirOverride: string | null = null;

function capabilityStoreDir(): string {
  if (storeDirOverride) return storeDirOverride;
  const envDir = process.env.REACTIVE_AGENTS_CAPABILITY_STORE_DIR;
  if (envDir && envDir.length > 0) return envDir;
  const home = process.env.HOME ?? os.homedir();
  return path.join(home, ".reactive-agents", "capabilities");
}

// ─── File-backed store ────────────────────────────────────────────────────────

/**
 * Build a file-backed CapabilityCache rooted at `dir`. Exported so tests and
 * composition layers can construct stores at explicit paths.
 */
export function makeFileCapabilityStore(dir: string): CapabilityCache {
  return {
    saveCapability(cap: Capability): void {
      try {
        fs.mkdirSync(dir, { recursive: true });
        const key = `${normalizeModelId(cap.provider)}-${normalizeModelId(cap.model)}`;
        fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(cap, null, 2), "utf-8");
      } catch {
        // Persistence is best-effort: a read-only home dir or full disk must
        // never fail an agent run whose probe already succeeded.
      }
    },
    loadCapability(provider: string, model: string): Capability | null {
      try {
        const file = path.join(
          dir,
          `${normalizeModelId(provider)}-${normalizeModelId(model)}.json`,
        );
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
  saveCapability: (cap) => makeFileCapabilityStore(capabilityStoreDir()).saveCapability(cap),
  loadCapability: (provider, model) =>
    makeFileCapabilityStore(capabilityStoreDir()).loadCapability(provider, model),
};

// ─── Active store (injectable) ────────────────────────────────────────────────

let activeStore: CapabilityCache = defaultFileStore;

/**
 * The store the probe path writes through to and reads from. Defaults to the
 * JSON file store under `~/.reactive-agents/capabilities/`; override with
 * `setCapabilityStore` to plug a `CalibrationStore` (or any duck-typed
 * `CapabilityCache`) at composition time.
 */
export function getCapabilityStore(): CapabilityCache {
  return activeStore;
}

/**
 * Injection seam: replace the active capability store (pass `null` to restore
 * the default file store). A `CalibrationStore` from
 * `@reactive-agents/reactive-intelligence` satisfies `CapabilityCache`
 * structurally and can be passed here without a package dependency.
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
