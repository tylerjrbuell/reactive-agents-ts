// File: src/preflight-provenance.ts — contention guard + run provenance for live benches.
//
// Audit 03 D4/D6: the runner could not tell a model failure from a stalled
// host (a foreign Ollama client, a loaded second model, load 8-10 with swap
// full flipped Bernoulli cells and voided a whole attempt), and a results file
// recorded only `gitSha`, which does not identify the code that ran (reasoning
// exports `dist`), the env flags, the timeout or the model weights. This module
// is the single home for both: `checkContention` before a bench starts, and
// `collectProvenance` stamped into every results file.
//
// Everything that touches the host is fail-soft (an unreachable Ollama or a
// non-Linux /proc yields `null`, never a throw), and the decision logic
// (`evaluateContention`, `countOllamaClients`) is pure so it is testable
// without a host.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Version of the scoring rules a results file was produced under. Bumped by
 * whoever changes how a cell is scored (judge/grader/task checks) so two results
 * files are never silently compared across a scorer change. Owner decision
 * 2026-11-18: the scorer comparability break is accepted, this field marks it.
 */
import { SCORER_VERSION } from "./scorer-version.js";
export { SCORER_VERSION };

/** Default runner cell timeout (seconds): the skill and every baseline used 180. */
export const DEFAULT_CELL_TIMEOUT_SEC = 180;

/** Default 1-minute load per CPU above which a host is called contended. */
export const DEFAULT_MAX_LOAD_PER_CPU = 0.75;

const OLLAMA_PORT = 11434;

// ── contention (pure decision) ────────────────────────────────────────────────

/** Host facts the contention decision reads. `null` = could not be observed. */
export interface ContentionInput {
  /** Model names this bench will use (as Ollama names them). */
  readonly ours: readonly string[];
  /** Models Ollama reports loaded (`/api/ps`); null when Ollama was unreachable. */
  readonly loaded: readonly string[] | null;
  readonly loadAvg1: number;
  readonly cpus: number;
  /** ESTABLISHED client connections on the Ollama port; null when not observable. */
  readonly clients: number | null;
  readonly maxLoadPerCpu?: number;
}

/** What the preflight saw and what it makes of it. */
export interface ContentionReport {
  /** False when any finding would make this host's cells untrustworthy. */
  readonly ok: boolean;
  readonly findings: readonly string[];
  readonly foreignLoaded: readonly string[];
  readonly ollamaReachable: boolean;
  readonly ollamaClients: number | null;
  readonly loadAvg1: number;
  readonly cpus: number;
}

/** `qwen3:4b` and `qwen3:4b:latest` are one model. */
const modelKey = (name: string): string => name.replace(/:latest$/, "");

/** Pure decision: foreign loaded models, foreign clients, host load. */
export function evaluateContention(input: ContentionInput): ContentionReport {
  const maxLoad = input.maxLoadPerCpu ?? DEFAULT_MAX_LOAD_PER_CPU;
  const mine = new Set(input.ours.map(modelKey));
  const foreignLoaded = (input.loaded ?? []).filter((m) => !mine.has(modelKey(m)));
  const findings: string[] = [];
  if (foreignLoaded.length > 0) {
    findings.push(`foreign model(s) loaded in Ollama: ${foreignLoaded.join(", ")} (contend for GPU/VRAM)`);
  }
  if (input.clients !== null && input.clients > 0) {
    findings.push(`${input.clients} established client connection(s) on :${OLLAMA_PORT} (another Ollama client is active)`);
  }
  const perCpu = input.cpus > 0 ? input.loadAvg1 / input.cpus : 0;
  if (perCpu > maxLoad) {
    findings.push(
      `host load ${input.loadAvg1.toFixed(2)} on ${input.cpus} CPUs (${perCpu.toFixed(2)}/CPU > ${maxLoad})`,
    );
  }
  return {
    ok: findings.length === 0,
    findings,
    foreignLoaded,
    ollamaReachable: input.loaded !== null,
    ollamaClients: input.clients,
    loadAvg1: input.loadAvg1,
    cpus: input.cpus,
  };
}

/**
 * Count ESTABLISHED TCP connections whose LOCAL port is `port` in the text of
 * `/proc/net/tcp` (or `tcp6`): the server side of every live client of that
 * port. Pure parser; `st` 01 = ESTABLISHED.
 */
