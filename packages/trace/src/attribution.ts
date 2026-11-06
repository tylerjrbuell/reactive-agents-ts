// packages/trace/src/attribution.ts
//
// Zero-token harness-vs-model attribution (feedback-loop design D2,
// wiki/Research/Audit-Reports-2026-11-03/feedback-loop-map.md §3).
//
// `analyzeCause` says HOW a run ended. This module answers the next question a
// developer asks about a failed run: "is it my harness configuration or the
// model?". It locates the turn that produced the failing artifact or answer
// (the divergence turn), checks whether the evidence that turn needed was in
// its projected request, and checks what the harness did around it (dropped,
// refused or mangled tool calls, stops, vetoes, guidance).
//
// HONESTY RULES (load-bearing, same as cause.ts):
//   - Reads trace events only. It reads the projected request text and the
//     response tool calls of `llm-exchange` events (what the model SAW and
//     ASKED FOR) and the task text of `run-started` (which inputs it lists),
//     never the model's prose to judge whether it is right. One bounded
//     exception: the end of the shipped output is read for an offer to
//     continue (an intent, not a correctness judgment).
//   - Never guesses. A rule fires only on facts the trace records; a rule
//     whose facts are partly hidden (request text clipped by the recorder)
//     reports `probable` and names the hidden signal in `missing`. When no rule
//     can prove a side, the verdict is `unattributed` with `missing` filled.
//   - "Right or wrong" comes from outside the run: an `eval-graded` event, or
//     the run's own failure status. Without a grader, rules that need to know
//     the output was WRONG (model:had-evidence-wrong-output) do not fire.
//
// Rules, in order (first match is the verdict; every other rule that also
// matched is listed in `alsoMatched`). Rules marked [r] live in attribution-rules.ts,
// rules marked [g] in attribution-guidance.ts.
//   model:fabrication-vetoed    the run's terminal verifier refused invented numbers or
//                               entities (`output-not-fabricated-*`); a grader that
//                               passed a partial check does not make that veto false
//   harness:false-veto          grader passed but the run was marked failed; or
//                               a deliverable that names a template placeholder
//   harness:tool-surface        a contract-required tool was hidden from the model
//   harness:tool-not-offered [r] the model asked for a tool its request did not offer
//   harness:contradictory-guidance [g]  the deciding turn told the model to call a tool
//                               its request offered no schema for, and the model tried
//   harness:subpass-abstained   a kernel pass abstained before its first LLM call and the
//                               run kept going on top of it
//   harness:tool-call-dropped   the model emitted a native call the harness never ran
//                               (matched per call by tool AND path, so a drop inside a
//                               batch is not hidden by a sibling call that ran); a drop
//                               that repeats, with the same args, a call that already
//                               failed twice is not a harness loss and does not count
//   harness:refusal-counted-as-repeat [r]  decisive form: the repetition guard replaced a
//                               first read of a listed input, or a first write whose
//                               value the failed check expected
//   harness:tool-call-corrupted a text-parsed call reached the tool with mangled args
//   harness:plan-fanout-blob [r] a failing file holds harness-resolved content that was
//                               also written verbatim to another file
//   harness:premature-stop      a harness stop shipped a pre-evidence answer, or cut a
//                               run whose evidence was still growing
//   harness:completeness-blind  the run ended on its own with nothing outstanding while
//                               grader-required files were never written and the
//                               contract never listed them
//   harness:offer-accepted-as-done [r]  the run ended on the model's turn and the shipped
//                               output offers to continue instead of claiming done
//   harness:evidence-withheld [r] the tool gate refused the model's read of a listed input
//   harness:evidence-truncated  evidence was produced, then dropped/compressed
//                               before the divergence turn (projection compressions count)
//   harness:evidence-missing    evidence was produced but is absent from the
//                               divergence turn's request (no drop recorded)
//   harness:misleading-guidance guidance steered to a tool already satisfied and the
//                               model followed it while the deliverable stayed unmade
//                               (a retry steer naming a tool whose own last call failed
//                               is correct guidance, whatever the ledger counted)
//   model:ignored-guidance      correct guidance (call an unsatisfied required tool)
//                               was rendered and the model did not call it
//   model:evidence-not-gathered [r] the failing output was produced while a listed input
//                               was never read, and nothing stopped the read
//   model:had-evidence-wrong-output  the divergence turn's request held the
//                               evidence and the graded output still failed
//   harness:refusal-counted-as-repeat [r]  probable form: the guard replaced the first
//                               write of a failing file; its content is unknown to pass
//   (cause fallback)            no rule fired: the failure cause's owner from the shared
//                               taxonomy (taxonomy.ts CAUSE_ATTRIBUTION), `probable`,
//                               with `cause` set
//   unattributed                no rule and no owned cause could prove a side (see `missing`)

import type { Trace } from "./replay.js";
import { analyzeCause, type CauseConfidence, type CauseEvidence } from "./cause.js";
import { guardEndedRun } from "./guard-run-end.js";
import { CAUSE_ATTRIBUTION, verdictOf, type AttributionReason, type AttributionVerdict } from "./taxonomy.js";
import type {
  LLMExchangeEvent,
  ToolCallEvent,
  ToolSurfaceResolvedEvent,
  GuardFiredEvent,
  HarnessSignalInjectedEvent,
  SignalRenderedEvent,
  SignalEffectEvent,
  ProjectionRenderedEvent,
  CuratorDecisionEvent,
  LedgerEntryTraceEvent,
} from "./events.js";
import {
  isMeta, isWriter, HARNESS_STOP, OBJECT_LITERAL_FRAGMENT, LOCATOR_ARG, RECORDER_MESSAGE_CAP,
  str, strArr, ev1, clip, oneLine, gatherFacts, baseName, artifactRef, isTemplate, refMatcher,
  argPath, pickTargets, exchangeBefore, divergenceFor, requestView, ALREADY_DONE, resultText,
  ELIDED_LINES, presence, curatedPresence, HARNESS_NOTICE, evidenceBefore, nativeCalls, executedOk,
  type Meta, type Facts, type Divergence, type RequestView, type Presence, type Ctx, type Hit, type Rule,
} from "./attribution-facts.js";
import {
  ruleToolNotOffered, ruleRefusalCountedAsRepeat, ruleRefusalCountedAsRepeatProbable, ruleEvidenceWithheld,
  rulePlanFanoutBlob, ruleOfferAcceptedAsDone, ruleEvidenceNotGathered,
} from "./attribution-rules.js";
import { ruleContradictoryGuidance } from "./attribution-guidance.js";

