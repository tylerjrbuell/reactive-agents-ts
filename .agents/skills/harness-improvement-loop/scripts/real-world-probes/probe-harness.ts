// Shared graded-check harness for the real-world probe fleet.
//
// Each probe builds an agent THE WAY A USER WOULD (public builder API only),
// runs a realistic task, and grades the outcome with deterministic checks —
// including cross-checks between what the receipt CLAIMS and what is actually
// on disk. A probe's job is to surface lies and blind spots, not to pass.
//
// Output: one JSON row per probe under REPORT_DIR (fleet runner aggregates).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..", "..");
export const QA_DIR = join(REPO_ROOT, "qa-out");
export const REPORT_DIR = join(
  REPO_ROOT,
  "wiki",
  "Research",
  "Harness-Reports",
  "real-world-probes-2026-07-11",
);

export interface CheckResult {
  readonly name: string;
  readonly pass: boolean;
  readonly detail?: string;
}

export function check(name: string, pass: boolean, detail?: string): CheckResult {
  return { name, pass, ...(detail !== undefined ? { detail } : {}) };
}

export function fileExistsCheck(name: string, path: string): CheckResult {
  return check(name, existsSync(path), existsSync(path) ? path : `MISSING: ${path}`);
}

export function fileContainsCheck(name: string, path: string, needle: string): CheckResult {
  if (!existsSync(path)) return check(name, false, `MISSING: ${path}`);
  const body = readFileSync(path, "utf8");
  return check(name, body.includes(needle), body.includes(needle) ? `found "${needle}"` : `"${needle}" not in ${path} (${body.slice(0, 120)}…)`);
}

/** Minimal result shape the coherence checks read (public AgentResult surface). */
export interface AgentResultLike {
  readonly output: unknown;
  readonly success: boolean;
  readonly taskId?: string;
  readonly terminatedBy?: string | null;
  readonly goalAchieved?: boolean | null;
  readonly metadata?: {
    readonly tokensUsed?: number;
    readonly llmCalls?: number;
    readonly duration?: number;
    readonly strategyUsed?: string;
  };
  readonly receipt?: {
    readonly verdict?: string;
    readonly toolCallStats?: { readonly ok: number; readonly failed: number };
    readonly deliverables?: readonly { readonly spec: string; readonly produced: boolean }[];
  };
}

/**
 * Receipt-vs-reality cross-checks every probe runs. These are the honesty
 * spine: a receipt field that contradicts the disk or its own siblings is a
 * framework bug regardless of task quality.
 */
