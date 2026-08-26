#!/usr/bin/env bun
/**
 * Build-time generator for the landing page's "one real run" narrative.
 *
 * Transforms the committed golden-run capture (a single, fully-instrumented
 * live agent run — real tool calls, real lifecycle hooks, real receipt, real
 * debrief) into the shape the hero, the trace section, the lifecycle-phase
 * section, the trust-receipt section, and the debrief section all read from.
 * One run powers every "evidence" surface on the page so nothing on the page
 * can drift into inconsistent numbers.
 *
 * Source of truth (committed, real, unedited):
 *   wiki/Research/Harness-Reports/golden-run-<date>/run.json
 * Captured by: scripts/capture-golden-run.ts (live gemma4:e4b run via Ollama).
 *
 * Output: apps/docs/src/data/golden-run.json
 *
 * Run manually:
 *   bun run apps/docs/scripts/generate-golden-run.ts [--dir <path>]
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const DOCS_DIR = resolve(import.meta.dirname, "..");
const REPO_ROOT = resolve(DOCS_DIR, "../..");
const REPORTS_ROOT = join(REPO_ROOT, "wiki/Research/Harness-Reports");
const OUTPUT = resolve(DOCS_DIR, "src/data/golden-run.json");

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
};

/** Newest committed golden-run-* directory by name (date-sorted, descending). */
const findLatestDir = (): string => {
  const explicit = arg("dir");
  if (explicit) return explicit;
  const dirs = readdirSync(REPORTS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("golden-run-"))
    .map((d) => d.name)
    .sort()
    .reverse();
  if (dirs.length === 0) throw new Error(`no golden-run-* dirs under ${REPORTS_ROOT}`);
  return join(REPORTS_ROOT, dirs[0]);
};

/**
 * Canonical, ordered phase names — parsed from the same
 * `LifecyclePhase = Schema.Literal(...)` declaration generate-metrics.ts
 * counts, so the page's phase list can never drift from the real engine.
 */
const canonicalPhases = (): string[] => {
  const path = join(REPO_ROOT, "packages/runtime/src/types.ts");
  const src = readFileSync(path, "utf-8");
  const startTag = "export const LifecyclePhase = Schema.Literal(";
  const startIdx = src.indexOf(startTag);
  if (startIdx === -1) throw new Error("Could not locate LifecyclePhase in types.ts");
  const closeIdx = src.indexOf(");", startIdx);
  const block = src.slice(startIdx + startTag.length, closeIdx);
  const names: string[] = [];
  const re = /"([a-z-]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) names.push(m[1]!);
  return names;
};

// Phases that run inside the per-iteration loop body (matches the "↻ runs
// inside the loop" legend already on the Architecture-at-a-Glance section).
const LOOP_PHASES = new Set(["think", "act", "observe"]);

interface HookEntry {
  readonly phase: string;
  readonly timing: "before" | "after";
  readonly t: number;
}
interface RunJson {
  readonly task: string;
  readonly model: { readonly id: string; readonly provider: string; readonly tier: string };
  readonly wallMs: number;
  readonly hookLog: readonly HookEntry[];
  readonly result: {
    readonly output: string;
    readonly metadata: {
      readonly strategyUsed?: string;
      readonly iterations?: number;
      readonly tokensUsed?: number;
      readonly cost?: number;
      readonly toolCalls?: readonly {
        readonly name: string;
        readonly arguments?: Record<string, unknown>;
      }[];
    };
    readonly receipt?: Record<string, unknown>;
    readonly debrief?: Record<string, unknown> | null;
    readonly debriefRich?: Record<string, unknown> | null;
  };
}