export type { AttributionReason, AttributionVerdict } from "./taxonomy.js";

/** The turn whose output produced the failing artifact or answer. */
export interface DivergenceTurn {
  readonly iter: number;
  /** `seq` of the `llm-exchange` event of that turn. */
  readonly seq: number;
}

/** What the attribution judged: a file the run had to write, or its answer. */
export interface AttributionTarget {
  readonly kind: "file" | "answer";
  /** File name (or template, e.g. `out-N.txt`) for `file`; `answer` for `answer`. */
  readonly ref: string;
  /** Where the target came from: a grader check name, the contract, the outcome, or the run's writes. */
  readonly source: "grader-check" | "contract" | "outcome-outstanding" | "run-writes" | "final-output";
}

/** Output of {@link attributeFailure}. */
export interface Attribution {
  readonly runId: string;
  readonly verdict: AttributionVerdict;
  readonly reason: AttributionReason;
  readonly confidence: CauseConfidence;
  /** Absent when the failing artifact was never produced (or the run did not fail). */
  readonly divergenceTurn?: DivergenceTurn;
  /** The artifact or answer the attribution judged. Absent on `not-failed`. */
  readonly target?: AttributionTarget;
  /** Trace events that support the verdict. */
  readonly evidence: readonly CauseEvidence[];
  /** Trace signals that would have made the verdict decisive (or possible) but were absent. */
  readonly missing: readonly string[];
  /** Other reasons whose rule also matched, in rule order (contributing factors). */
  readonly alsoMatched: readonly AttributionReason[];
  /** Which failure signals fired (`run-completed.status=failure`, `eval-graded.passed=false`, ...). */
  readonly failureSignals: readonly string[];
  /** Present when the reason came from the failure cause (no turn-level rule fired): `cause[/subCause]`. */
  readonly cause?: string;
}

// ─── Rules ────────────────────────────────────────────────────────────────────

/** A terminal verifier check that rejects invented numbers or entities. */
const FABRICATION_CHECK = /^output-not-fabricated/;

// The run's own fabrication check refused the answer. A passing grader that only
// checks part of the task (e.g. the written file) does not make that veto false.
// Only when the vetoed output was the model's own: a verdict that also failed
// `output-is-model-authored` judged harness-assembled text (see false-veto).
const ruleFabricationVetoed: Rule = ({ f }) => {
  const reject = f.ev.filter((e) => e.kind === "verifier-verdict" && e.terminal && !e.verified && e.checks.some((c) => !c.passed && FABRICATION_CHECK.test(c.name))).at(-1);
  if (reject === undefined || reject.kind !== "verifier-verdict") return undefined;
  if (reject.checks.some((c) => !c.passed && c.name === "output-is-model-authored")) return undefined;
  const names = reject.checks.filter((c) => !c.passed && FABRICATION_CHECK.test(c.name)).map((c) => c.name);
  return {
    reason: "model:fabrication-vetoed",
    evidence: [ev1(reject, `${reject.source ?? "kernel"} verifier rejected ${names.join(",")}`)],
    needs: [],
  };
};

// A kernel pass abstained before its first LLM call and the run kept going on
// top of it (e.g. a plan step held to a required tool it could not see).
const ruleSubpassAbstained: Rule = ({ f }) => {
  const lastExchange = f.exchanges.at(-1);
  const pre = f.ev.find((g): g is GuardFiredEvent => {
    if (g.kind !== "guard-fired" || g.guard !== "terminal_decision" || g.reason !== "abstained") return false;
    const cap = g.metadata?.["iterationCap"];
    const calls = typeof cap === "object" && cap !== null && "llmCalls" in cap ? cap.llmCalls : undefined;
    return calls === 0 && lastExchange !== undefined && lastExchange.seq > g.seq;
  });
  if (pre === undefined) return undefined;
  return {
    reason: "harness:subpass-abstained",
    evidence: [ev1(pre, `a pass abstained with 0 LLM calls at seq ${pre.seq}; the run continued to seq ${lastExchange!.seq}`)],
    needs: ["tool-surface-resolved for the abstaining pass (which required tool was missing)"],
  };
};

const ruleFalseVeto: Rule = ({ f }) => {
  const g = f.grade;
  if (g !== undefined && g.passed) {
    const ev: CauseEvidence[] = [ev1(g, `eval-graded ${g.grader}: score=${g.score.toFixed(3)} passed=true`)];
    if (f.completed) {
      const oc = f.completed.outcome;
      ev.push(ev1(f.completed, `run-completed.status=${f.completed.status}${oc?.authority ? ` authority=${oc.authority}` : ""}${oc?.outstanding?.length ? ` outstanding=${oc.outstanding.join(",")}` : ""}`));
    }
    const runtimeReject = f.ev.filter((e) => e.kind === "verifier-verdict" && e.terminal && !e.verified).at(-1);
    if (runtimeReject && runtimeReject.kind === "verifier-verdict") {
      ev.push(ev1(runtimeReject, `${runtimeReject.source ?? "kernel"} verifier rejected: ${runtimeReject.checks.filter((c) => !c.passed).map((c) => c.name).slice(0, 3).join(",")}`));
    }
    return { reason: "harness:false-veto", evidence: ev, needs: [] };
  }
  // Without a grader: an outstanding deliverable that is a template can never exist as named.
  const tmpl = f.outstanding.filter((o) => o.startsWith("artifact:") && isTemplate(artifactRef(o)));
  if (tmpl.length === 0 || f.completed === undefined) return undefined;
  const match = refMatcher(artifactRef(tmpl[0]!));
  const writes = f.toolEnds.filter((t) => t.ok !== false && argPath(t.args) !== undefined && match(argPath(t.args)!));
  if (writes.length === 0) return undefined;
  return {
    reason: "harness:false-veto",
    evidence: [
      ev1(f.completed, `outstanding deliverable ${tmpl[0]} is a template placeholder, not a file name`),
      ev1(writes.at(-1)!, `${writes.length} successful write(s) match the template (e.g. ${baseName(argPath(writes.at(-1)!.args)!)})`),
    ],
    // `probable` until a grader confirms the files were right.
    needs: g === undefined ? ["eval-graded (a grader verdict on the written files)"] : [],
  };
};

