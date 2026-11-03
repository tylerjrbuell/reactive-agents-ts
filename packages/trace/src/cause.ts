// packages/trace/src/cause.ts
//
// Deterministic failure-cause classifier (audit 2026-11-03 §1.5).
//
// `analyzeRun` reports WHAT the harness did (interventions, costs, tool
// outcomes). This module answers WHY the run ended the way it did: an ordered
// list of pure predicates over trace events, first match wins.
//
// HONESTY RULES (load-bearing — do not relax):
//   - Reads trace events ONLY. Never model text, never the task wording.
//   - Never guesses. A rule that matches on a legacy fallback field (rather
//     than the authoritative signal) reports `probable` and names the missing
//     signal in `missing`. A run no rule can explain, from a trace too thin to
//     tell, reports `insufficient-trace` with cause `undetermined`.
//   - `unexplained` is a RESIDUAL, never a positive finding: it means "the
//     trace was sufficient and no rule fired". The audit's `model-incapable`
//     label needs a cross-model comparison set and is intentionally NOT
//     assigned here (cohort-only, see `cohort.ts`).
//
// Rules implemented (first match wins; process-failure rules 7, 8, 8b, 10-12
// only run on non-success outcomes):
//   0 direct-chat (not a run)
//   1 timeout / user-stop / aborted (run-aborted.reason) | incomplete-trace
//   2 provider-error     3 satisfiability-abstain
//   4 terminal-mislabel (incl. run-completed.status vs outcome contradiction)
//   5 plan-posture-veto  6 never-engaged
//   7 tool-protocol      8 tool-failure       8b wrong-tool-arg
//   9 stall-after-work / loop-after-work / stall-no-progress
//   10 bookkeeping-loop  11 verifier-reject   12 budget-cap
//   13 residual: unexplained (non-success) | success-with-warning | none (success)
// Not implemented (needs a signal the trace does not carry yet): audit rule 5
// `contract-pollution` (needs requirement provenance, audit rank 8).

import type { Trace } from "./replay.js";
import type {
  TraceEvent,
  GuardFiredEvent,
  RunStartedEvent,
  RunCompletedEvent,
  RunAbortedEvent,
  ToolCallEvent,
  VerifierVerdictEvent,
  AssessmentEvent,
  ToolSurfaceResolvedEvent,
  ContractCompiledEvent,
  StrategySwitchedEvent,
  KernelStateSnapshotEvent,
  LedgerEntryTraceEvent,
  LLMExchangeEvent,
} from "./events.js";

/** Closed set of failure causes (plus `none` for healthy runs and `undetermined`). */
export type FailureCause =
  | "direct-chat"
  | "timeout"
  | "user-stop"
  | "aborted"
  | "incomplete-trace"
  | "provider-error"
  | "satisfiability-abstain"
  | "terminal-mislabel"
  | "plan-posture-veto"
  | "never-engaged"
  | "tool-protocol"
  | "tool-failure"
  | "wrong-tool-arg"
  | "stall-after-work"
  | "stall-no-progress"
  | "loop-after-work"
  | "bookkeeping-loop"
  | "verifier-reject"
  | "budget-cap"
  | "unexplained"
  | "success-with-warning"
  | "none"
  | "undetermined";

/** How much the trace supports the verdict. */
export type CauseConfidence = "decisive" | "probable" | "insufficient-trace";

/** One trace event that supports the verdict. */
export interface CauseEvidence {
  readonly eventKind: string;
  readonly seq: number;
  readonly detail: string;
}

/** Output of {@link analyzeCause}. */
export interface CauseAnalysis {
  readonly runId: string;
  readonly cause: FailureCause;
  /** Finer, still-deterministic qualifier (e.g. provider `quota`, `cap-cutoff`). */
  readonly subCause?: string;
  readonly confidence: CauseConfidence;
  readonly evidence: readonly CauseEvidence[];
  /** Trace signals that would have made the verdict decisive but were absent. */
  readonly missing: readonly string[];
  /** The authority that owned the final status (`run-completed.outcome.authority`, else `terminal_decision`). */
  readonly authority?: string;
  /** The kernel's own authority, when a runtime authority replaced it. */
  readonly kernelAuthority?: string;
  /** `run-completed.status`, or `aborted` / `unknown` when no run-completed exists. */
  readonly outcomeStatus: string;
}

