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
 * Captured by: packages/benchmarks/scripts/capture-golden-run.ts (live gemma4:e4b run via Ollama).
 *
 * Output: apps/docs/src/data/golden-run.json
 *
 * Run manually:
 *   bun run apps/docs/scripts/generate-golden-run.ts [--dir <path>]
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { buildTimelineSkeleton, toolStartsFromTrace, type HookEntry, type ToolStart } from "./golden-run-timeline";

const DOCS_DIR = resolve(import.meta.dirname, "..");
const REPO_ROOT = resolve(DOCS_DIR, "../..");
const REPORTS_ROOT = join(REPO_ROOT, "wiki/Research/Harness-Reports");
const OUTPUT = resolve(DOCS_DIR, "src/data/golden-run.json");
const OUTPUT_FAILED = resolve(DOCS_DIR, "src/data/golden-run-failed.json");

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
};

/** Why a capture folder cannot be used yet, or null when it is complete. A capture still in progress
 *  (no run.json, a half-written one, or no capture block) must never break the docs build. */
const incompleteReason = (dir: string): string | null => {
  const runPath = join(dir, "run.json");
  if (!existsSync(runPath)) return "no run.json";
  try {
    const run = JSON.parse(readFileSync(runPath, "utf-8")) as { capture?: { capturedAt?: string; frameworkVersion?: string } };
    if (!run.capture?.capturedAt || !run.capture.frameworkVersion) return "run.json has no capture block";
    return null;
  } catch {
    return "run.json is not valid JSON";
  }
};

/** Newest complete golden-run-* directory by name (date-sorted, descending). Newer folders that are
 *  still being captured are skipped and logged; `--dir` stays strict. */