const ruleToolSurface: Rule = ({ f, first }) => {
  const needed = f.requiredTools.filter((t) => !f.toolEnds.some((e) => e.toolName === t && e.ok !== false));
  if (needed.length === 0) return undefined;
  const cutoff = first?.exchange.seq ?? Number.POSITIVE_INFINITY;
  const surfaces = f.ev.filter((e): e is ToolSurfaceResolvedEvent => e.kind === "tool-surface-resolved" && e.seq <= cutoff);
  for (const s of [...surfaces].reverse()) {
    const hidden = s.reasons.find((r) => needed.includes(r.tool) && r.reason.startsWith("hidden:"));
    if (hidden) {
      return {
        reason: "harness:tool-surface",
        evidence: [ev1(s, `required tool ${hidden.tool} not visible to the model: ${hidden.reason}`)],
        needs: [],
        ...(first ? { divergence: first } : {}),
      };
    }
  }
  return undefined;
};

interface DroppedCall {
  readonly x: LLMExchangeEvent;
  readonly name: string;
  readonly args: unknown;
  readonly path?: string;
}

/**
 * Native non-meta calls the model emitted that never reached a tool-call-start/end
 * before the next exchange, matched per call by tool name and target path (see
 * `nativeCalls`). A call the tool gate refused and answered
 * (`guard-fired{guard:"tool-gate"}` naming the tool) is not dropped: the model saw why.
 */
function droppedCalls(f: Facts): readonly DroppedCall[] {
  return nativeCalls(f).filter((c) => c.fate === "dropped").map((c) => ({ x: c.x, name: c.name, args: c.args, ...(c.path !== undefined ? { path: c.path } : {}) }));
}

/**
 * Args in a comparable form: keys sorted at every depth and the path reduced to
 * its base name (the model writes `./out.json`, the tool records the resolved
 * absolute path), so a retry with reordered keys compares equal.
 */
function canonicalArgs(args: unknown): string {
  const norm = (v: unknown): unknown => Array.isArray(v) ? v.map(norm)
    : typeof v === "object" && v !== null ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm((v as Meta)[k])])) : v;
  const a = norm(args);
  const p = argPath(a);
  return JSON.stringify(p !== undefined ? { ...(a as Meta), path: baseName(p) } : a ?? null);
}

/** Identical failed calls before a drop at which the drop stops being a harness loss. */
const IDENTICAL_FAILURES = 2;

/**
 * Failed calls of the same tool with the same canonical args before the drop.
 * At {@link IDENTICAL_FAILURES} or more the dropped call was a repeat of a call
 * that already failed deterministically: running it would have failed again, so
 * dropping it lost nothing (Workstream H verdict 2026-11-06, instrument fault (a)).
 */
const identicalFailuresBefore = (f: Facts, d: DroppedCall): readonly ToolCallEvent[] => {
  const key = canonicalArgs(d.args);
  return f.toolEnds.filter((e) => e.toolName === d.name && e.ok === false && e.seq < d.x.seq && canonicalArgs(e.args) === key);
};

const ruleToolCallDropped: Rule = ({ f, targets, divergences }) => {
  const drops = droppedCalls(f).filter((d) => identicalFailuresBefore(f, d).length < IDENTICAL_FAILURES);
  if (drops.length === 0) return undefined;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!;
    if (t.kind !== "file" || divergences[i] !== undefined) continue;
    const match = refMatcher(t.ref);
    const d = drops.find((x) => x.path !== undefined && match(x.path));
    if (!d) continue;
    const switched = f.ev.find((e) => e.kind === "strategy-switched" && e.seq > d.x.seq);
    return {
      reason: "harness:tool-call-dropped",
      target: t,
      divergence: { target: t, exchange: d.x },
      evidence: [
        ev1(d.x, `model emitted native ${d.name}(${baseName(d.path!)}) — no tool-call-start/end followed before the next turn`),
        ...(switched && switched.kind === "strategy-switched" ? [ev1(switched, `strategy-switched ${switched.from}->${switched.to}: ${clip(oneLine(switched.reason), 80)}`)] : []),
        ...(f.completed ? [ev1(f.completed, `${t.ref} was never written`)] : []),
      ],
      needs: [],
    };
  }
  // A dropped call on a resource the run never reached afterwards (e.g. the
  // read for notes-2.txt). A drop that repeats a call which already failed on
  // the same resource changes nothing, so it is not linked.
  const sameResource = (e: ToolCallEvent, d: { readonly name: string; readonly path?: string }): boolean =>
    e.toolName === d.name && (d.path === undefined || baseName(argPath(e.args) ?? "") === baseName(d.path));
  const req = drops.find((d) =>
    (d.path !== undefined || f.requiredTools.includes(d.name)) &&
    !f.toolEnds.some((e) => sameResource(e, d) && executedOk(e) && e.seq > d.x.seq) &&
    !f.toolEnds.some((e) => sameResource(e, d) && e.ok === false && e.seq < d.x.seq));
  if (!req) return undefined;
  const what = `${req.name}${req.path !== undefined ? `(${baseName(req.path)})` : ""}`;
  const switched = f.ev.find((e) => e.kind === "strategy-switched" && e.seq > req.x.seq);
  const batch = (req.x.response.toolCalls ?? []).filter((c) => !isMeta(c.name)).length;
  return {
    reason: "harness:tool-call-dropped",
    evidence: [
      ev1(req.x, `model emitted native ${what}${batch > 1 ? ` (one of ${batch} calls in the batch)` : ""} — no tool-call-start/end followed, and the run never reached it afterwards`),
      ...(switched && switched.kind === "strategy-switched" ? [ev1(switched, `strategy-switched ${switched.from}->${switched.to}: ${clip(oneLine(switched.reason), 80)}`)] : []),
    ],
    needs: [],
  };
};

