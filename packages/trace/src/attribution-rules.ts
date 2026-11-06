// packages/trace/src/attribution-rules.ts
//
// Attribution rules that read what the harness did to the model's calls and
// what the task listed as input (2026-11-06 evidence audit, instrument faults
// I2/I5/I6 and the three live harness causes it found; 2026-11-06 tool-surface
// spike, fault D1). Rule order and the verdict assembly live in attribution.ts;
// the facts they read live in attribution-facts.ts.
//
//   harness:tool-not-offered    the model asked for a tool (natively or printed as a JSON
//                               call) that the request it answered did not offer, and
//                               the tool never ran; the run failed on top of it
//   harness:refusal-counted-as-repeat  the repetition guard replaced a FIRST call on a
//                               target with its notice (its count included calls that
//                               never ran), so a failing file was never written or a
//                               listed input never read
//   harness:evidence-withheld   the tool gate refused the model's read of a listed input,
//                               and the input was never read before the divergence turn
//   harness:plan-fanout-blob    a failing file holds harness-resolved content that was
//                               also written verbatim to another file
//   harness:offer-accepted-as-done  the run ended on the model's turn and the shipped
//                               output offers to continue instead of claiming done
//   model:evidence-not-gathered the divergence turn produced the failing output while a
//                               listed input was never read, and nothing stopped the read

import type { CauseEvidence } from "./cause.js";
import type { AttributionTarget } from "./attribution.js";
import type { GuardFiredEvent, LLMExchangeEvent, ToolCallEvent, TraceEvent } from "./events.js";
import {
  isMeta, isWriter, HARNESS_STOP, str, ev1, clip, oneLine, baseName, refMatcher, argPath, resultText,
  executedOk, contentArg, nativeCalls, REPETITION_NOTICE, listedInputs, gatheredBefore, argsMention,
  namesStem, evidenceCutoff,
  type Facts, type Rule,
} from "./attribution-facts.js";

// ─── harness:tool-not-offered ───────────────────────────────────────────────

/**
 * A tool call printed as JSON text (`{"tool": "file-write", ...}`, `{"name":
 * "file-write", "arguments": ...}`). Only kebab/snake-case names count, so a
 * JSON value such as `"name": "Alice"` in an answer is not a call.
 */
const PRINTED_CALL = /"(?:tool|name|tool_name|function)"\s*:\s*"([a-z][a-z0-9]*(?:[-_][a-z0-9]+)+)"/g;

/** Tool names a `think` turn asked for: its native calls plus calls printed as JSON in its text. */
const askedTools = (x: LLMExchangeEvent): readonly string[] => x.purpose !== "think" ? [] : [
  ...new Set([
    ...(x.response.toolCalls ?? []).map((c) => c.name),
    ...[...x.response.content.matchAll(PRINTED_CALL)].map((m) => m[1]!),
  ]),
].filter((n) => !isMeta(n));

/**
 * The model asked for a tool the request it answered did not offer (not in the
 * exchange's `toolSchemaNames`), the tool never ran in the run, and the run
 * failed (2026-11-06 tool-surface spike, D1: `model:tool-protocol` blamed the
 * model for printing a `file-write` call when no tool was on the wire).
 *
 * Fires only when that turn was offered no domain tool at all, or the trace
 * shows the tool exists for this run (offered on another turn, on a resolved
 * surface, or required by the contract): a name the model invented while a
 * usable surface was offered stays the model's. Decisive only when the trace
 * shows the tool exists; registered builtins that the opt-in drops leave no
 * trace entry, so an empty wire alone is `probable`.
 */
export const ruleToolNotOffered: Rule = ({ f }) => {
  const ran = new Set(f.toolEnds.filter((t) => t.ok !== false).map((t) => t.toolName));
  const knownTools = new Set<string>([
    ...f.exchanges.flatMap((x) => x.toolSchemaNames),
    ...f.requiredTools,
    ...f.ev.flatMap((e) => (e.kind === "tool-surface-resolved" ? [...e.visible, ...e.callable, ...e.reasons.map((r) => r.tool)] : [])),
  ]);
  for (const x of f.exchanges) {
    const offered = x.toolSchemaNames;
    const domainOffered = offered.filter((n) => !isMeta(n)).length;
    const missing = askedTools(x).filter((n) => !offered.includes(n) && !ran.has(n));
    const name = missing.find((n) => knownTools.has(n)) ?? (domainOffered === 0 ? missing[0] : undefined);
    if (name === undefined) continue;
    const known = knownTools.has(name);
    return {
      reason: "harness:tool-not-offered",
      evidence: [
        ev1(x, `the model asked for ${name}${(x.response.toolCalls ?? []).some((c) => c.name === name) ? " natively" : " (printed as a JSON call)"}; the request offered ${offered.length > 0 ? `[${offered.join(", ")}]` : "no tools"}`),
        ...(f.completed ? [ev1(f.completed, `${name} never ran; run ended status=${f.completed.status} terminatedBy=${f.terminatedBy ?? "?"}`)] : []),
      ],
      needs: known ? [] : ["a tool-surface-resolved entry for registered tools the builtins opt-in dropped (the trace cannot show the tool exists)"],
    };
  }
  return undefined;
};