/** Tools that are harness bookkeeping, not work on the task. */
const META_TOOLS: ReadonlySet<string> = new Set([
  "brief", "pulse", "find", "recall", "discover-tools", "context-status",
  "checkpoint", "final-answer", "task-complete", "activate-skill",
  "get-skill-section", "todo",
]);
const isMeta = (name: string): boolean => META_TOOLS.has(name);

type Meta = Readonly<Record<string, unknown>>;
const metaOf = (g: GuardFiredEvent | undefined): Meta => g?.metadata ?? {};
const num = (m: Meta, k: string): number | undefined => {
  const v = m[k];
  return typeof v === "number" ? v : undefined;
};
const str = (m: Meta, k: string): string | undefined => {
  const v = m[k];
  return typeof v === "string" ? v : undefined;
};
const rec = (m: Meta, k: string): Meta | undefined => {
  const v = m[k];
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Meta) : undefined;
};

interface Verdict {
  readonly cause: FailureCause;
  readonly subCause?: string;
  readonly evidence: readonly CauseEvidence[];
  /** Signals absent that would upgrade `probable` to `decisive`. */
  readonly needs: readonly string[];
}

interface Facts {
  readonly ev: readonly TraceEvent[];
  readonly started?: RunStartedEvent;
  readonly completed?: RunCompletedEvent;
  readonly aborted?: RunAbortedEvent;
  readonly lastSnap?: KernelStateSnapshotEvent;
  readonly guards: readonly GuardFiredEvent[];
  readonly terminalDecision?: GuardFiredEvent;
  readonly override?: GuardFiredEvent;
  readonly deliverable?: GuardFiredEvent;
  readonly status?: RunCompletedEvent["status"];
  readonly isSuccess: boolean;
  readonly terminatedBy?: string;
  readonly toolEnds: readonly ToolCallEvent[];
  readonly realEnds: readonly ToolCallEvent[];
  readonly realCalls: number;
  readonly metaCalls: number;
  readonly visibleReal: readonly string[];
  readonly hasSurface: boolean;
  readonly assessments: readonly AssessmentEvent[];
  readonly contract?: ContractCompiledEvent;
  readonly terminalVerdicts: readonly VerifierVerdictEvent[];
  /** Last `llm-exchange` whose response carries an in-band error. */
  readonly llmError?: { readonly event: TraceEvent; readonly errorClass: string; readonly message: string };
}

const ev1 = (e: TraceEvent, detail: string): CauseEvidence => ({ eventKind: e.kind, seq: e.seq, detail });

function gatherFacts(trace: Trace): Facts {
  const ev = trace.events;
  const guards = ev.filter((e): e is GuardFiredEvent => e.kind === "guard-fired");
  const completed = ev.filter((e): e is RunCompletedEvent => e.kind === "run-completed").at(-1);
  const lastSnap = ev.filter((e): e is KernelStateSnapshotEvent => e.kind === "kernel-state-snapshot").at(-1);
  const terminalDecision = guards.filter((g) => g.guard === "terminal_decision").at(-1);
  const toolEnds = ev.filter((e): e is ToolCallEvent => e.kind === "tool-call-end");
  const toolStarts = ev.filter((e): e is ToolCallEvent => e.kind === "tool-call-start");
  const realEnds = toolEnds.filter((t) => !isMeta(t.toolName));
  // Ledger tool invocations also count (a delegating parent invokes one tool
  // directly but its ledger carries the delegated tree — analyze.ts `toolFacts`).
  const ledgerReal = ev
    .filter((e): e is LedgerEntryTraceEvent => e.kind === "ledger-entry")
    .flatMap((e) => e.entries)
    .filter((r) => r.kind === "tool-invocation" && typeof r.toolName === "string" && !isMeta(r.toolName)).length;
  const eventReal = toolStarts.filter((t) => !isMeta(t.toolName)).length;
  const surface = ev.filter((e): e is ToolSurfaceResolvedEvent => e.kind === "tool-surface-resolved").at(-1);
  const tdMeta = metaOf(terminalDecision);
  const lastLlmErr = ev
    .filter((e): e is LLMExchangeEvent => e.kind === "llm-exchange" && e.response?.error !== undefined)
    .at(-1);
  const terminatedBy =
    completed?.terminatedBy ?? str(tdMeta, "terminatedBy") ?? terminalDecision?.reason ?? lastSnap?.terminatedBy;
  return {
    ev,
    started: ev.find((e): e is RunStartedEvent => e.kind === "run-started"),
    completed,
    aborted: ev.filter((e): e is RunAbortedEvent => e.kind === "run-aborted").at(-1),
    lastSnap,
    guards,
    terminalDecision,
    override: guards.filter((g) => g.guard === "terminal_status_override").at(-1),
    deliverable: guards.filter((g) => g.guard === "deliverable_decision").at(-1),
    status: completed?.status,
    isSuccess: completed?.status === "success",
    ...(terminatedBy !== undefined ? { terminatedBy } : {}),
    toolEnds,
    realEnds,
    realCalls: Math.max(ledgerReal, eventReal, realEnds.length),
    metaCalls: toolStarts.filter((t) => isMeta(t.toolName)).length,
    visibleReal: (surface?.visible ?? []).filter((n) => !isMeta(n)),
    hasSurface: surface !== undefined,
    assessments: ev.filter((e): e is AssessmentEvent => e.kind === "assessment"),
    contract: ev.filter((e): e is ContractCompiledEvent => e.kind === "contract-compiled").at(0),
    ...(lastLlmErr?.response?.error
      ? { llmError: { event: lastLlmErr, errorClass: lastLlmErr.response.error.class, message: lastLlmErr.response.error.message } }
      : {}),
    terminalVerdicts: ev.filter(
      (e): e is VerifierVerdictEvent => e.kind === "verifier-verdict" && e.terminal && e.source !== "runtime",
    ),
  };
}