/** Failed calls whose string args carry object-literal source text the model did not emit natively. */
function corruptedCalls(f: Facts): readonly { readonly end: ToolCallEvent; readonly x?: LLMExchangeEvent; readonly fragment: string }[] {
  const out: { end: ToolCallEvent; x?: LLMExchangeEvent; fragment: string }[] = [];
  for (const end of f.toolEnds) {
    if (end.ok !== false || isMeta(end.toolName)) continue;
    const args = typeof end.args === "object" && end.args !== null ? (end.args as Meta) : {};
    // Only locator args: a `content` arg may legitimately hold JSON or code.
    const fragment = Object.entries(args)
      .filter(([k]) => LOCATOR_ARG.test(k))
      .map(([, v]) => v)
      .find((v): v is string => typeof v === "string" && OBJECT_LITERAL_FRAGMENT.test(v));
    if (fragment === undefined) continue;
    const x = exchangeBefore(f, end.seq);
    // The model itself emitted the mangled value as a native call: not the harness.
    const native = (x?.response.toolCalls ?? []).some((c) => c.name === end.toolName && OBJECT_LITERAL_FRAGMENT.test(JSON.stringify(c.arguments ?? null)));
    if (native) continue;
    out.push({ end, ...(x ? { x } : {}), fragment });
  }
  return out;
}

const ruleToolCallCorrupted: Rule = ({ f, first }) => {
  const cutoff = first?.exchange.seq ?? Number.POSITIVE_INFINITY;
  for (const c of corruptedCalls(f)) {
    if (c.end.seq >= cutoff) continue;
    // Linked only if the harness-mangled tool never succeeded before the decision point.
    const recovered = f.toolEnds.some((t) => t.toolName === c.end.toolName && t.ok !== false && t.seq > c.end.seq && t.seq < cutoff);
    if (recovered) continue;
    const printed = c.x !== undefined && (c.x.response.toolCalls ?? []).length === 0 && c.x.response.content.includes(c.end.toolName);
    return {
      reason: "harness:tool-call-corrupted",
      ...(first ? { divergence: first } : {}),
      evidence: [
        ...(c.x ? [ev1(c.x, `model printed the ${c.end.toolName} call as text (no native tool call); the harness parsed it`)] : []),
        ev1(c.end, `${c.end.toolName} received object-literal source as an argument value: ...${clip(oneLine(c.fragment.slice(Math.max(0, (c.fragment.search(OBJECT_LITERAL_FRAGMENT)) - 12))), 70)}; error: ${clip(oneLine(c.end.error ?? ""), 60)}`),
        ...(first ? [ev1(first.exchange, `divergence turn ran with no successful ${c.end.toolName} result`)] : f.completed ? [ev1(f.completed, `${c.end.toolName} never succeeded afterwards; terminatedBy=${f.terminatedBy ?? "?"}`)] : []),
      ],
      needs: printed ? [] : ["llm-exchange response text for the parsed call"],
    };
  }
  return undefined;
};

const rulePrematureStop: Rule = ({ f, targets, divergences, first }) => {
  const by = f.terminatedBy ?? "";
  if (!HARNESS_STOP.test(by)) return undefined;
  const anchor = f.terminalDecision ?? f.completed;
  if (!anchor) return undefined;
  // A: the shipped answer comes from a turn that predates the run's evidence.
  if (first && first.target.kind === "answer") {
    const later = f.toolEnds.filter((t) => t.seq > first.exchange.seq && t.ok !== false && !isMeta(t.toolName) && !HARNESS_NOTICE.test(resultText(t)) && !isWriter(t.toolName));
    if (later.length > 0 && evidenceBefore(f, first.exchange.seq).length === 0) {
      return {
        reason: "harness:premature-stop",
        divergence: first,
        evidence: [
          ev1(anchor, `harness stop terminatedBy=${by} shipped the output of turn seq ${first.exchange.seq}`),
          ev1(first.exchange, `that turn's request held no tool evidence`),
          ev1(later[0]!, `${later.length} successful ${later[0]!.toolName} result(s) arrived after it`),
        ],
        needs: [],
      };
    }
  }
  // B: a file deliverable was never written and evidence was still growing at the stop.
  const unwritten = targets.filter((t, i) => t.kind === "file" && divergences[i] === undefined);
  if (unwritten.length === 0) return undefined;
  // Without assessment events the trace cannot show the evidence was still growing.
  const last2 = f.assessments.slice(-2);
  if (last2.length < 2 || !last2.every((a) => a.evidenceDelta > 0)) return undefined;
  // Progress means NEW results: a repetition notice in the final iterations is a loop, not growth.
  const lastIter = last2[0]!.iter;
  const repeating = f.toolEnds.some((t) => t.iter >= lastIter && (ALREADY_DONE.test(resultText(t)) || HARNESS_NOTICE.test(resultText(t))));
  if (repeating) return undefined;
  const { observed, threshold } = stopBudget(f);
  const roomLeft = observed !== undefined && threshold !== undefined ? threshold - observed : undefined;
  return {
    reason: "harness:premature-stop",
    target: unwritten[0]!,
    evidence: [
      ev1(anchor, `harness stop terminatedBy=${by}${roomLeft !== undefined ? ` at iteration ${observed}/${threshold}` : ""}; ${unwritten.map((t) => t.ref).join(",")} never written`),
      ev1(last2.at(-1)!, `evidence still growing at the stop: last-2 evidenceDelta=${last2.map((a) => a.evidenceDelta).join(",")}, no repeated calls`),
    ],
    // A stop at the cap's edge saved little budget: the remaining work may not have fit anyway.
    needs: roomLeft === undefined
      ? ["stop budget {observed,threshold} on the terminal guard"]
      : roomLeft < 2 ? ["whether the unwritten deliverables fit in the iterations the stop saved"] : [],
  };
};