// ─── Inputs the task listed ─────────────────────────────────────────────────

/** Task-listed inputs that no call which actually ran had named before `cutoff`. */
const ungathered = (f: Facts, cutoff: number): readonly string[] =>
  listedInputs(f.task).filter((i) => !gatheredBefore(f, i, cutoff));

/** The number in a file name (`notes-5.txt` → `5`, `out-5.txt` → `5`). */
const fileIndex = (ref: string): string | undefined => /(\d+)\.[A-Za-z0-9]+$/.exec(ref)?.[1];

/**
 * The failing target or check an input is tied to: a failed check that names
 * its stem (`slugify: ...` ↔ slugify.ts), or a failing file target with the same
 * number (`out-5.txt` ↔ `notes-5.txt`). Undefined when nothing ties them.
 */
function linkOf(f: Facts, input: string, targets: readonly AttributionTarget[]): string | undefined {
  const check = (f.grade?.checks ?? []).find((c) => !c.passed && namesStem(c.name, input));
  if (check) return `failed check "${clip(check.name, 60)}"`;
  const idx = fileIndex(input);
  const t = idx === undefined ? undefined : targets.find((t) => t.kind === "file" && t.ref !== input && fileIndex(t.ref) === idx);
  return t ? `failing ${t.ref}` : undefined;
}

/** Same call target: the same file (by base name) when both carry a path, else equal args. */
const sameTarget = (a: unknown, b: unknown): boolean => {
  const pa = argPath(a), pb = argPath(b);
  return pa !== undefined && pb !== undefined ? baseName(pa) === baseName(pb) : JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
};

// ─── harness:refusal-counted-as-repeat ──────────────────────────────────────

/** Repetition notices that replaced a call on a target no earlier call of that tool had run on. */
const blockedFirstCalls = (f: Facts): readonly ToolCallEvent[] =>
  f.toolEnds.filter((t) => REPETITION_NOTICE.test(resultText(t)) && !isMeta(t.toolName) &&
    !f.toolEnds.some((e) => e.seq < t.seq && e.toolName === t.toolName && executedOk(e) && sameTarget(e.args, t.args)));

const describeBlocked = (f: Facts, b: ToolCallEvent): CauseEvidence => {
  const ran = f.toolEnds.filter((e) => e.seq < b.seq && e.toolName === b.toolName && e.ok !== false && !REPETITION_NOTICE.test(resultText(e))).length;
  const refused = f.ev.filter((e) => e.kind === "guard-fired" && e.guard === "tool-gate" && e.seq < b.seq && str(e.metadata, "toolName") === b.toolName).length;
  const claimed = /already called \S+ (\d+) times/.exec(resultText(b))?.[1];
  const p = argPath(b.args);
  return ev1(b, `repetition guard replaced the first ${b.toolName}${p !== undefined ? `(${baseName(p)})` : ""} call${claimed !== undefined ? ` ("already called ${claimed} times")` : ""}; ${ran} earlier ${b.toolName} call(s) had run${refused > 0 ? `, ${refused} were tool-gate refusals` : ""}`);
};

/** True when a failed check names the replaced write's content (`out-2.txt is 84` and the write carried `84`). */
const checkExpects = (f: Facts, content: string | undefined): boolean => {
  const v = content?.trim();
  if (v === undefined || v.length === 0 || v.length > 40) return false;
  const re = new RegExp(`(^|[^\\w.])${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w.])`);
  return (f.grade?.checks ?? []).some((c) => !c.passed && re.test(c.name));
};

/**
 * The repetition guard replaced a first call (live harness cause, 2026-11-06
 * evidence audit: `act/guard.ts` counts refused action steps as calls).
 *
 * `decisive` mode (early in rule order) fires when the replaced call withheld a
 * listed input, or replaced the write of a failing file whose content the failed
 * check named (the write would have passed). `probable` mode (last) fires on any
 * other replaced write of a failing file: the guard blocked it, but the trace
 * cannot show its content would have passed, so model rules go first.
 */