/** Compact rendering of a guard's `{counter, observed, threshold}` evidence. */
function guardEvidence(g: GuardFiredEvent): { text: string; hasCounter: boolean } {
  const m = metaOf(g);
  const counter = str(m, "counter");
  const observed = num(m, "observed");
  const threshold = num(m, "threshold");
  if (counter !== undefined && observed !== undefined && threshold !== undefined) {
    return { text: `${g.guard}: ${counter} ${observed}/${threshold}`, hasCounter: true };
  }
  return { text: `${g.guard}: ${g.reason.slice(0, 80)}`, hasCounter: false };
}

const PROVIDER_SUBCLASSES: readonly (readonly [RegExp, string])[] = [
  [/credit balance|insufficient[_ ]quota|billing|quota/i, "quota"],
  [/api key|unauthori[sz]ed|\b401\b|\b403\b|authentication/i, "auth"],
  [/rate.?limit|\b429\b/i, "rate"],
  [/not found locally|model.{0,30}not found|does not exist|unknown model/i, "model-not-found"],
  [/\b413\b|too large|context.{0,12}(length|window|overflow)|maximum context/i, "context-overflow"],
  [/not supported|unsupported|reasoning_effort|does not support/i, "unsupported-params"],
  [/timeout|timed out|ETIMEDOUT/i, "timeout"],
  [/ECONNREFUSED|ENOTFOUND|fetch failed|network/i, "network"],
];

/** Provider error class name (`outcome.errorClass`, in-band exchange error) -> sub-class. Generic `LLMError` falls through to the text table. */
const PROVIDER_CLASS_SUBCLASSES: readonly (readonly [RegExp, string])[] = [
  [/RateLimit/i, "rate"],
  [/Timeout/i, "timeout"],
  [/ContextOverflow|ContextLength/i, "context-overflow"],
  [/Parse/i, "parse"],
  [/Auth/i, "auth"],
];

const UTILITY_ORIGINS: ReadonlySet<string> = new Set(["cortex-utility"]);

/** Ordered rule list. Each rule returns a {@link Verdict} or `undefined`. */
type Rule = (f: Facts) => Verdict | undefined;

/** A trace holding only `llm-exchange` events (the shared `llm-direct` sink): a direct chat, not a run. */
const ruleDirectChat: Rule = (f) => {
  if (f.started || f.completed || f.aborted) return undefined;
  if (f.ev.length === 0 || !f.ev.every((e) => e.kind === "llm-exchange")) return undefined;
  return {
    cause: "direct-chat",
    evidence: [ev1(f.ev[0]!, `${f.ev.length} llm-exchange event(s), no run-started/run-completed/run-aborted: direct chat path, not an agent run`)],
    needs: [],
  };
};

const ABORT_CAUSES = { timeout: "timeout", "user-stop": "user-stop" } as const;

