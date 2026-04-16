import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { normalizeModelIdForFile } from "./observations-store.js";
import type { ModelCalibration } from "@reactive-agents/llm-provider";

export interface CommunityProfileClientOptions {
  readonly endpoint?: string;
  readonly cacheDir?: string;
  readonly cacheTtlMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function defaultCacheDir(): string {
  return join(homedir(), ".reactive-agents", "community-profiles");
}

/**
 * Resolve the default profile endpoint URL.
 * Precedence: REACTIVE_AGENTS_TELEMETRY_PROFILES_URL > BASE_URL + /v1/profiles > hardcoded.
 */
export function resolveDefaultProfileEndpoint(): string {
  const full = process.env["REACTIVE_AGENTS_TELEMETRY_PROFILES_URL"];
  if (full) return full;
  const base = process.env["REACTIVE_AGENTS_TELEMETRY_BASE_URL"];
  if (base) return `${base.replace(/\/$/, "")}/v1/profiles`;
  return "https://api.reactiveagents.dev/v1/profiles";
}

interface CacheEntry {
  readonly fetchedAt: string;
  readonly profile: Partial<ModelCalibration>;
}

export async function fetchCommunityProfile(
  modelId: string,
  opts: CommunityProfileClientOptions = {},
): Promise<Partial<ModelCalibration> | undefined> {
  const endpoint = opts.endpoint ?? resolveDefaultProfileEndpoint();
  const cacheDir = opts.cacheDir ?? defaultCacheDir();
  const ttl = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const fetchFn = opts.fetchImpl ?? fetch;
  const fileName = `${normalizeModelIdForFile(modelId)}.json`;
  const cachePath = join(cacheDir, fileName);

  // 1) Serve fresh cache
  const cached = readCache(cachePath);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < ttl) {
    return cached.profile;
  }

  // 2) Fetch from endpoint
  try {
    const url = `${endpoint.replace(/\/$/, "")}/${encodeURIComponent(modelId)}`;
    const response = await fetchFn(url, { signal: opts.signal });
    if (response.status === 404) return undefined;
    if (!response.ok) return cached?.profile; // serve stale on non-404 errors
    const profile = (await response.json()) as Partial<ModelCalibration>;
    writeCache(cachePath, { fetchedAt: new Date().toISOString(), profile });
    return profile;
  } catch {
    // Offline or network error — serve stale cache if available
    return cached?.profile;
  }
}

function readCache(path: string): CacheEntry | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as CacheEntry;
  } catch {
    return undefined;
  }
}

function writeCache(path: string, entry: CacheEntry): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(entry, null, 2));
  } catch {
    // Cache write failure is non-fatal
  }
}