const refusalCountedAsRepeat = (mode: "decisive" | "probable"): Rule => ({ f, targets, divergences, first }) => {
  const blocked = blockedFirstCalls(f);
  if (blocked.length === 0) return undefined;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!;
    if (t.kind !== "file" || divergences[i] !== undefined) continue;
    const match = refMatcher(t.ref);
    const b = blocked.find((x) => isWriter(x.toolName) && argPath(x.args) !== undefined && match(argPath(x.args)!));
    if (!b) continue;
    const expected = checkExpects(f, contentArg(b.args));
    if (mode === "decisive" && !expected) continue;
    return {
      reason: "harness:refusal-counted-as-repeat", target: t,
      evidence: [
        describeBlocked(f, b),
        ...(f.completed ? [ev1(f.completed, `${t.ref} was never written${expected ? `; the replaced write carried the value the failed check expected (${clip(oneLine(contentArg(b.args) ?? ""), 20)})` : ""}`)] : []),
      ],
      needs: expected ? [] : ["whether the replaced write's content would have passed the failed check"],
    };
  }
  if (mode === "probable" || f.grade === undefined || f.grade.passed) return undefined;
  const cutoff = evidenceCutoff(first);
  const missed = ungathered(f, cutoff);
  for (const b of blocked) {
    if (isWriter(b.toolName) || b.seq >= cutoff) continue;
    const input = missed.find((i) => argsMention(b.args, i));
    if (input === undefined) continue;
    const link = linkOf(f, input, targets);
    return {
      reason: "harness:refusal-counted-as-repeat",
      ...(first ? { divergence: first } : {}),
      evidence: [describeBlocked(f, b), ev1(first?.exchange ?? f.grade, `${input} was never read${first ? " before the divergence turn" : ""}${link ? `; it feeds the ${link}` : ""}`)],
      needs: link ? [] : [`which failed check depended on ${input}`],
    };
  }
  return undefined;
};
export const ruleRefusalCountedAsRepeat: Rule = refusalCountedAsRepeat("decisive");
export const ruleRefusalCountedAsRepeatProbable: Rule = refusalCountedAsRepeat("probable");

// ─── harness:evidence-withheld ──────────────────────────────────────────────

/**
 * A task-listed input the model asked to read, whose read the tool gate refused
 * (or a guard replaced), and that never ran before the divergence turn
 * (instrument fault I6: refusals of evidence reads were not counted).
 */
export const ruleEvidenceWithheld: Rule = ({ f, targets, first }) => {
  if (f.grade === undefined || f.grade.passed) return undefined;
  const cutoff = evidenceCutoff(first);
  const missed = ungathered(f, cutoff);
  if (missed.length === 0) return undefined;
  const withheld = nativeCalls(f).filter((c) => c.x.seq < cutoff && !isWriter(c.name) && (c.fate === "refused" || c.fate === "notice"));
  for (const input of missed) {
    const asks = withheld.filter((c) => argsMention(c.args, input));
    if (asks.length === 0) continue;
    const last = asks.at(-1)!;
    const next = f.exchanges.find((y) => y.seq > last.x.seq)?.seq ?? Number.POSITIVE_INFINITY;
    const gate: TraceEvent | undefined = last.fate === "notice" ? last.end : f.ev.find((e): e is GuardFiredEvent =>
      e.kind === "guard-fired" && e.guard === "tool-gate" && e.seq > last.x.seq && e.seq < next && str(e.metadata, "toolName") === last.name);
    const link = linkOf(f, input, targets);
    return {
      reason: "harness:evidence-withheld",
      ...(first ? { divergence: first } : {}),
      evidence: [
        ev1(last.x, `the model asked for ${last.name}(${input}) ${asks.length} time(s); none ran${link ? `; it feeds the ${link}` : ""}`),
        ...(gate ? [ev1(gate, gate.kind === "guard-fired" ? `tool gate refused it: ${str(gate.metadata, "kind") ?? clip(oneLine(gate.reason), 60)}` : "a guard notice replaced it")] : []),
      ],
      needs: link ? [] : [`which failed check depended on ${input}`],
    };
  }
  return undefined;
};

// ─── harness:plan-fanout-blob ───────────────────────────────────────────────

/** Shortest written content that counts as a blob (short values such as `34` legitimately repeat). */
const BLOB_MIN_CHARS = 40;

/**
 * A failing file holds content the harness resolved (no native model call wrote
 * it to that file), and the same content went verbatim to another file: one step
 * result fanned out into several files (plan-execute `{{from_step:...}}`, live
 * harness cause, 2026-11-06 evidence audit).
 */