/** Iteration `{observed, threshold}` of the guard that stopped the run (an iteration-counted stop guard, else terminal_decision.iterationCap). */
function stopBudget(f: Facts): { readonly observed?: number; readonly threshold?: number } {
  // The stop that ENDED the run (exit-gate decision, not a denied proposal's pre-gate label).
  const stopGuard = f.ev.filter((e, i): e is GuardFiredEvent =>
    e.kind === "guard-fired" && guardEndedRun(f.ev, i) && e.guard !== "terminal_decision" && str(e.metadata, "counter") === "iteration").at(-1);
  const cap = f.terminalDecision?.metadata?.["iterationCap"];
  const src: Meta | undefined = stopGuard?.metadata ?? (typeof cap === "object" && cap !== null && !Array.isArray(cap) ? (cap as Meta) : undefined);
  const o = src?.["observed"], t = src?.["threshold"];
  return { ...(typeof o === "number" ? { observed: o } : {}), ...(typeof t === "number" ? { threshold: t } : {}) };
}

interface EvidenceCheck {
  readonly results: readonly ToolCallEvent[];
  readonly present: readonly ToolCallEvent[];
  readonly elided: readonly ToolCallEvent[];
  readonly absent: readonly ToolCallEvent[];
  readonly unverifiable: readonly ToolCallEvent[];
  readonly req: RequestView;
}
function checkEvidence(f: Facts, d: Divergence): EvidenceCheck {
  const req = requestView(d.exchange);
  const results = evidenceBefore(f, d.exchange.seq);
  const by: Record<Presence, ToolCallEvent[]> = { present: [], elided: [], absent: [], unverifiable: [] };
  for (const r of results) by[curatedPresence(f, d.exchange, r, presence(r, req), results)].push(r);
  return { results, present: by.present, elided: by.elided, absent: by.absent, unverifiable: by.unverifiable, req };
}

const droppedRefsBefore = (f: Facts, d: Divergence): readonly CauseEvidence[] => {
  const out: CauseEvidence[] = [];
  for (const e of f.ev) {
    if (e.seq > d.exchange.seq) break;
    if (e.kind === "projection-rendered") {
      const p: ProjectionRenderedEvent = e;
      if (p.droppedRefs.length > 0) out.push(ev1(p, `projection dropped refs: ${p.droppedRefs.slice(0, 4).join(",")}`));
      for (const c of p.compressions ?? []) out.push(ev1(p, `projection compressed ${c.tool} result ${c.rawChars}->${c.shownChars} chars`));
    } else if (e.kind === "curator-decision") {
      const c: CuratorDecisionEvent = e;
      if (c.action === "dropped" || c.action === "compressed") out.push(ev1(c, `curator ${c.action} ${c.targetRef}: ${clip(c.rationale.why, 60)}`));
    }
  }
  return out;
};

const ruleEvidenceTruncated: Rule = ({ f, first }) => {
  if (!first) return undefined;
  const chk = checkEvidence(f, first);
  const drops = chk.absent.length > 0 || chk.elided.length > 0 ? droppedRefsBefore(f, first) : [];
  if (chk.elided.length === 0 && (chk.absent.length === 0 || drops.length === 0)) return undefined;
  return {
    reason: "harness:evidence-truncated",
    divergence: first,
    evidence: [
      ...chk.elided.slice(0, 2).map((r) => ev1(r, `the divergence turn's request carried only a compressed preview of this ${r.toolName} result (${ELIDED_LINES.exec(resultText(r))?.[0].trim() ?? "compressed by the projection"})`)),
      ...drops.slice(-3),
      ...(chk.absent.length > 0 && drops.length > 0 ? chk.absent.slice(0, 2).map((r) => ev1(r, `${r.toolName} result absent from the divergence turn's request`)) : []),
      ev1(first.exchange, `divergence turn (${first.target.ref})`),
    ],
    // The trace proves the evidence was cut; it cannot prove the failed check needed the cut part.
    needs: ["which failed check depended on the elided or dropped content"],
  };
};

const ruleEvidenceMissing: Rule = ({ f, first }) => {
  if (!first) return undefined;
  const chk = checkEvidence(f, first);
  if (chk.absent.length === 0) return undefined;
  const allAbsent = chk.present.length === 0 && chk.unverifiable.length === 0;
  return {
    reason: "harness:evidence-missing",
    divergence: first,
    evidence: [
      ...chk.absent.slice(0, 3).map((r) => ev1(r, `${r.toolName} result (${clip(oneLine(resultText(r)), 50)}) absent from the divergence turn's request`)),
      ev1(first.exchange, `divergence turn (${first.target.ref}); ${chk.present.length}/${chk.results.length} evidence result(s) present`),
    ],
    needs: [
      ...(chk.req.clipped ? [`full request text (the recorder caps each message at ${RECORDER_MESSAGE_CAP} chars)`] : []),
      ...(allAbsent ? [] : ["which result the failing output needed (some evidence was present)"]),
    ],
  };
};

/** Typed guidance signals with their render iteration. */
interface Guidance {
  readonly sig: HarnessSignalInjectedEvent;
  readonly renderedIter?: number;
  readonly target?: string;
  readonly effect?: SignalEffectEvent;
}
function guidanceSignals(f: Facts): readonly Guidance[] {
  const rendered = f.ev.filter((e): e is SignalRenderedEvent => e.kind === "signal-rendered");
  const effects = f.ev.filter((e): e is SignalEffectEvent => e.kind === "signal-effect");
  return f.ev
    .filter((e): e is HarnessSignalInjectedEvent => e.kind === "harness-signal-injected" && (e.signalId ?? "") !== "")
    .map((sig) => {
      const r = rendered.find((x) => x.signalId === sig.signalId);
      const target = sig.targetTool ?? strArr(sig.metadata, "requiredTools")[0] ?? (sig.targetPolicy === "denied-tool-retry" ? str(sig.metadata, "toolName") : undefined);
      const effect = effects.find((x) => x.signalId === sig.signalId);
      return { sig, ...(r ? { renderedIter: r.renderedInIter } : {}), ...(target ? { target } : {}), ...(effect ? { effect } : {}) };
    });
}