const ruleIncomplete: Rule = (f) => {
  if (f.completed !== undefined) return undefined;
  if (f.aborted !== undefined) {
    const a = f.aborted;
    const detail = `run-aborted causeClass=${a.causeClass}${a.reason ? ` reason=${a.reason}` : ""}${a.error ? ` error=${a.error}` : ""}`;
    if (a.reason === "timeout" || a.reason === "user-stop") {
      return { cause: ABORT_CAUSES[a.reason], subCause: a.causeClass, evidence: [ev1(a, detail)], needs: [] };
    }
    if (a.reason !== undefined) {
      return { cause: "aborted", subCause: a.reason, evidence: [ev1(a, detail)], needs: [] };
    }
    return { cause: "incomplete-trace", subCause: a.causeClass, evidence: [ev1(a, detail)], needs: [] };
  }
  return { cause: "incomplete-trace", evidence: [], needs: ["run-aborted sentinel (run ended without run-completed or run-aborted)"] };
};

const ruleProvider: Rule = (f) => {
  const td = f.terminalDecision;
  const isLlmError =
    f.terminatedBy === "llm_error" || str(metaOf(td), "authority") === "error" || f.completed?.outcome?.authority === "error";
  if (!isLlmError) return undefined;
  const errText = f.completed?.error ?? "";
  // Structured class first (outcome / terminal_decision / in-band exchange error); regex on error text is the legacy fallback.
  const errorClass = f.completed?.outcome?.errorClass ?? str(metaOf(td), "errorClass") ?? f.llmError?.errorClass;
  const byClass = errorClass !== undefined ? PROVIDER_CLASS_SUBCLASSES.find(([re]) => re.test(errorClass))?.[1] : undefined;
  const text = `${errText} ${f.llmError?.message ?? ""}`;
  const sub = byClass ?? PROVIDER_SUBCLASSES.find(([re]) => re.test(text))?.[1];
  const evidence: CauseEvidence[] = [];
  if (td) evidence.push(ev1(td, `terminal_decision llm_error authority=${str(metaOf(td), "authority") ?? "?"}`));
  if (f.completed) evidence.push(ev1(f.completed, `error=${errText.slice(0, 120)}${errorClass !== undefined ? `; errorClass=${errorClass}` : ""}`));
  return {
    cause: "provider-error",
    ...(sub !== undefined ? { subCause: sub } : {}),
    evidence,
    // The terminal authority alone makes the CAUSE decisive; without it this is a snapshot fallback.
    needs: td === undefined ? ["terminal_decision.authority"] : [],
  };
};

const ruleSatisfiability: Rule = (f) => {
  const g = f.guards.find((x) => x.guard === "satisfiability-preflight");
  if (!g) return undefined;
  const origin = f.started?.origin;
  const utility = origin !== undefined && UTILITY_ORIGINS.has(origin);
  return {
    cause: "satisfiability-abstain",
    ...(utility ? { subCause: "utility-misroute" } : {}),
    evidence: [ev1(g, g.reason.slice(0, 120))],
    needs: f.started?.origin === undefined ? ["run-started.origin"] : [],
  };
};

const ruleMislabel: Rule = (f) => {
  if (f.completed === undefined) return undefined;
  const ev: CauseEvidence[] = [];
  const tdStatus = str(metaOf(f.terminalDecision), "status");
  if (f.isSuccess && f.deliverable?.outcome === "block") {
    ev.push(ev1(f.deliverable, `deliverable_decision=block but run-completed.status=success`));
  }
  // Outcome contradiction: the run-completed status and the reconciled outcome
  // (`outcome.success` / `outcome.status`) are derived once and must agree.
  const oc = f.completed.outcome;
  if (oc !== undefined && f.status !== "cancelled") {
    const claimsOk = f.isSuccess;
    if (claimsOk && oc.success === false) {
      ev.push(ev1(f.completed, `run-completed.status=success vs run-completed.outcome.success=false`));
    } else if (claimsOk && (oc.status === "failed" || oc.status === "abstained" || oc.status === "partial")) {
      ev.push(ev1(f.completed, `run-completed.status=success vs run-completed.outcome.status=${oc.status}`));
    } else if (!claimsOk && oc.success === true) {
      ev.push(ev1(f.completed, `run-completed.status=${f.status} vs run-completed.outcome.success=true`));
    } else if (!claimsOk && oc.status === "completed") {
      ev.push(ev1(f.completed, `run-completed.status=${f.status} vs run-completed.outcome.status=completed`));
    }
  }
  if (f.isSuccess && tdStatus === "failed") {
    ev.push(ev1(f.terminalDecision!, `terminal_decision.status=failed but run-completed.status=success`));
  }
  const lastKernelVerdict = f.terminalVerdicts.at(-1);
  const abstained = f.terminatedBy === "abstained" || f.completed.outcome?.status === "abstained";
  if (
    f.status === "failure" && f.override === undefined && !abstained &&
    lastKernelVerdict?.verified === true && tdStatus === "done"
  ) {
    ev.push(ev1(lastKernelVerdict, `kernel verdict verified=true and terminal_decision=done, but run-completed.status=failure with no terminal_status_override`));
  }
  if (ev.length === 0) return undefined;
  return { cause: "terminal-mislabel", evidence: ev, needs: [] };
};