export function countOllamaClients(procNetTcp: string, port: number = OLLAMA_PORT): number {
  const hexPort = port.toString(16).toUpperCase().padStart(4, "0");
  let n = 0;
  for (const line of procNetTcp.split("\n").slice(1)) {
    const cols = line.trim().split(/\s+/);
    const local = cols[1];
    const state = cols[3];
    if (local === undefined || state !== "01") continue;
    if (local.slice(local.lastIndexOf(":") + 1).toUpperCase() === hexPort) n++;
  }
  return n;
}

// ── host observation (fail-soft) ──────────────────────────────────────────────

/** Ollama base URL from `OLLAMA_HOST` (scheme optional), default localhost. */
export function ollamaBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.OLLAMA_HOST?.trim();
  if (!raw) return `http://127.0.0.1:${OLLAMA_PORT}`;
  const withScheme = /^https?:\/\//.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

const isLocalUrl = (url: string): boolean => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)(:|\/|$)/.test(url);

async function ollamaJson(
  base: string,
  path: string,
  body?: unknown,
  timeoutMs = 3000,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${base}${path}`, {
      ...(body !== undefined
        ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
        : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    return typeof json === "object" && json !== null ? Object.fromEntries(Object.entries(json)) : null;
  } catch {
    return null;
  }
}

const strField = (o: object, key: string): string | undefined => {
  const v: unknown = Object.entries(o).find(([k]) => k === key)?.[1];
  return typeof v === "string" ? v : undefined;
};

const namesIn = (json: Record<string, unknown> | null): string[] | null => {
  const models = json?.models;
  if (!Array.isArray(models)) return null;
  return models.flatMap((m: unknown): string[] => {
    const name = typeof m === "object" && m !== null ? strField(m, "name") : undefined;
    return name === undefined ? [] : [name];
  });
};

function readProc(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

/**
 * Observe the host and decide. `models` are the Ollama model names the bench
 * will run. Ollama unreachable -> `ollamaReachable: false` and no foreign-model
 * finding (a non-Ollama bench is not contended by Ollama); load is still read.
 */
export async function checkContention(
  models: readonly string[],
  opts: { readonly maxLoadPerCpu?: number } = {},
): Promise<ContentionReport> {
  const base = ollamaBaseUrl();
  const loaded = namesIn(await ollamaJson(base, "/api/ps"));
  const procText = process.platform === "linux" && isLocalUrl(base) ? readProc("/proc/net/tcp") + readProc("/proc/net/tcp6") : null;
  return evaluateContention({
    ours: models,
    loaded,
    loadAvg1: loadavg()[0] ?? 0,
    cpus: cpus().length,
    clients: procText === null || procText === "" ? null : countOllamaClients(procText),
    ...(opts.maxLoadPerCpu !== undefined ? { maxLoadPerCpu: opts.maxLoadPerCpu } : {}),
  });
}

/** Loud, multi-line text for a contended preflight (what to do about it included). */
export function formatContention(r: ContentionReport, allowed: boolean): string {
  const head = allowed
    ? "PREFLIGHT WARNING: host contention detected; continuing because --allow-contention was given. Cells below may be stalled, not failed."
    : "PREFLIGHT REFUSED: host contention detected. A stalled host flips Bernoulli cells (timeouts score as model failures).";
  const tail = allowed ? "" : "\n  Stop the other client / unload the model, or pass --allow-contention to run anyway (recorded in provenance).";
  return `${head}\n${r.findings.map((f) => `  - ${f}`).join("\n")}${tail}`;
}

// ── provenance ────────────────────────────────────────────────────────────────

/** Recorded contention check (one per chunk/invocation). */
export interface PreflightEntry {
  readonly at: string;
  readonly ok: boolean;
  readonly allowed: boolean;
  readonly findings: readonly string[];
  readonly loadAvg1: number;
  readonly ollamaClients: number | null;
}

/** What produced a results file: enough to refuse comparing two incomparable ones. */
export interface RunProvenance {
  readonly gitSha: string;
  /** See {@link SCORER_VERSION}. */
  readonly scorerVersion: number;
  /** sha256 over packages/reasoning/dist (it exports dist, so a SHA does not identify what ran); null when absent. */
  readonly reasoningDistHash: string | null;
  /** `RA_*` env flags in force (values of secret-looking names redacted). */
  readonly raEnv: Readonly<Record<string, string>>;
  /** Per-cell wall timeout; null when the session did not set one (runner default applies). */
  readonly cellTimeoutSec: number | null;
  /** Chunk start margin; null outside the chunked H3 runner. */
  readonly startMarginSec: number | null;
  /** Chunk budget; null outside the chunked H3 runner. */
  readonly budgetSec: number | null;
  /** tier -> Ollama model digest (`/api/show`, else `/api/tags`); null when unavailable. */
  readonly modelDigests: Readonly<Record<string, string | null>>;
  /** Contention checks, one appended per invocation. */
  readonly preflight: readonly PreflightEntry[];
}

/** sha256 over every file under `dir` (sorted relative path + bytes); null when `dir` is missing. */
export function hashDirectory(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(dir);
  const h = createHash("sha256");
  for (const f of files) {
    h.update(relative(dir, f));
    h.update("\0");
    h.update(readFileSync(f));
    h.update("\0");
  }
  return h.digest("hex");
}

/** Dist hash of the reasoning package the bench resolves (sibling of this package). */
export function reasoningDistHash(): string | null {
  return hashDirectory(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "reasoning", "dist"));
}

/** `RA_*` flags; a name containing KEY/TOKEN/SECRET/PASSWORD has its value redacted. */
export function raEnvFlags(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(env).sort()) {
    if (!k.startsWith("RA_")) continue;
    out[k] = /KEY|TOKEN|SECRET|PASSWORD/i.test(k) ? "<redacted>" : (env[k] ?? "");
  }
  return out;
}

/** Ollama model digest: `/api/show` `digest` when present, else the `/api/tags` entry. Null when unavailable. */
export async function ollamaModelDigest(model: string): Promise<string | null> {
  const base = ollamaBaseUrl();
  const shown = await ollamaJson(base, "/api/show", { model });
  if (typeof shown?.digest === "string") return shown.digest;
  const tags = (await ollamaJson(base, "/api/tags"))?.models;
  if (!Array.isArray(tags)) return null;
  for (const m of tags) {
    if (typeof m !== "object" || m === null) continue;
    const digest = strField(m, "digest");
    if (digest !== undefined && [strField(m, "name"), strField(m, "model")].some((n) => n !== undefined && modelKey(n) === modelKey(model))) {
      return digest;
    }
  }
  return null;
}

/** A preflight log entry from a report. */
export function preflightEntry(r: ContentionReport, allowed: boolean, now: Date = new Date()): PreflightEntry {
  return {
    at: now.toISOString(),
    ok: r.ok,
    allowed,
    findings: r.findings,
    loadAvg1: r.loadAvg1,
    ollamaClients: r.ollamaClients,
  };
}

/** Assemble provenance for a run. `models` are the Ollama model names (digests are looked up for each). */
export async function collectProvenance(input: {
  readonly gitSha: string;
  readonly cellTimeoutSec: number | null;
  readonly startMarginSec: number | null;
  readonly budgetSec: number | null;
  readonly models: readonly string[];
  readonly preflight: readonly PreflightEntry[];
}): Promise<RunProvenance> {
  const digests = await Promise.all(input.models.map(async (m) => [m, await ollamaModelDigest(m)] as const));
  return {
    gitSha: input.gitSha,
    scorerVersion: SCORER_VERSION,
    reasoningDistHash: reasoningDistHash(),
    raEnv: raEnvFlags(),
    cellTimeoutSec: input.cellTimeoutSec,
    startMarginSec: input.startMarginSec,
    budgetSec: input.budgetSec,
    modelDigests: Object.fromEntries(digests),
    preflight: input.preflight,
  };
}

/**
 * Differences that make a resumed chunk incomparable with the file's earlier
 * cells (same SHA is not enough: dist, scorer, timeout, flags, weights).
 */
export function provenanceDrift(recorded: RunProvenance, now: RunProvenance): readonly string[] {
  const out: string[] = [];
  if (recorded.scorerVersion !== now.scorerVersion) out.push(`scorerVersion ${recorded.scorerVersion} -> ${now.scorerVersion}`);
  if (recorded.reasoningDistHash !== now.reasoningDistHash) out.push("reasoning dist hash changed (rebuild between chunks)");
  if (recorded.cellTimeoutSec !== now.cellTimeoutSec) out.push(`cell timeout ${recorded.cellTimeoutSec}s -> ${now.cellTimeoutSec}s`);
  if (JSON.stringify(recorded.raEnv) !== JSON.stringify(now.raEnv)) out.push("RA_* env flags changed");
  for (const [m, d] of Object.entries(now.modelDigests)) {
    const was = recorded.modelDigests[m];
    if (was != null && d != null && was !== d) out.push(`model ${m} digest changed`);
  }
  return out;
}