/** The first exchange at/after the render iteration, and whether it called `tool` (natively or via a run). */
function followed(f: Facts, g: Guidance): { readonly x: LLMExchangeEvent; readonly called: boolean; readonly printed: boolean } | undefined {
  if (g.renderedIter === undefined || g.target === undefined) return undefined;
  const xs = f.exchanges.filter((x) => x.seq > g.sig.seq && x.iter >= g.renderedIter!);
  const x = xs[0];
  if (!x) return undefined;
  const next = f.exchanges.find((y) => y.seq > x.seq)?.seq ?? Number.POSITIVE_INFINITY;
  const called = (x.response.toolCalls ?? []).some((c) => c.name === g.target) ||
    [...f.toolStarts, ...f.toolEnds].some((t) => t.toolName === g.target && t.seq > x.seq && t.seq < next);
  const printed = !called && new RegExp(`${g.target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[({]`).test(x.response.content);
  return { x, called, printed };
}

const satisfiedBefore = (f: Facts, tool: string, seq: number): boolean => {
  if (f.toolEnds.some((t) => t.toolName === tool && t.ok !== false && t.seq < seq)) return true;
  return f.ev.some((e): e is LedgerEntryTraceEvent => e.kind === "ledger-entry" && e.seq < seq &&
    e.entries.some((r) => r["kind"] === "requirement" && r["requirementId"] === `tool:${tool}` && r["status"] === "satisfied"));
};

/** The last call of `tool` before `seq` failed (a retry of it is the corrective step, not a detour). */
const lastCallFailed = (f: Facts, tool: string, seq: number): boolean =>
  f.toolEnds.filter((t) => t.toolName === tool && t.seq < seq).at(-1)?.ok === false;

const ruleMisleadingGuidance: Rule = ({ f, targets, divergences }) => {
  const unwritten = targets.filter((t, i) => t.kind === "file" && divergences[i] === undefined);
  if (unwritten.length === 0) return undefined;
  for (const g of guidanceSignals(f)) {
    if (g.target === undefined || !satisfiedBefore(f, g.target, g.sig.seq)) continue;
    // The ledger counts a coverage requirement met on invocation, even a failed one;
    // a retry steer naming the tool whose own last call failed is correct guidance.
    if (g.sig.targetPolicy === "denied-tool-retry" && lastCallFailed(f, g.target, g.sig.seq)) continue;
    const fo = followed(f, g);
    if (!fo?.called) continue;
    return {
      reason: "harness:misleading-guidance",
      target: unwritten[0]!,
      divergence: { target: unwritten[0]!, exchange: fo.x },
      evidence: [
        ev1(g.sig, `guidance steered to ${g.target}, already satisfied before it: ${clip(oneLine(g.sig.contentPreview), 80)}`),
        ev1(fo.x, `the model followed it (called ${g.target})`),
        ...(f.completed ? [ev1(f.completed, `${unwritten.map((t) => t.ref).join(",")} never written`)] : []),
      ],
      needs: [],
    };
  }
  return undefined;
};

const ruleIgnoredGuidance: Rule = ({ f, first }) => {
  const cutoff = first?.exchange.seq ?? Number.POSITIVE_INFINITY;
  for (const g of guidanceSignals(f)) {
    if (g.target === undefined || g.sig.seq >= cutoff) continue;
    // Correct guidance: it names a contract-required tool that was not yet satisfied.
    if (!f.requiredTools.includes(g.target) || satisfiedBefore(f, g.target, g.sig.seq)) continue;
    // Linked to the failure: the tool stayed unsatisfied up to the decision point.
    if (f.toolEnds.some((t) => t.toolName === g.target && t.ok !== false && t.seq < cutoff)) continue;
    const fo = followed(f, g);
    if (!fo || fo.called) continue;
    if (g.effect !== undefined && g.effect.response !== "ignored" && g.effect.response !== "contradicted") continue;
    return {
      reason: "model:ignored-guidance",
      ...(first ? { divergence: first } : {}),
      evidence: [
        ev1(g.sig, `guidance to call required ${g.target} (unsatisfied): ${clip(oneLine(g.sig.contentPreview), 80)}`),
        ev1(fo.x, `next turn made no ${g.target} call${fo.printed ? " (it printed one as text instead)" : ""}`),
        ...(g.effect ? [ev1(g.effect, `signal-effect=${g.effect.response}`)] : []),
        ...(f.completed ? [ev1(f.completed, `${g.target} never succeeded before the ${first ? "divergence turn" : "end"}; terminatedBy=${f.terminatedBy ?? "?"}`)] : []),
      ],
      needs: [
        ...(g.effect === undefined ? ["signal-effect for the guidance signal"] : []),
        ...(fo.printed ? ["whether the text-parse fallback should have run the printed call"] : []),
      ],
    };
  }
  return undefined;
};

const ruleHadEvidence: Rule = ({ f, first }) => {
  if (!first || f.grade === undefined || f.grade.passed) return undefined;
  const chk = checkEvidence(f, first);
  if (chk.results.length === 0 || chk.absent.length > 0 || chk.elided.length > 0) return undefined;
  const failed = f.grade.checks.filter((c) => !c.passed).map((c) => c.name);
  return {
    reason: "model:had-evidence-wrong-output",
    divergence: first,
    evidence: [
      ...chk.present.slice(0, 2).map((r) => ev1(r, `${r.toolName} result (${clip(oneLine(resultText(r)), 50)}) present in the divergence turn's request`)),
      ev1(first.write ?? first.exchange, first.write ? `turn seq ${first.exchange.seq} wrote ${baseName(argPath(first.write.args) ?? first.target.ref)}` : `turn seq ${first.exchange.seq} produced the final answer`),
      ev1(f.grade, `eval-graded ${f.grade.grader}: failed ${clip(failed.slice(0, 3).join("; "), 120)}`),
    ],
    needs: chk.unverifiable.length > 0 ? [`full request text (${chk.unverifiable.length} result(s) clipped by the ${RECORDER_MESSAGE_CAP}-char recorder cap or partly compressed by the projection)`] : [],
  };
};