export const rulePlanFanoutBlob: Rule = ({ f, targets, divergences }) => {
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!, d = divergences[i];
    const w = d?.write;
    if (t.kind !== "file" || d === undefined || w === undefined) continue;
    const blob = contentArg(w.args)?.trim();
    const path = argPath(w.args);
    if (blob === undefined || blob.length < BLOB_MIN_CHARS || path === undefined) continue;
    const twin = f.toolEnds.find((e) => e !== w && isWriter(e.toolName) && executedOk(e) &&
      contentArg(e.args)?.trim() === blob && argPath(e.args) !== undefined && baseName(argPath(e.args)!) !== baseName(path));
    if (!twin) continue;
    const native = f.exchanges.some((x) => (x.response.toolCalls ?? []).some((c) =>
      isWriter(c.name) && baseName(argPath(c.arguments) ?? "") === baseName(path) && contentArg(c.arguments)?.trim() === blob));
    if (native) continue;
    const plan = f.exchanges.filter((x) => x.seq < w.seq && /\{\{\s*from_step\s*:/.test(x.response.content)).at(-1);
    return {
      reason: "harness:plan-fanout-blob", target: t, divergence: d,
      evidence: [
        ev1(w, `${baseName(path)} received ${blob.length} chars that no native model call wrote to it`),
        ev1(twin, `the same ${blob.length} chars were also written to ${baseName(argPath(twin.args)!)}`),
        ...(plan ? [ev1(plan, "the plan routed one step result into several files ({{from_step:...}})")] : []),
      ],
      needs: [],
    };
  }
  return undefined;
};

// ─── harness:offer-accepted-as-done ─────────────────────────────────────────

const OFFER_VERBS = "proceed|continue|go ahead|fix|implement|finish|complete|do|start|move on|apply|write|create|handle|work on|address|make|update|run|tackle";
/**
 * An offer to do more of the work, as a question (`Would you like me to proceed
 * with fixing the remaining modules?`) or a let-me-know form. Help offers (`let
 * me know if you have questions`) and offers to explain do not match.
 */
const OFFER_TO_CONTINUE = new RegExp(
  `\\b(?:(?:would you like me to|do you want me to|shall i|should i|want me to)\\s+(?:now\\s+|also\\s+|go ahead and\\s+)?(?:${OFFER_VERBS})\\b[^?.!]{0,240}\\?` +
  `|let me know if you(?:'d| would)? (?:like|want) me to\\s+(?:${OFFER_VERBS})\\b[^.!?]{0,240}[.!?]?)`,
  "i",
);

/**
 * The run ended on the model's own turn (no harness stop, no abstention) and an
 * offer to continue sits in the last 400 chars of the shipped output: the exit
 * gate shipped a run the model did not claim as finished (live harness cause,
 * 2026-11-06 evidence audit: `detectContinuationIntent` is terminal-clause only).
 */
export const ruleOfferAcceptedAsDone: Rule = ({ f }) => {
  if (f.completed === undefined || f.abstained || HARNESS_STOP.test(f.terminatedBy ?? "")) return undefined;
  const m = OFFER_TO_CONTINUE.exec((f.completed.output ?? "").trim().slice(-400));
  if (!m) return undefined;
  const accept = f.ev.filter((e): e is GuardFiredEvent => e.kind === "guard-fired" && e.guard === "exit_gate" && str(e.metadata, "gateDecision") === "accept").at(-1);
  const anchor: TraceEvent | undefined = accept ?? f.terminalDecision;
  return {
    reason: "harness:offer-accepted-as-done",
    evidence: [
      ev1(f.completed, `the shipped output offers to continue instead of claiming done: "${clip(oneLine(m[0]), 120)}"`),
      ...(anchor ? [ev1(anchor, accept ? `exit gate accepted the end (outstanding=${JSON.stringify(accept.metadata?.["outstanding"] ?? [])})` : `terminal decision ${f.terminatedBy ?? "?"}`)] : []),
    ],
    needs: accept ? [] : ["exit_gate accept decision (which gate shipped the run)"],
  };
};

// ─── model:evidence-not-gathered ────────────────────────────────────────────

/**
 * The divergence turn produced the failing output while inputs the task listed
 * had not been read, and nothing stopped the model from reading them
 * (instrument fault I2: `had-evidence` only asked whether the results the run
 * DID gather were present). Needs a produced output: a run that produced
 * nothing is left to the failure cause.
 */
export const ruleEvidenceNotGathered: Rule = ({ f, targets, first }) => {
  if (first === undefined || f.grade === undefined || f.grade.passed) return undefined;
  const missed = ungathered(f, evidenceCutoff(first));
  if (missed.length === 0) return undefined;
  const linked = missed.filter((i) => linkOf(f, i, targets) !== undefined);
  const failed = f.grade.checks.filter((c) => !c.passed).map((c) => c.name);
  return {
    reason: "model:evidence-not-gathered",
    divergence: first,
    evidence: [
      ev1(first.exchange, `${missed.length}/${listedInputs(f.task).length} task-listed input(s) not read before the divergence turn (${first.target.ref}): ${(linked.length > 0 ? linked : missed).slice(0, 4).join(", ")}${linked.length > 0 ? " (tied to a failed check or target)" : ""}`),
      ev1(f.grade, `eval-graded ${f.grade.grader}: failed ${clip(failed.slice(0, 3).join("; "), 120)}`),
    ],
    needs: linked.length > 0 ? [] : ["which failed check depended on the unread input(s)"],
  };
};