/** One-line human-readable preview of a tool call's arguments, per tool. */
const argsPreview = (name: string, args: Record<string, unknown> | undefined): string => {
  if (!args) return "";
  if (name === "web-search" && typeof args.query === "string") return `"${args.query}"`;
  if (name === "file-write" && typeof args.path === "string") return args.path;
  if (name === "code-execute" && typeof args.code === "string") {
    const oneLine = args.code.replace(/\s+/g, " ").trim();
    return oneLine.length > 60 ? oneLine.slice(0, 57) + "…" : oneLine;
  }
  const s = JSON.stringify(args);
  return s.length > 60 ? s.slice(0, 57) + "…" : s;
};

const main = (): void => {
  const dir = findLatestDir();
  const capturedAt = dir.split("golden-run-").pop() ?? "";
  const runPath = join(dir, "run.json");
  if (!existsSync(runPath)) throw new Error(`run.json not found: ${runPath}`);
  const run = JSON.parse(readFileSync(runPath, "utf-8")) as RunJson;

  // Aggregate the real hook log into per-phase fire counts, in canonical
  // 12-phase order. A phase absent from the log genuinely did not run for
  // this config — shown as "opt-in, not configured" rather than hidden, since
  // that's itself evidence of the composable "nothing runs uninvited" claim.
  const counts = new Map<string, number>();
  for (const e of run.hookLog) {
    if (e.timing !== "before") continue;
    counts.set(e.phase, (counts.get(e.phase) ?? 0) + 1);
  }
  const phases = canonicalPhases().map((name) => ({
    name,
    fired: counts.has(name),
    count: counts.get(name) ?? 0,
    loop: LOOP_PHASES.has(name),
  }));

  const toolCalls = (run.result.metadata.toolCalls ?? []).map((tc) => ({
    name: tc.name,
    argsPreview: argsPreview(tc.name, tc.arguments),
  }));

  // Real playback timeline: every "before" hook event, offset from the run's
  // first event, in ms — the actual relative pacing of what happened when.
  // `act` events are zipped to their tool call in firing order (same count).
  const beforeEvents = run.hookLog.filter((e) => e.timing === "before");
  const t0 = beforeEvents[0]?.t ?? 0;
  let actCursor = 0;
  const timeline = beforeEvents.map((e) => {
    const atMs = e.t - t0;
    if (e.phase === "act") {
      const tc = toolCalls[actCursor];
      actCursor += 1;
      return { atMs, kind: "tool" as const, phase: e.phase, tool: tc?.name ?? null, argsPreview: tc?.argsPreview ?? null };
    }
    return { atMs, kind: "phase" as const, phase: e.phase, tool: null, argsPreview: null };
  });

  // Prefer the rich LLM-synthesized debrief; fall back to the deterministic
  // one (both are real — debriefRich is just the slower, richer synthesis of
  // the same run, per the docs' debrief.rich contract).
  const debrief = run.result.debriefRich ?? run.result.debrief ?? null;

  const out = {
    _source: `Real, unedited live run captured from wiki/Research/Harness-Reports/golden-run-${capturedAt}/run.json. GENERATED by apps/docs/scripts/generate-golden-run.ts — do not hand-edit; regenerate via scripts/capture-golden-run.ts.`,
    capturedAt,
    task: { prompt: run.task },
    model: run.model,
    run: {
      wallMs: run.wallMs,
      strategy: run.result.metadata.strategyUsed ?? "reactive",
      iterations: run.result.metadata.iterations ?? 0,
      tokensUsed: run.result.metadata.tokensUsed ?? 0,
      cost: run.result.metadata.cost ?? 0,
    },
    toolCalls,
    phases,
    timeline,
    output: run.result.output,
    receipt: run.result.receipt ?? null,
    debrief,
  };

  mkdirSync(resolve(DOCS_DIR, "src/data"), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(out, null, 2) + "\n");
  const firedCount = phases.filter((p) => p.fired).length;
  console.log(
    `[golden-run] ${run.model.id} · ${toolCalls.length} tool calls · ${firedCount}/${phases.length} phases fired · verdict=${(run.result.receipt as { verdict?: string } | undefined)?.verdict} (captured ${capturedAt})`,
  );
};

main();