/**
 * The run ended on its own (no harness stop, no abstention, no recorded
 * outstanding item) while grader-required files were never written and the run
 * contract did not list them: nothing in the harness knew they were required,
 * so nothing could hold the run to them. Fix side: the contract compiler / the
 * completeness signal, not the model's prompt.
 */
const ruleCompletenessBlind: Rule = ({ f, targets, divergences }) => {
  if (f.grade === undefined || f.grade.passed || f.abstained || f.completed === undefined) return undefined;
  if (HARNESS_STOP.test(f.terminatedBy ?? "") || f.outstanding.length > 0) return undefined;
  const blind = targets.filter((t, i) =>
    t.kind === "file" && t.source === "grader-check" && divergences[i] === undefined &&
    !f.knownFiles.some((ref) => ref === t.ref || refMatcher(ref)(t.ref)));
  if (blind.length === 0) return undefined;
  return {
    reason: "harness:completeness-blind",
    target: blind[0]!,
    evidence: [
      ev1(f.grade, `eval-graded ${f.grade.grader}: required ${blind.map((t) => t.ref).join(", ")} never written`),
      ...(f.contract ? [ev1(f.contract, `known deliverables (contract + ledger-declared): ${f.knownFiles.length > 0 ? f.knownFiles.join(", ") : "none"}; none cover the missing files`)] : []),
      ev1(f.completed, `run ended status=${f.completed.status} terminatedBy=${f.terminatedBy ?? "?"} with nothing outstanding`),
    ],
    needs: f.contract === undefined ? ["contract-compiled (the run's declared deliverables)"] : [],
  };
};

const RULES: readonly Rule[] = [
  ruleFabricationVetoed, ruleFalseVeto, ruleToolSurface, ruleToolNotOffered, ruleContradictoryGuidance, ruleSubpassAbstained,
  ruleToolCallDropped, ruleRefusalCountedAsRepeat, ruleToolCallCorrupted, rulePlanFanoutBlob, rulePrematureStop,
  ruleCompletenessBlind, ruleOfferAcceptedAsDone, ruleEvidenceWithheld, ruleEvidenceTruncated, ruleEvidenceMissing,
  ruleMisleadingGuidance, ruleIgnoredGuidance, ruleEvidenceNotGathered, ruleHadEvidence, ruleRefusalCountedAsRepeatProbable,
];

/**
 * Fallback when no turn-level rule fires: the run's failure cause, mapped to
 * its owner through the shared taxonomy. Undefined when the cause has no
 * owner the trace can prove (`unattributed`).
 */
function causeFallback(trace: Trace): { readonly reason: AttributionReason; readonly confidence: CauseConfidence; readonly evidence: readonly CauseEvidence[]; readonly cause: string } | undefined {
  const c = analyzeCause(trace);
  const reason = CAUSE_ATTRIBUTION[c.cause];
  if (reason === "unattributed") return undefined;
  return {
    reason,
    // An ownership mapping, not a turn-level proof: never stronger than probable.
    confidence: c.confidence === "insufficient-trace" ? "insufficient-trace" : "probable",
    evidence: c.evidence,
    cause: `${c.cause}${c.subCause ? `/${c.subCause}` : ""}`,
  };
}

/**
 * Attribute a failed run to the harness or the model, from trace events only.
 *
 * Pure and deterministic, zero tokens. A run counts as failed when
 * `run-completed.status` is not `success`, `run-completed.outcome.success` is
 * false, or the last `eval-graded` event failed. A grader pass on an abstained
 * run is a correct abstention (`not-failed`).
 *
 * Works on any trace recorded by the trace recorder (`.withObservability({ tracing })`),
 * with or without an `eval-graded` event. Without a grader, only rules that do
 * not need to know the answer was wrong can fire; the rest report
 * `unattributed` and name `eval-graded` in `missing`.
 *
 * @param trace A loaded trace (one run), e.g. from {@link loadTrace}.
 * @returns The verdict, the reason, the divergence turn, supporting evidence,
 *   the signals whose absence limited the verdict, and other matching reasons.
 */