const rulePlanPosture: Rule = (f) => {
  if (f.isSuccess) return undefined;
  const posture = f.guards.find((g) => g.guard === "posture-applied" && str(metaOf(g), "posture") === "plan");
  const vetoed = f.override !== undefined && f.override.reason === "contract-coverage";
  if (!posture || !vetoed) return undefined;
  return {
    cause: "plan-posture-veto",
    evidence: [ev1(posture, "plan posture restricted the tool surface"), ev1(f.override!, "terminal_status_override reason=contract-coverage")],
    needs: [],
  };
};

const TERMINAL_EXCLUDED = /max_iterations|max-iterations|budget/;
const ruleNeverEngaged: Rule = (f) => {
  if (f.completed === undefined || f.realCalls > 0 || f.visibleReal.length === 0) return undefined;
  if (TERMINAL_EXCLUDED.test(f.terminatedBy ?? "")) return undefined;
  const c = f.contract;
  const demandsWork =
    c !== undefined &&
    (c.deliverables.length > 0 || c.requirements.some((r) => r.kind === "tool-coverage" || r.kind === "artifact-produced"));
  // A successful tool-free answer may be legitimate ("what tools do you have?"
  // is answered without calling any). A verifier reject is NOT corroboration: the
  // `output-not-fabricated-listed-entities` check rejects such honest answers too
  // (3 real-corpus false positives, 2026-11-03). Only a contract that demands tool
  // or artifact work, or a non-success outcome, makes zero calls a finding.
  if (f.isSuccess && !demandsWork) return undefined;
  const why = !f.isSuccess ? `status=${f.status}` : "contract demands tool/artifact work";
  const evidence: CauseEvidence[] = [];
  const surfaceEv = f.ev.find((e) => e.kind === "tool-surface-resolved");
  if (surfaceEv) evidence.push(ev1(surfaceEv, `${f.visibleReal.length} real tool(s) visible: ${f.visibleReal.slice(0, 4).join(",")}`));
  evidence.push(ev1(f.completed, `0 real tool calls; terminatedBy=${f.terminatedBy ?? "?"}; ${why}`));
  return { cause: "never-engaged", evidence, needs: f.terminalDecision === undefined ? ["terminal_decision.authority"] : [] };
};

const ruleToolProtocol: Rule = (f) => {
  if (f.isSuccess) return undefined;
  const sw = f.ev.find(
    (e): e is StrategySwitchedEvent => e.kind === "strategy-switched" && /consecutive-thoughts/.test(e.reason),
  );
  const unresolved = f.guards.find((g) => /unresolved/.test(g.guard)) ??
    (f.terminatedBy !== undefined && /tool_call_unresolved/.test(f.terminatedBy) ? f.guards.at(-1) : undefined);
  if (!sw && !unresolved) return undefined;
  const evidence = [
    ...(sw ? [ev1(sw, `strategy-switched: ${sw.reason.slice(0, 100)}`)] : []),
    ...(unresolved ? [ev1(unresolved, `unresolved tool call: ${unresolved.guard}`)] : []),
  ];
  return { cause: "tool-protocol", evidence, needs: [] };
};

const argKey = (t: ToolCallEvent): string => `${t.toolName}:${JSON.stringify(t.args ?? null)}`;

const ruleToolFailure: Rule = (f) => {
  if (f.isSuccess) return undefined;
  const fails = f.realEnds.filter((t) => t.ok === false);
  const oks = f.realEnds.filter((t) => t.ok !== false);
  let repeatedSame = false;
  for (let i = 1; i < f.realEnds.length; i++) {
    const a = f.realEnds[i - 1]!, b = f.realEnds[i]!;
    if (a.ok === false && b.ok === false && argKey(a) === argKey(b)) repeatedSame = true;
  }
  if (!((fails.length >= 3 && oks.length === 0) || repeatedSame)) return undefined;
  const first = fails[0]!;
  return {
    cause: "tool-failure",
    subCause: repeatedSame ? "repeated-identical-call" : "all-calls-failed",
    evidence: [ev1(first, `${fails.length}/${f.realEnds.length} real tool calls ok:false; first ${first.toolName}: ${(first.error ?? String(first.result ?? "")).slice(0, 100)}`)],
    needs: [],
  };
};