const findLatestDir = (): string => {
  const explicit = arg("dir");
  if (explicit) return explicit;
  const dirs = readdirSync(REPORTS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("golden-run-"))
    .map((d) => d.name)
    .sort()
    .reverse();
  if (dirs.length === 0) throw new Error(`no golden-run-* dirs under ${REPORTS_ROOT}`);
  for (const name of dirs) {
    const reason = incompleteReason(join(REPORTS_ROOT, name));
    if (reason === null) return join(REPORTS_ROOT, name);
    console.warn(`[golden-run] skipping ${name}: ${reason} (capture in progress?)`);
  }
  throw new Error(`no complete golden-run-* dir under ${REPORTS_ROOT} (every folder skipped)`);
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

/** Real tool-call start times from the capture's trace file, when present. */
const traceStarts = (dir: string, file: string): ToolStart[] | undefined => {
  const p = join(dir, file);
  return existsSync(p) ? toolStartsFromTrace(readFileSync(p, "utf-8")) : undefined;
};
interface ReasoningStep {
  readonly type: "thought" | "action" | "observation";
  readonly content?: string;
  readonly metadata?: {
    readonly toolCall?: { readonly id?: string };
    readonly toolCallId?: string;
  };
}
/** Provenance block written by capture-golden-run.ts (since 2026-11-17). */
export interface CaptureBlock {
  readonly mode: "success" | "failed";
  readonly maxIterations: number | null;
  readonly capturedAt: string;
  readonly frameworkVersion: string;
  readonly gitDescribe: string;
  readonly ollamaVersion: string;
  readonly builderLines: readonly string[];
}
interface RunJson {
  readonly capture: CaptureBlock;
  readonly workDir?: string;
  readonly task: string;
  readonly model: { readonly id: string; readonly provider: string; readonly tier: string };
  readonly wallMs: number;
  readonly hookLog: readonly HookEntry[];
  readonly result: {
    readonly output: string;
    readonly metadata: {
      readonly strategyUsed?: string;
      readonly iterations?: number;
      readonly stepsCount?: number;
      readonly tokensUsed?: number;
      readonly cost?: number;
      readonly reasoningSteps?: readonly ReasoningStep[];
      readonly toolCalls?: readonly {
        readonly id?: string;
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

/** Phases, tool calls, playback timeline and debrief derived from one captured run. */
const transform = (run: RunJson, toolStarts?: readonly ToolStart[]) => {

  // Phases are counted below from the displayed rows, in canonical 12-phase order. A phase absent
  // from the log genuinely did not run for this config: shown as "opt-in, not configured" rather
  // than hidden, since that's itself evidence of the composable "nothing runs uninvited" claim.

  // Real per-call detail for the expandable trace rows: the thought that
  // preceded this action, and the observation/result it produced. For a
  // file-write, "result" is the actual file content that got written (the
  // truest evidence of what happened) rather than the success observation.
  const steps = run.result.metadata.reasoningSteps ?? [];
  // Display-only: the capture ran in a throwaway temp dir; show paths as the ./ the task asked for.
  const scrub = (s: string): string => (run.workDir ? s.split(`${run.workDir}/`).join("./") : s);
  const truncate = (s: string, n: number): string => {
    const t = scrub(s);
    return t.length > n ? t.slice(0, n) + "…" : t;
  };
  const detailFor = (
    tc: { id?: string; name: string; arguments?: Record<string, unknown> },
  ): { thought: string | null; result: string | null } => {
    const actionIdx = steps.findIndex((s) => s.type === "action" && s.metadata?.toolCall?.id === tc.id);
    const thoughtStep = actionIdx > 0 ? steps[actionIdx - 1] : undefined;
    const thought =
      thoughtStep?.type === "thought" && thoughtStep.content?.trim() ? truncate(thoughtStep.content.trim(), 500) : null;
    if (tc.name === "file-write" && typeof tc.arguments?.content === "string") {
      return { thought, result: truncate(tc.arguments.content, 1200) };
    }
    const obs = steps.find((s) => s.type === "observation" && s.metadata?.toolCallId === tc.id);
    return { thought, result: obs?.content ? truncate(obs.content, 1200) : null };
  };

  const toolCalls = (run.result.metadata.toolCalls ?? []).map((tc) => ({
    name: tc.name,
    argsPreview: scrub(argsPreview(tc.name, tc.arguments)),
    detail: detailFor(tc),
  }));

  // Real playback timeline: every "before" hook event, offset from the run's
  // first event, in ms — the actual relative pacing of what happened when.
  // `act` events are zipped to their tool call in firing order (same count).
  // The outer engine also fires one synthetic bookkeeping `act` hook (paired
  // with its synthetic `observe` hook, see reasoning-post-think.ts) that has
  // no matching real tool call — when the act-hook count outruns the real
  // toolCalls array, that's it: fall through to a plain phase tick rather
  // than render an empty tool row.
  // Tool rows are paired to hooks by tool name + time (see golden-run-timeline.ts); the runtime fires
  // several `act before` hooks per call, so zipping the N-th hook to the N-th call is wrong. Hooks that
  // match no call (per-turn duplicates, the engine's post-kernel bookkeeping block) are dropped.
  const skeleton = buildTimelineSkeleton(run.hookLog, toolCalls.map((t) => t.name), toolStarts);
  const timeline = skeleton.map((r) => {
    if (r.toolIndex !== null) {
      const tc = toolCalls[r.toolIndex]!;
      return {
        atMs: r.atMs,
        kind: "tool" as const,
        phase: r.phase,
        tool: tc.name,
        argsPreview: tc.argsPreview,
        detail: tc.detail,
      };
    }
    return {
      atMs: r.atMs,
      kind: "phase" as const,
      phase: r.phase,
      tool: null,
      argsPreview: null,
      detail: null as
        | { thought: string | null; leadsToTool: string | null }
        | { observations: { tool: string; argsPreview: string; result: string | null }[] }
        | { engineWrapper: true }
        | null,
    };
  });

  // Fire counts follow the rows shown, not raw hook fires: a phase's count must not exceed what the
  // replay displays (the raw log fires act/observe 2-3x per call).
  const counts = new Map<string, number>();
  for (const r of timeline) counts.set(r.phase, (counts.get(r.phase) ?? 0) + 1);
  const phases = canonicalPhases().map((name) => ({
    name,
    fired: counts.has(name),
    count: counts.get(name) ?? 0,
    loop: LOOP_PHASES.has(name),
  }));

  // Zip the kernel's `think` ticks to the run's real thought steps in order.
  // Since the duplicate-think fix (iterate-pass.ts now fires `think` hooks
  // only when it actually dispatches a thinking step), each kernel think tick
  // corresponds 1:1 to one reasoning pass, so positional zipping is exact
  // rather than a guess. Index 0 is the outer engine's coarse wrapper (see
  // below) and is skipped here.
  const thoughtSteps = steps.filter((s) => s.type === "thought");
  const kernelThinkIdxs = timeline
    .map((e, i) => (e.phase === "think" ? i : -1))
    .filter((i) => i !== -1)
    .slice(1);
  kernelThinkIdxs.forEach((tlIdx, n) => {
    const raw = thoughtSteps[n]?.content?.trim();
    const next = timeline[tlIdx + 1];
    timeline[tlIdx].detail = {
      thought: raw ? truncate(raw, 800) : null,
      leadsToTool: next?.kind === "tool" ? next.tool : null,
    };
  });

  // Each `observe` tick shows only the tool result(s) since the PREVIOUS
  // observe tick — the kernel now fires observe once per real tool round
  // (act.ts fix, 2026-08-27), so this is normally exactly the one call that
  // round just made, not an accumulating summary of everything so far.
  let toolsConsumedByObserve = 0;
  for (let i = 0; i < timeline.length; i++) {
    const entry = timeline[i];
    if (entry.kind !== "phase") continue;
    if (entry.phase === "observe") {
      const toolsBefore = timeline.slice(0, i).filter((t) => t.kind === "tool").length;
      const seen = toolCalls.slice(toolsConsumedByObserve, toolsBefore);
      toolsConsumedByObserve = toolsBefore;
      // Observe rows only survive after a tool row, so `seen` is never empty. The real observation
      // content per tool result curated into context by this tick: the actual text, not a label.
      entry.detail = {
        observations: seen.map((t) => ({ tool: t.name, argsPreview: t.argsPreview, result: t.detail.result })),
      };
    }
  }

  // The outer execution engine wraps the ENTIRE kernel loop in one coarse
  // `think` phase hook (execution-engine.ts: guardedPhase(ctx, "think", …)),
  // so the first think tick is that wrapper, not a reasoning pass — it opens
  // before the kernel's own bootstrap and closes after the kernel completes.
  // Label it for what it is instead of leaving it looking like a silent step.
  const firstThinkIdx = timeline.findIndex((e) => e.phase === "think");
  if (firstThinkIdx !== -1 && !timeline[firstThinkIdx].detail) {
    timeline[firstThinkIdx].detail = { engineWrapper: true };
  }

  // Prefer the rich LLM-synthesized debrief; fall back to the deterministic
  // one (both are real — debriefRich is just the slower, richer synthesis of
  // the same run, per the docs' debrief.rich contract).
  const debrief = run.result.debriefRich ?? run.result.debrief ?? null;

  return { phases, timeline, toolCalls, debrief };
};

const readText = (path: string): string => readFileSync(path, "utf-8").replace(/\s+$/, "");

const main = (): void => {
  const dir = findLatestDir();
  const dirDate = dir.split("golden-run-").pop() ?? "";
  const runPath = join(dir, "run.json");
  if (!existsSync(runPath)) throw new Error(`run.json not found: ${runPath}`);
  const run = JSON.parse(readFileSync(runPath, "utf-8")) as RunJson;
  if (!run.capture?.capturedAt || !run.capture.frameworkVersion) {
    throw new Error(`${runPath} has no capture block (capturedAt/frameworkVersion); recapture with capture-golden-run.ts`);
  }
  const { capture } = run;
  const { phases, timeline, toolCalls, debrief } = transform(run, traceStarts(dir, "success-trace.jsonl"));

  const out = {
    _source: `Real, unedited live run captured from wiki/Research/Harness-Reports/golden-run-${dirDate}/run.json. GENERATED by apps/docs/scripts/generate-golden-run.ts. Do not hand-edit; regenerate via packages/benchmarks/scripts/capture-golden-run.ts.`,
    capturedAt: capture.capturedAt,
    capture,
    task: { prompt: run.task },
    model: run.model,
    run: {
      wallMs: run.wallMs,
      strategy: run.result.metadata.strategyUsed ?? "reactive",
      // `metadata.iterations` is the reasoning-step count (stepsCount: thought + action + observation
      // per tool turn), not kernel turns; exported under its honest name.
      reasoningSteps: run.result.metadata.stepsCount ?? run.result.metadata.iterations ?? 0,
      tokensUsed: run.result.metadata.tokensUsed ?? 0,
      cost: run.result.metadata.cost ?? 0,
    },
    toolCalls,
    phases,
    timeline,
    output: run.result.output,
    receipt: run.result.receipt ?? null,
    debrief,
    diagnose: { cause: readText(join(dir, "success-cause.txt")) },
  };
  mkdirSync(resolve(DOCS_DIR, "src/data"), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(out, null, 2) + "\n");

  // Failed run (same agent, iteration cap forced low). Optional: absent in older capture dirs.
  const failedPath = join(dir, "failed-run.json");
  if (existsSync(failedPath)) {
    const f = JSON.parse(readFileSync(failedPath, "utf-8")) as RunJson;
    if (f.capture?.maxIterations == null) throw new Error(`${failedPath}: capture.maxIterations missing`);
    const ft = transform(f, traceStarts(dir, "failed-trace.jsonl"));
    // The failed run's metadata.iterations is deliberately NOT exported: it counts
    // something other than the cap (see the capture README), so the page shows the cap.
    const failedOut = {
      _source: `Real, unedited live run (iteration cap forced low) captured from wiki/Research/Harness-Reports/golden-run-${dirDate}/failed-run.json. GENERATED by apps/docs/scripts/generate-golden-run.ts. Do not hand-edit.`,
      capturedAt: f.capture.capturedAt,
      capture: f.capture,
      task: { prompt: f.task },
      model: f.model,
      run: {
        wallMs: f.wallMs,
        tokensUsed: f.result.metadata.tokensUsed ?? 0,
        maxIterations: f.capture.maxIterations,
      },
      toolCalls: ft.toolCalls,
      phases: ft.phases,
      timeline: ft.timeline,
      receipt: f.result.receipt ?? null,
      diagnose: {
        cause: readText(join(dir, "failed-cause.txt")),
        attribute: existsSync(join(dir, "failed-attribute.txt")) ? readText(join(dir, "failed-attribute.txt")) : null,
      },
    };
    writeFileSync(OUTPUT_FAILED, JSON.stringify(failedOut, null, 2) + "\n");
  }

  const firedCount = phases.filter((p) => p.fired).length;
  console.log(
    `[golden-run] ${run.model.id} · ${toolCalls.length} tool calls · ${firedCount}/${phases.length} phases fired · verdict=${(run.result.receipt as { verdict?: string } | undefined)?.verdict} (captured ${capture.capturedAt}, v${capture.frameworkVersion})`,
  );
};

main();