export function attributeFailure(trace: Trace): Attribution {
  const f = gatherFacts(trace);
  const base = { runId: trace.runId, failureSignals: f.failureSignals };
  const failed = f.failureSignals.length > 0 || (f.grade !== undefined && !f.grade.passed);
  if (f.completed === undefined && f.grade === undefined) {
    const owned = causeFallback(trace);
    if (owned) {
      return {
        ...base, verdict: verdictOf(owned.reason), reason: owned.reason, confidence: owned.confidence,
        evidence: owned.evidence, missing: ["run-completed", "eval-graded"], alsoMatched: [], cause: owned.cause,
      };
    }
    return {
      ...base, verdict: "unattributed", reason: "unattributed", confidence: "insufficient-trace",
      evidence: f.aborted ? [ev1(f.aborted, `run-aborted causeClass=${f.aborted.causeClass}${f.aborted.reason ? ` reason=${f.aborted.reason}` : ""}`)] : [],
      missing: ["run-completed", "eval-graded"], alsoMatched: [],
    };
  }
  if (!failed || (f.abstained && f.grade?.passed === true)) {
    return {
      ...base, verdict: "not-failed", reason: "not-failed", confidence: "decisive",
      evidence: [
        ...(f.completed ? [ev1(f.completed, `status=${f.completed.status} terminatedBy=${f.terminatedBy ?? "?"}${f.abstained ? " (abstained)" : ""}`)] : []),
        ...(f.grade ? [ev1(f.grade, `eval-graded passed=${String(f.grade.passed)}${f.abstained ? ": the grader accepts this abstention" : ""}`)] : []),
      ],
      missing: [], alsoMatched: [],
    };
  }

  const targets = pickTargets(f);
  const divergences = targets.map((t) => divergenceFor(f, t));
  const produced = divergences.filter((d): d is Divergence => d !== undefined);
  const first = produced.length > 0 ? produced.reduce((a, b) => (b.exchange.seq < a.exchange.seq ? b : a)) : undefined;
  const ctx: Ctx = { f, targets, divergences, ...(first ? { first } : {}) };

  const hits = RULES.map((r) => r(ctx)).filter((h): h is Hit => h !== undefined);
  const top = hits[0];
  const alsoMatched = [...new Set(hits.slice(1).map((h) => h.reason).filter((r) => r !== top?.reason))];
  if (top) {
    // A false veto judged a passing output: there is no wrong turn to point at.
    const d = top.reason === "harness:false-veto" ? undefined : (top.divergence ?? first);
    const target = top.target ?? d?.target ?? targets[0];
    return {
      ...base,
      verdict: verdictOf(top.reason),
      reason: top.reason,
      confidence: top.needs.length === 0 ? "decisive" : "probable",
      ...(d ? { divergenceTurn: { iter: d.exchange.iter, seq: d.exchange.seq } } : {}),
      ...(target ? { target } : {}),
      evidence: top.evidence,
      missing: top.needs,
      alsoMatched,
    };
  }

  // No turn-level rule: fall back to the failure cause's owner.
  const owned = causeFallback(trace);
  if (owned) {
    return {
      ...base,
      verdict: verdictOf(owned.reason),
      reason: owned.reason,
      confidence: owned.confidence,
      ...(first ? { divergenceTurn: { iter: first.exchange.iter, seq: first.exchange.seq } } : {}),
      ...((first?.target ?? targets[0]) ? { target: first?.target ?? targets[0]! } : {}),
      evidence: owned.evidence,
      missing: f.grade === undefined ? ["eval-graded (a grader verdict on the output)"] : [],
      alsoMatched: [],
      cause: owned.cause,
    };
  }

  // Residual: say which signal is missing.
  const missing: string[] = [];
  const evidence: CauseEvidence[] = [];
  if (f.grade === undefined) missing.push("eval-graded (a grader verdict on the output)");
  if (f.exchanges.length === 0) missing.push("llm-exchange events (what the model saw)");
  if (first) {
    const chk = checkEvidence(f, first);
    evidence.push(ev1(first.exchange, `divergence turn (${first.target.ref}); ${chk.results.length} evidence result(s) before it`));
    if (chk.results.length === 0) missing.push("a successful tool result before the divergence turn (the output was produced with no tool evidence)");
    else if (chk.unverifiable.length > 0) missing.push(`full request text (the recorder caps each message at ${RECORDER_MESSAGE_CAP} chars)`);
  } else {
    missing.push(`the turn that produced ${targets.map((t) => t.ref).join(",")} (never produced, and no harness stop/drop/corruption explains it)`);
    // The harness may still have told the model in plain text; that is not a typed signal, so it is reported, not judged.
    const told = f.exchanges.filter((x) => x.messages.some((m) => /^(Guidance|Outstanding requirements):/m.test(m.content) && targets.some((t) => t.kind === "file" && m.content.includes(t.ref)))).at(-1);
    if (told) {
      evidence.push(ev1(told, `the request carried untyped Guidance/Outstanding text naming ${targets.map((t) => t.ref).join(",")}`));
      missing.push("a typed guidance signal (harness-signal-injected + signal-rendered) for the unwritten deliverable");
    }
  }
  if (f.completed) evidence.push(ev1(f.completed, `status=${f.completed.status} terminatedBy=${f.terminatedBy ?? "?"}`));
  if (f.grade) evidence.push(ev1(f.grade, `eval-graded passed=${String(f.grade.passed)}: ${clip(f.grade.checks.filter((c) => !c.passed).map((c) => c.name).join("; "), 100)}`));
  return {
    ...base,
    verdict: "unattributed",
    reason: "unattributed",
    confidence: f.grade === undefined && f.exchanges.length === 0 ? "insufficient-trace" : "probable",
    ...(first ? { divergenceTurn: { iter: first.exchange.iter, seq: first.exchange.seq } } : {}),
    target: first?.target ?? targets[0]!,
    evidence,
    missing,
    alsoMatched: [],
  };
}

/** Human rendering of an {@link Attribution}. */
export function renderAttribution(a: Attribution): string {
  const L: string[] = [];
  L.push(`${a.runId}: ${a.verdict} (${a.reason}) confidence=${a.confidence}${a.cause ? ` from-cause=${a.cause}` : ""}${a.target ? ` target=${a.target.ref}` : ""}${a.divergenceTurn ? ` divergence=iter ${a.divergenceTurn.iter} seq ${a.divergenceTurn.seq}` : ""}`);
  if (a.failureSignals.length > 0) L.push(`  failed    ${a.failureSignals.join("; ")}`);
  for (const e of a.evidence) L.push(`  evidence  ${e.eventKind}#${e.seq}  ${e.detail}`);
  if (a.alsoMatched.length > 0) L.push(`  also      ${a.alsoMatched.join(", ")}`);
  if (a.missing.length > 0) L.push(`  missing   ${a.missing.join("; ")}`);
  return L.join("\n");
}

/** Cohort tally of {@link Attribution} results. */
export interface AttributionTally {
  readonly total: number;
  readonly byVerdict: Readonly<Record<AttributionVerdict, number>>;
  readonly byReason: Readonly<Record<string, number>>;
  readonly byConfidence: Readonly<Record<CauseConfidence, number>>;
}

/**
 * Tally attributions across a cohort (e.g. a directory of bench traces).
 *
 * @param attributions One attribution per run.
 * @returns Counts by verdict, by reason and by confidence.
 */
export function tallyAttributions(attributions: readonly Attribution[]): AttributionTally {
  const byVerdict: Record<AttributionVerdict, number> = { harness: 0, model: 0, environment: 0, unattributed: 0, "not-failed": 0 };
  const byReason: Record<string, number> = {};
  const byConfidence: Record<CauseConfidence, number> = { decisive: 0, probable: 0, "insufficient-trace": 0 };
  for (const a of attributions) {
    byVerdict[a.verdict] += 1;
    byReason[a.reason] = (byReason[a.reason] ?? 0) + 1;
    byConfidence[a.confidence] += 1;
  }
  return { total: attributions.length, byVerdict, byReason, byConfidence };
}