const ruleWrongToolArg: Rule = (f) => {
  if (f.isSuccess) return undefined;
  const firstFail = f.realEnds.find((t) => t.ok === false);
  if (!firstFail) return undefined;
  const later = f.realEnds.find((t) => t.seq > firstFail.seq && t.ok !== false && argKey(t) !== argKey(firstFail));
  if (!later) return undefined;
  return {
    cause: "wrong-tool-arg",
    evidence: [ev1(firstFail, `first failure ${firstFail.toolName}`), ev1(later, `later success ${later.toolName} with different tool/args`)],
    needs: [],
  };
};

const ruleHarnessFallbackAfterWork: Rule = (f) => {
  const stall = f.guards.find((g) => g.guard === "stall_deliverable" && g.outcome === "terminate");
  const loop = f.guards.find((g) => g.guard === "loop_resolution" && g.outcome === "terminate");
  const ender = stall ?? loop;
  if (!ender) return undefined;
  const m = metaOf(ender);
  const artifacts = num(m, stall ? "totalArtifacts" : "loopArtifactCount");
  const earlierDelta = f.assessments.some((a) => a.iter <= ender.iter && a.evidenceDelta > 0);
  const workDone = (artifacts ?? 0) > 0 || earlierDelta;
  const g = guardEvidence(ender);
  const detail = `${g.text}${artifacts !== undefined ? `; artifacts=${artifacts}` : ""}`;
  if (loop && !stall) {
    if (!workDone) return undefined;
    return { cause: "loop-after-work", evidence: [ev1(ender, detail)], needs: g.hasCounter ? [] : ["guard evidence {counter,observed,threshold}"] };
  }
  return {
    cause: workDone ? "stall-after-work" : "stall-no-progress",
    evidence: [ev1(ender, detail)],
    needs: g.hasCounter ? [] : ["guard evidence {counter,observed,threshold}"],
  };
};

const ruleBookkeeping: Rule = (f) => {
  if (f.isSuccess) return undefined;
  const total = f.metaCalls + f.realCalls;
  if (total < 3 || f.metaCalls / total < 0.6) return undefined;
  if (!/max_iterations|max-iterations|low_delta|switch|loop/.test(f.terminatedBy ?? "")) return undefined;
  const anchor = f.completed ?? f.ev.at(-1)!;
  return {
    cause: "bookkeeping-loop",
    evidence: [ev1(anchor, `${f.metaCalls}/${total} tool calls were meta-tools; terminatedBy=${f.terminatedBy}`)],
    needs: [],
  };
};

const ruleVerifierReject: Rule = (f) => {
  if (f.isSuccess || f.deliverable?.outcome !== "block") return undefined;
  const failing = f.terminalVerdicts.flatMap((v) => v.checks.filter((c) => !c.passed).map((c) => c.name)).slice(0, 3);
  return {
    cause: "verifier-reject",
    subCause: f.realCalls === 0 ? "no-tool-evidence" : "tool-evidence-present",
    evidence: [ev1(f.deliverable, `deliverable_decision=block: ${f.deliverable.reason.slice(0, 100)}${failing.length ? `; failing checks: ${failing.join(",")}` : ""}`)],
    needs: [],
  };
};

const ruleBudgetCap: Rule = (f) => {
  if (f.isSuccess) return undefined;
  const cap = rec(metaOf(f.terminalDecision), "iterationCap");
  const capped = cap !== undefined && cap["capped"] === true;
  const observed = cap ? num(cap, "observed") : undefined;
  const threshold = cap ? num(cap, "threshold") : undefined;
  const nearCap = observed !== undefined && threshold !== undefined && observed >= threshold - 1;
  const byReason = /max_iterations|max-iterations|budget/.test(f.terminatedBy ?? "");
  const earlyStop = f.guards.some((g) => g.guard === "dispatcher_early_stop") && nearCap;
  if (!capped && !byReason && !earlyStop) return undefined;
  const last2 = f.assessments.slice(-2);
  const progressing = last2.some((a) => a.evidenceDelta > 0);
  const needs: string[] = [];
  if (cap === undefined) needs.push("terminal_decision.iterationCap {counter,observed,threshold}");
  if (last2.length === 0) needs.push("assessment events");
  const anchor = f.terminalDecision ?? f.completed ?? f.ev.at(-1)!;
  return {
    cause: "budget-cap",
    subCause: last2.length === 0 ? "unknown-progress" : progressing ? "cap-cutoff" : "no-progress-at-cap",
    evidence: [ev1(anchor, `terminatedBy=${f.terminatedBy ?? "?"}${cap ? `; iteration ${observed}/${threshold} capped=${String(capped)}` : ""}; last-2 evidenceDelta>0=${String(progressing)}`)],
    needs,
  };
};