export function coherenceChecks(result: AgentResultLike): CheckResult[] {
  const out: CheckResult[] = [];
  const outputText = typeof result.output === "string" ? result.output : JSON.stringify(result.output ?? "");

  out.push(
    check(
      "coherence:success-implies-output",
      !result.success || outputText.trim().length > 0,
      `success=${result.success} outputLen=${outputText.trim().length}`,
    ),
  );
  out.push(
    check(
      "coherence:tokens-reported",
      (result.metadata?.tokensUsed ?? 0) > 0,
      `tokensUsed=${result.metadata?.tokensUsed}`,
    ),
  );
  out.push(
    check(
      "coherence:llmCalls-reported",
      (result.metadata?.llmCalls ?? 0) > 0,
      `llmCalls=${result.metadata?.llmCalls}`,
    ),
  );
  out.push(
    check(
      "coherence:verdict-present",
      typeof result.receipt?.verdict === "string",
      `verdict=${result.receipt?.verdict}`,
    ),
  );

  // Deliverable claims vs disk truth — both directions lie-detect.
  for (const d of result.receipt?.deliverables ?? []) {
    const m = /produce the file (\S+)/.exec(d.spec);
    if (!m) continue;
    const p = m[1]!.replace(/^\.\//, "");
    const onDisk = existsSync(join(REPO_ROOT, p));
    out.push(
      check(
        `coherence:deliverable-claim-matches-disk[${p}]`,
        d.produced === onDisk,
        `receipt.produced=${d.produced} diskExists=${onDisk}`,
      ),
    );
  }
  return out;
}

/**
 * Runtime-hygiene capture. The fleet graded only the returned AgentResult, so a
 * run could print "Fiber terminated with an unhandled error" to the console and
 * still report ALL CHECKS PASS (2026-07-12: it did, on p4 and p6). A framework
 * that screams during a "successful" run is not successful — these signals are
 * graded like any other.
 */
interface HygieneCapture {
  readonly lines: string[];
  restore(): void;
}

const HYGIENE_PATTERNS: readonly { readonly name: string; readonly re: RegExp }[] = [
  // An Effect DEFECT escaped into a forked fiber and nobody observed it.
  { name: "hygiene:no-unhandled-fiber-defect", re: /Fiber terminated with an unhandled error/i },
  // A log site interpolated an object into a string — the payload is lost.
  { name: "hygiene:no-object-Object-in-logs", re: /\[object Object\]/ },
  // The kernel telling us its own invariant broke.
  { name: "hygiene:no-missing-toolcall-observation", re: /no ToolCallCompleted emitted/i },
];

function captureConsole(): HygieneCapture {
  const lines: string[] = [];
  const originals = { log: console.log, error: console.error, warn: console.warn };
  const tap =
    (original: (...a: unknown[]) => void) =>
    (...a: unknown[]) => {
      lines.push(a.map((x) => (typeof x === "string" ? x : String(x))).join(" "));
      original(...a);
    };
  console.log = tap(originals.log);
  console.error = tap(originals.error);
  console.warn = tap(originals.warn);
  return {
    lines,
    restore() {
      console.log = originals.log;
      console.error = originals.error;
      console.warn = originals.warn;
    },
  };
}

function hygieneChecks(lines: readonly string[]): CheckResult[] {
  return HYGIENE_PATTERNS.map(({ name, re }) => {
    const hit = lines.find((l) => re.test(l));
    return check(name, hit === undefined, hit ? `saw: ${hit.trim().slice(0, 140)}` : "clean");
  });
}

export interface ProbeReport {
  readonly probe: string;
  readonly taskId?: string;
  readonly success?: boolean;
  readonly terminatedBy?: string | null;
  readonly goalAchieved?: boolean | null;
  readonly verdict?: string;
  readonly strategyUsed?: string;
  readonly tokensUsed?: number;
  readonly llmCalls?: number;
  readonly durationMs: number;
  readonly crashed?: string;
  readonly checks: readonly CheckResult[];
  readonly failCount: number;
  readonly outputPreview?: string;
}

export function saveReport(report: ProbeReport): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, `${report.probe}.json`), JSON.stringify(report, null, 2));
  const failed = report.checks.filter((c) => !c.pass);
  console.log(`\n=== ${report.probe}: ${failed.length === 0 && !report.crashed ? "ALL CHECKS PASS" : `${failed.length} CHECK(S) FAILED${report.crashed ? " (CRASHED)" : ""}`} ===`);
  for (const c of report.checks) console.log(`  ${c.pass ? "✓" : "✗"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  if (report.crashed) console.log(`  CRASH: ${report.crashed}`);
}

/**
 * Run one probe end-to-end: build → run → grade → save. Never throws — a
 * crash IS a finding (recorded on the report, exit stays 0 so the fleet
 * continues).
 */
export async function runProbe(args: {
  readonly name: string;
  readonly build: () => Promise<{ run: (task: string) => Promise<AgentResultLike>; dispose: () => Promise<unknown> }>;
  readonly task: string;
  readonly grade: (result: AgentResultLike) => CheckResult[] | Promise<CheckResult[]>;
  /** Skip the standard coherence pack (e.g. structured-output probes grade their own). */
  readonly skipCoherence?: boolean;
}): Promise<void> {
  mkdirSync(QA_DIR, { recursive: true });
  const started = Date.now();
  let agent: Awaited<ReturnType<typeof args.build>> | null = null;
  const hygiene = captureConsole();
  try {
    agent = await args.build();
    const result = await agent.run(args.task);
    // Forked fibers (debrief, telemetry, trace writes) log AFTER run() resolves.
    // Yield the loop so their output lands in the capture before we grade it.
    await new Promise((r) => setTimeout(r, 250));
    hygiene.restore();
    const checks = [
      ...(await args.grade(result)),
      ...(args.skipCoherence ? [] : coherenceChecks(result)),
      ...hygieneChecks(hygiene.lines),
    ];
    const outputText = typeof result.output === "string" ? result.output : JSON.stringify(result.output ?? "");
    saveReport({
      probe: args.name,
      taskId: result.taskId,
      success: result.success,
      terminatedBy: result.terminatedBy ?? null,
      goalAchieved: result.goalAchieved ?? null,
      verdict: result.receipt?.verdict,
      strategyUsed: result.metadata?.strategyUsed,
      tokensUsed: result.metadata?.tokensUsed,
      llmCalls: result.metadata?.llmCalls,
      durationMs: Date.now() - started,
      checks,
      failCount: checks.filter((c) => !c.pass).length,
      outputPreview: outputText.slice(0, 400),
    });
  } catch (error) {
    hygiene.restore();
    const checks = [
      check("no-crash", false, String(error).slice(0, 300)),
      ...hygieneChecks(hygiene.lines),
    ];
    saveReport({
      probe: args.name,
      durationMs: Date.now() - started,
      crashed: error instanceof Error ? `${error.message}\n${error.stack?.split("\n").slice(0, 6).join("\n")}` : String(error),
      checks,
      failCount: checks.filter((c) => !c.pass).length,
    });
  } finally {
    hygiene.restore();
    if (agent) {
      try {
        await agent.dispose();
      } catch (e) {
        console.log(`  dispose() threw: ${String(e).slice(0, 200)}`);
      }
    }
  }
}