const RULES: readonly Rule[] = [
  ruleDirectChat, ruleIncomplete, ruleProvider, ruleSatisfiability, ruleMislabel, rulePlanPosture, ruleNeverEngaged,
  ruleToolProtocol, ruleToolFailure, ruleWrongToolArg, ruleHarnessFallbackAfterWork,
  ruleBookkeeping, ruleVerifierReject, ruleBudgetCap,
];

/**
 * A success whose own verifier check failed or whose deliverable was accepted
 * only via `advisory-softfail`. Not a failure and not clean: the label states
 * the fact (a check failed, the gate let it through) and never claims the
 * answer is wrong (the trace cannot separate fabrication from a false positive).
 */
function successWarning(f: Facts): { subCause: string; authoritative: boolean; evidence: CauseEvidence[] } | undefined {
  const c = f.completed;
  if (c === undefined) return undefined;
  const failed = c.outcome?.verifierVerdict?.failedChecks ?? [];
  const decisionReason = f.deliverable?.reason ?? c.outcome?.deliverable?.reason ?? "";
  const soft = /advisory-softfail/.test(decisionReason);
  if (failed.length === 0 && !soft) return undefined;
  const evidence: CauseEvidence[] = [];
  if (failed.length > 0) evidence.push(ev1(c, `run-completed.outcome.verifierVerdict.failedChecks=${failed.slice(0, 3).join(",")}`));
  const gateEv = f.deliverable ?? c;
  if (soft) evidence.push(ev1(gateEv, `deliverable_decision=${f.deliverable?.outcome ?? c.outcome?.deliverable?.outcome ?? "?"} (${decisionReason.slice(0, 60)}): accepted despite a failing check`));
  const failing = f.terminalVerdicts.filter((v) => !v.verified).flatMap((v) => v.checks.filter((k) => !k.passed).map((k) => k.name));
  if (failed.length === 0 && failing.length > 0) evidence.push(ev1(f.terminalVerdicts.at(-1)!, `kernel verdict failing checks: ${failing.slice(0, 3).join(",")}`));
  return { subCause: failed[0] ?? failing[0] ?? "advisory-softfail", authoritative: failed.length > 0, evidence };
}

/**
 * Classify why a run ended the way it did, from trace events only.
 *
 * Pure and deterministic: ordered predicates, first match wins. Returns
 * `confidence: "insufficient-trace"` (cause `undetermined`) instead of
 * guessing when a trace lacks the terminal signals. Never reads model text.
 *
 * @param trace A loaded trace (one run).
 * @returns The cause, confidence, supporting evidence and the signals whose
 *   absence kept the verdict from being decisive.
 */
export function analyzeCause(trace: Trace): CauseAnalysis {
  const f = gatherFacts(trace);
  const authority = f.completed?.outcome?.authority ?? str(metaOf(f.terminalDecision), "authority");
  const kernelAuthority = f.completed?.outcome?.kernelAuthority;
  const outcomeStatus = f.status ?? (f.aborted ? "aborted" : ruleDirectChat(f) ? "direct-chat" : "unknown");
  const common = {
    runId: trace.runId,
    ...(authority !== undefined ? { authority } : {}),
    ...(kernelAuthority !== undefined ? { kernelAuthority } : {}),
    outcomeStatus,
  };

  for (const rule of RULES) {
    const v = rule(f);
    if (!v) continue;
    return {
      ...common,
      cause: v.cause,
      ...(v.subCause !== undefined ? { subCause: v.subCause } : {}),
      confidence: v.needs.length === 0 ? "decisive" : "probable",
      evidence: v.evidence,
      missing: v.needs,
    };
  }

  // Residual. Needs a terminal signal to claim anything.
  if (f.completed === undefined) {
    return { ...common, cause: "undetermined", confidence: "insufficient-trace", evidence: [], missing: ["run-completed"] };
  }
  const missing: string[] = [];
  if (f.terminalDecision === undefined) missing.push("terminal_decision.authority");
  if (f.completed.outcome === undefined) missing.push("run-completed.outcome");
  if (f.isSuccess) {
    const accepted = f.deliverable?.outcome === "pass";
    if (!accepted && f.deliverable === undefined) missing.push("deliverable_decision");
    // The kernel verifier rejected yet the run succeeded: cannot tell true
    // fabrication from a false positive without the evidence set (audit rank 5).
    if (f.terminalVerdicts.some((v) => !v.verified)) missing.push("verifier evidence set {inspectedChars, matchedValue} (audit rank 5)");
    const warn = successWarning(f);
    if (warn) {
      return {
        ...common,
        cause: "success-with-warning",
        subCause: warn.subCause,
        confidence: warn.authoritative ? "decisive" : "probable",
        evidence: warn.evidence,
        missing: warn.authoritative ? [] : ["run-completed.outcome.verifierVerdict"],
      };
    }
    return {
      ...common,
      cause: "none",
      confidence: missing.length === 0 ? "decisive" : "probable",
      evidence: [ev1(f.completed, `status=success terminatedBy=${f.terminatedBy ?? "?"}${f.deliverable ? `; deliverable_decision=${f.deliverable.outcome} (${f.deliverable.reason.slice(0, 40)})` : ""}`)],
      missing,
    };
  }
  if (f.terminalDecision === undefined) {
    return { ...common, cause: "undetermined", confidence: "insufficient-trace", evidence: [ev1(f.completed, `status=${f.status} terminatedBy=${f.terminatedBy ?? "?"}`)], missing };
  }
  return {
    ...common,
    cause: "unexplained",
    confidence: "probable",
    evidence: [ev1(f.completed, `status=${f.status} terminatedBy=${f.terminatedBy ?? "?"}; no rule matched (candidate model-incapable — needs cohort comparison)`)],
    missing: ["cohort comparison set (model-incapable)"],
  };
}

/** One-line human rendering of a {@link CauseAnalysis}. */
export function renderCause(c: CauseAnalysis): string {
  const L: string[] = [];
  L.push(`${c.runId}: cause=${c.cause}${c.subCause ? `/${c.subCause}` : ""} confidence=${c.confidence} status=${c.outcomeStatus}${c.authority ? ` authority=${c.authority}` : ""}`);
  for (const e of c.evidence) L.push(`  evidence  ${e.eventKind}#${e.seq}  ${e.detail}`);
  if (c.missing.length > 0) L.push(`  missing   ${c.missing.join("; ")}`);
  return L.join("\n");
}

/** Cohort tally of causes across many runs (audit rule 13 cohort mode). */
export interface CauseTally {
  /** Runs tallied. Direct-chat traces are not runs and are excluded (see `notRuns`). */
  readonly total: number;
  readonly byCause: Readonly<Record<string, number>>;
  readonly byConfidence: Readonly<Record<CauseConfidence, number>>;
  /** `cause|outcomeStatus` → count, so a cause on successful runs is distinguishable. */
  readonly byCauseAndStatus: Readonly<Record<string, number>>;
  /** `direct-chat` traces skipped (no run lifecycle by design). */
  readonly notRuns: number;
}

/**
 * Tally {@link CauseAnalysis} results across a cohort. `direct-chat` results
 * are counted in `notRuns` only.
 *
 * @param analyses One analysis per run.
 * @returns Counts by cause, by confidence, and by cause x outcome status.
 */
export function tallyCauses(analyses: readonly CauseAnalysis[]): CauseTally {
  const byCause: Record<string, number> = {};
  const byCauseAndStatus: Record<string, number> = {};
  const byConfidence: Record<CauseConfidence, number> = { decisive: 0, probable: 0, "insufficient-trace": 0 };
  let notRuns = 0;
  let total = 0;
  for (const a of analyses) {
    if (a.cause === "direct-chat") { notRuns += 1; continue; }
    total += 1;
    byCause[a.cause] = (byCause[a.cause] ?? 0) + 1;
    const k = `${a.cause}|${a.outcomeStatus}`;
    byCauseAndStatus[k] = (byCauseAndStatus[k] ?? 0) + 1;
    byConfidence[a.confidence] += 1;
  }
  return { total, byCause, byConfidence, byCauseAndStatus, notRuns };
}
