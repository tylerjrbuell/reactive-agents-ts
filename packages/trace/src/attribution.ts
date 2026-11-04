// packages/trace/src/attribution.ts
//
// Zero-token harness-vs-model attribution (feedback-loop design D2,
// wiki/Research/Audit-Reports-2026-11-03/feedback-loop-map.md §3).
//
// `analyzeCause` says HOW a run ended. This module answers the next question a
// developer asks about a failed run: "is it my harness configuration or the
// model?". It locates the turn that produced the failing artifact or answer
// (the divergence turn), checks whether the evidence that turn needed was in
// its projected request, and checks what the harness did around it (dropped or
// mangled tool calls, stops, vetoes, guidance).
//
// HONESTY RULES (load-bearing, same as cause.ts):
//   - Reads trace events only. It reads the projected request text and the
//     response tool calls of `llm-exchange` events (what the model SAW and
//     ASKED FOR), never the model's prose to judge whether it is right.
//   - Never guesses. A rule fires only on facts the trace records; a rule
//     whose facts are partly hidden (request text clipped by the recorder)
//     reports `probable` and names the hidden signal in `missing`. When no rule
//     can prove a side, the verdict is `unattributed` with `missing` filled.
//   - "Right or wrong" comes from outside the run: an `eval-graded` event, or
//     the run's own failure status. Without a grader, rules that need to know
//     the output was WRONG (model:had-evidence-wrong-output) do not fire.
//
// Rules (first match is the verdict; every other rule that also matched is
// listed in `alsoMatched`):
//   harness:false-veto          grader passed but the run was marked failed; or
//                               a deliverable that names a template placeholder
//   harness:tool-surface        a contract-required tool was hidden from the model
//   harness:tool-call-dropped   the model emitted a native call the harness never ran
//   harness:tool-call-corrupted a text-parsed call reached the tool with mangled args
//   harness:premature-stop      a harness stop shipped a pre-evidence answer, or cut a
//                               run whose evidence was still growing
//   harness:evidence-truncated  evidence was produced, then dropped/compressed
//                               before the divergence turn
//   harness:evidence-missing    evidence was produced but is absent from the
//                               divergence turn's request (no drop recorded)
//   harness:misleading-guidance guidance steered to a tool already satisfied and the
//                               model followed it while the deliverable stayed unmade
//   model:ignored-guidance      correct guidance (call an unsatisfied required tool)
//                               was rendered and the model did not call it
//   model:had-evidence-wrong-output  the divergence turn's request held the
//                               evidence and the graded output still failed
//   unattributed                no rule could prove a side (see `missing`)

import type { Trace } from "./replay.js";
import type { CauseConfidence, CauseEvidence } from "./cause.js";
import type {
  TraceEvent,
  RunCompletedEvent,
  RunAbortedEvent,
  EvalGradedEvent,
  LLMExchangeEvent,
  ToolCallEvent,
  ContractCompiledEvent,
  ToolSurfaceResolvedEvent,
  AssessmentEvent,
  GuardFiredEvent,
  HarnessSignalInjectedEvent,
  SignalRenderedEvent,
  SignalEffectEvent,
  ProjectionRenderedEvent,
  CuratorDecisionEvent,
  LedgerEntryTraceEvent,
} from "./events.js";

/** Who the trace says is at fault for a failed run. */
export type AttributionVerdict = "harness" | "model" | "unattributed" | "not-failed";

/** Closed set of attribution reasons. The prefix names the {@link AttributionVerdict}. */
export type AttributionReason =
  | "harness:false-veto"
  | "harness:tool-surface"
  | "harness:tool-call-dropped"
  | "harness:tool-call-corrupted"
  | "harness:premature-stop"
  | "harness:evidence-truncated"
  | "harness:evidence-missing"
  | "harness:misleading-guidance"
  | "model:ignored-guidance"
  | "model:had-evidence-wrong-output"
  | "unattributed"
  | "not-failed";

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
}

// ─── Facts ────────────────────────────────────────────────────────────────────

/** Harness bookkeeping tools: never evidence, never a deliverable. Mirrors cause.ts. */
const META_TOOLS: ReadonlySet<string> = new Set([
  "brief", "pulse", "find", "recall", "discover-tools", "context-status",
  "checkpoint", "final-answer", "task-complete", "activate-skill",
  "get-skill-section", "todo",
]);
const isMeta = (name: string): boolean => META_TOOLS.has(name);

/** Tools that produce files (writers), by name. Their results are receipts, not evidence. */
const WRITER = /write|edit|patch|create|save/i;
const isWriter = (toolName: string): boolean => WRITER.test(toolName);

/** A terminatedBy the harness (not the model) chose. */
const HARNESS_STOP = /dispatcher|early[_-]stop|max[_-]iterations|budget|loop_graceful|harness_deliverable|harness_synthesis|stall|controller/;

/** File names named in grader checks (`low-stock.txt exists`, `out-2.txt is 84`). */
const FILE_IN_TEXT = /(?:^|[\s"'`(/])((?:[\w-]+\/)*[\w.-]+\.(?:txt|md|json|csv|tsv|ts|tsx|js|mjs|cjs|py|html|css|ya?ml|xml|sql|sh|toml))\b/gi;

/** Object-literal source text inside a string argument: `{\n  path: "..."` — the mark of a text-parsed call. */
const OBJECT_LITERAL_FRAGMENT = /\{\s*["']?[A-Za-z_][\w-]*["']?\s*:/;

/** Argument names that locate a resource (a path, URL or the single wrapped `input`), never free content. */
const LOCATOR_ARG = /^(path|file|filePath|filename|dir|directory|url|uri|input|target)$/i;

/** Grader check names that are commands (`bun test ./x.test.ts`), not a file the run had to write. */
const COMMAND_CHECK = /^(bun|bunx|npm|npx|node|deno|yarn|pnpm|python3?|pytest|sh|bash|make|go|cargo)\s/;

/** A recorded `llm-exchange` request holds at most this many chars per message (llm-provider exchange-projection). */
const RECORDER_MESSAGE_CAP = 2_000;

type Meta = Readonly<Record<string, unknown>>;
const str = (m: Meta | undefined, k: string): string | undefined => {
  const v = m?.[k];
  return typeof v === "string" ? v : undefined;
};
const strArr = (m: Meta | undefined, k: string): readonly string[] => {
  const v = m?.[k];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
};
const ev1 = (e: TraceEvent, detail: string): CauseEvidence => ({ eventKind: e.kind, seq: e.seq, detail });
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}...` : s);
const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

interface Facts {
  readonly ev: readonly TraceEvent[];
  readonly completed?: RunCompletedEvent;
  readonly aborted?: RunAbortedEvent;
  readonly grade?: EvalGradedEvent;
  readonly contract?: ContractCompiledEvent;
  readonly exchanges: readonly LLMExchangeEvent[];
  readonly toolStarts: readonly ToolCallEvent[];
  readonly toolEnds: readonly ToolCallEvent[];
  readonly assessments: readonly AssessmentEvent[];
  readonly terminalDecision?: GuardFiredEvent;
  readonly terminatedBy?: string;
  readonly abstained: boolean;
  /** Contract tool-coverage requirements (`tool:<name>` → name). */
  readonly requiredTools: readonly string[];
  readonly outstanding: readonly string[];
  readonly failureSignals: readonly string[];
}

function gatherFacts(trace: Trace): Facts {
  const ev = trace.events;
  const completed = ev.filter((e): e is RunCompletedEvent => e.kind === "run-completed").at(-1);
  const aborted = ev.filter((e): e is RunAbortedEvent => e.kind === "run-aborted").at(-1);
  const grade = ev.filter((e): e is EvalGradedEvent => e.kind === "eval-graded").at(-1);
  const contract = ev.find((e): e is ContractCompiledEvent => e.kind === "contract-compiled");
  const terminalDecision = ev
    .filter((e): e is GuardFiredEvent => e.kind === "guard-fired" && e.guard === "terminal_decision")
    .at(-1);
  const terminatedBy =
    completed?.terminatedBy ?? str(terminalDecision?.metadata, "terminatedBy") ?? terminalDecision?.reason;
  const abstained = terminatedBy === "abstained" || completed?.outcome?.status === "abstained";
  const failureSignals: string[] = [];
  if (completed === undefined) failureSignals.push(aborted ? `run-aborted.causeClass=${aborted.causeClass}` : "no run-completed");
  else if (completed.status !== "success") failureSignals.push(`run-completed.status=${completed.status}`);
  if (completed?.outcome?.success === false) failureSignals.push("run-completed.outcome.success=false");
  if (grade !== undefined && !grade.passed) failureSignals.push(`eval-graded.passed=false (score ${grade.score.toFixed(3)})`);
  const requiredTools = (contract?.requirements ?? [])
    .filter((r) => r.kind === "tool-coverage" && r.id.startsWith("tool:"))
    .map((r) => r.id.slice("tool:".length));
  return {
    ev,
    ...(completed !== undefined ? { completed } : {}),
    ...(aborted !== undefined ? { aborted } : {}),
    ...(grade !== undefined ? { grade } : {}),
    ...(contract !== undefined ? { contract } : {}),
    exchanges: ev.filter((e): e is LLMExchangeEvent => e.kind === "llm-exchange"),
    toolStarts: ev.filter((e): e is ToolCallEvent => e.kind === "tool-call-start"),
    toolEnds: ev.filter((e): e is ToolCallEvent => e.kind === "tool-call-end"),
    assessments: ev.filter((e): e is AssessmentEvent => e.kind === "assessment"),
    ...(terminalDecision !== undefined ? { terminalDecision } : {}),
    ...(terminatedBy !== undefined ? { terminatedBy } : {}),
    abstained,
    requiredTools,
    outstanding: completed?.outcome?.outstanding ?? [],
    failureSignals,
  };
}

// ─── Targets and the divergence turn ─────────────────────────────────────────

const baseName = (p: string): string => p.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? p;
const artifactRef = (id: string): string => baseName(id.replace(/^artifact:/, ""));
/** A deliverable file name that is a template (`out-N.txt`, `{name}.md`, `<x>.txt`, `*.csv`). */
const isTemplate = (ref: string): boolean => /(^|[^A-Za-z])N([^A-Za-z]|$)|[{}<>*]/.test(ref.replace(/\.[a-z0-9]+$/i, ""));
function refMatcher(ref: string): (path: string) => boolean {
  if (!isTemplate(ref)) return (p) => baseName(p) === ref;
  const esc = ref.replace(/[.+?^$()|[\]\\]/g, "\\$&")
    .replace(/(^|[^A-Za-z])N(?=[^A-Za-z]|$)/g, "$1\\d+")
    .replace(/\{[^}]*\}|<[^>]*>|\*/g, ".+");
  const re = new RegExp(`^${esc}$`);
  return (p) => re.test(baseName(p));
}

const argPath = (args: unknown): string | undefined => {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return undefined;
  const v = (args as Meta)["path"];
  return typeof v === "string" ? v : undefined;
};

/** Pick the failing targets: grader check file names, else contract/outstanding file deliverables, else run writes, else the answer. */
function pickTargets(f: Facts): readonly AttributionTarget[] {
  const failedChecks = f.grade !== undefined && !f.grade.passed ? f.grade.checks.filter((c) => !c.passed) : [];
  const fromChecks = new Set<string>();
  for (const c of failedChecks) {
    if (COMMAND_CHECK.test(c.name)) continue;
    for (const m of c.name.matchAll(FILE_IN_TEXT)) if (m[1]) fromChecks.add(baseName(m[1]));
  }
  if (fromChecks.size > 0) return [...fromChecks].map((ref) => ({ kind: "file", ref, source: "grader-check" }));
  // A grader on abstention behavior judges the terminal choice, not a file.
  const abstentionCheck = failedChecks.some((c) => /abstain|abstention/i.test(c.name));
  if (!abstentionCheck) {
    const outstandingFiles = f.outstanding.filter((o) => o.startsWith("artifact:")).map(artifactRef);
    if (outstandingFiles.length > 0) return outstandingFiles.map((ref) => ({ kind: "file", ref, source: "outcome-outstanding" }));
    const contractFiles = (f.contract?.deliverables ?? []).filter((d) => d.id.startsWith("artifact:")).map((d) => artifactRef(d.id));
    if (contractFiles.length > 0) return contractFiles.map((ref) => ({ kind: "file", ref, source: "contract" }));
    if (f.grade !== undefined && !f.grade.passed) {
      const written = [...new Set(f.toolEnds.filter((t) => t.ok !== false).map((t) => argPath(t.args)).filter((p): p is string => p !== undefined && isWrite(f, p)).map(baseName))];
      if (written.length > 0) return written.map((ref) => ({ kind: "file", ref, source: "run-writes" }));
    }
  }
  return [{ kind: "answer", ref: "answer", source: "final-output" }];
}

/** True when a successful call on `path` came from a writer tool. */
function isWrite(f: Facts, path: string): boolean {
  return f.toolEnds.some((t) => argPath(t.args) === path && t.ok !== false && isWriter(t.toolName));
}

/** The last exchange before `seq`. */
const exchangeBefore = (f: Facts, seq: number): LLMExchangeEvent | undefined =>
  f.exchanges.filter((x) => x.seq < seq).at(-1);

/** The exchange whose response asked for the call that ended at `end`. */
function sourceExchange(f: Facts, end: ToolCallEvent): LLMExchangeEvent | undefined {
  const path = argPath(end.args);
  const before = f.exchanges.filter((x) => x.seq < end.seq);
  const latest = (pred: (x: LLMExchangeEvent) => boolean): LLMExchangeEvent | undefined => {
    for (let i = before.length - 1; i >= 0; i--) if (pred(before[i]!)) return before[i]!;
    return undefined;
  };
  // 1. A native call to the same tool on the same file.
  const native = latest((x) => (x.response.toolCalls ?? []).some((c) => c.name === end.toolName &&
    (path === undefined || (argPath(c.arguments) !== undefined && baseName(argPath(c.arguments)!) === baseName(path)))));
  if (native) return native;
  // 2. The turn whose response text holds the written content (a synthesize or planner step).
  const content = typeof end.args === "object" && end.args !== null ? (end.args as Meta)["content"] : undefined;
  const head = typeof content === "string" ? content.trim().slice(0, 80) : "";
  if (head.length >= 20) {
    const producer = latest((x) => x.response.content.includes(head));
    if (producer) return producer;
  }
  // 3. A text-parsed or planned call: the path appears in the response text.
  if (path !== undefined) {
    const named = latest((x) => x.response.content.includes(baseName(path)));
    if (named) return named;
  }
  return before.at(-1);
}

interface Divergence {
  readonly target: AttributionTarget;
  readonly exchange: LLMExchangeEvent;
  /** The successful write that produced the file (file targets only). */
  readonly write?: ToolCallEvent;
}

/** Locate the divergence turn for one target, or undefined when the target was never produced. */
function divergenceFor(f: Facts, target: AttributionTarget): Divergence | undefined {
  if (target.kind === "file") {
    const match = refMatcher(target.ref);
    const write = f.toolEnds.filter((t) => t.ok !== false && isWriter(t.toolName))
      .filter((t) => { const p = argPath(t.args); return p !== undefined && match(p); })
      .at(-1);
    if (!write) return undefined;
    const exchange = sourceExchange(f, write);
    return exchange ? { target, exchange, write } : undefined;
  }
  const out = (f.completed?.output ?? "").trim();
  if (out.length === 0) return undefined;
  const head = out.slice(0, 200);
  const exchange = f.exchanges
    .filter((x) => {
      const c = x.response.content.trim();
      return c.length > 0 && (c.includes(head) || out.includes(c.slice(0, 200)));
    })
    .at(-1);
  return exchange ? { target, exchange } : undefined;
}

// ─── Evidence presence in a projected request ────────────────────────────────

interface RequestView {
  readonly text: string;
  /** The recorder clipped at least one message (or the system prompt). */
  readonly clipped: boolean;
}
function requestView(x: LLMExchangeEvent): RequestView {
  const parts = [x.systemPrompt ?? "", ...x.messages.map((m) => m.content)];
  const clipped = x.systemPromptTruncated === true || x.messages.some((m) => m.truncated === true || m.content.length >= RECORDER_MESSAGE_CAP);
  return { text: parts.join("\n"), clipped };
}

/** Harness wrapper lines on a recorded tool result that are not tool output. */
const WRAPPER_LINE = /^\[[^\]]*(compressed preview|recovery guidance)[^\]]*\]$|^\.\.\.\s*\d+ more lines$/i;
const ALREADY_DONE = /\s*\[Already done[^\]]*\]\s*$/;
const resultText = (t: ToolCallEvent): string =>
  typeof t.result === "string" ? t.result : t.result === undefined ? "" : JSON.stringify(t.result);

/** The elision marker a compressed tool-result preview ends with (`  ...43 more lines`). */
const ELIDED_LINES = /^\s*\.\.\.\s*(\d+) more lines\s*$/m;

/**
 * `present`: the result's content is in the request. `elided`: the request carries
 * only the harness's compressed preview of it (the `...N more lines` marker is in
 * the request). `absent`: not there. `unverifiable`: hidden behind the recorder cap.
 */
type Presence = "present" | "elided" | "absent" | "unverifiable";
/** Is a tool result's content in the request? Line-level for long results, boundary match for short ones. */
function presence(t: ToolCallEvent, req: RequestView): Presence {
  const raw = resultText(t).replace(ALREADY_DONE, "");
  const marker = ELIDED_LINES.exec(raw);
  if (marker && req.text.includes(marker[0].trim())) {
    const firstData = raw.split("\n").map((l) => l.trim()).find((l) => l.length >= 4 && !WRAPPER_LINE.test(l));
    if (firstData === undefined || req.text.includes(firstData)) return "elided";
  }
  const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !WRAPPER_LINE.test(l));
  if (t.resultTruncated === true && lines.length > 1) lines.pop();
  if (lines.length === 0) return "present";
  const joined = lines.join("\n");
  if (joined.length <= 40 && lines.length === 1) {
    const esc = joined.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\w.])${esc}($|[^\\w.])`).test(req.text) ? "present" : req.clipped ? "unverifiable" : "absent";
  }
  const informative = lines.filter((l) => l.length >= 4);
  if (informative.length === 0) return req.text.includes(joined) ? "present" : req.clipped ? "unverifiable" : "absent";
  const hit = informative.filter((l) => req.text.includes(l)).length;
  if (hit === informative.length) return "present";
  // The recorder caps each message: a result whose head is present and whose
  // tail is missing behind a clipped message cannot be checked further.
  if (hit > 0 && req.clipped && req.text.includes(informative[0]!)) return "unverifiable";
  if (hit / informative.length >= 0.8) return "present";
  return req.clipped && hit === 0 ? "unverifiable" : hit === 0 ? "absent" : "unverifiable";
}

/** A result the harness wrote itself (repetition notices), not tool output. */
const HARNESS_NOTICE = /^⚠️ You have already called|^\[Code execution failed/;

/** Distinct successful evidence results before `seq` (latest per tool+args; writes and meta excluded). */
function evidenceBefore(f: Facts, seq: number): readonly ToolCallEvent[] {
  const byKey = new Map<string, ToolCallEvent>();
  for (const t of f.toolEnds) {
    if (t.seq >= seq || t.ok === false || isMeta(t.toolName)) continue;
    if (isWriter(t.toolName)) continue;
    const text = resultText(t);
    if (text.trim().length === 0 || HARNESS_NOTICE.test(text)) continue;
    byKey.set(`${t.toolName}:${JSON.stringify(t.args ?? null)}`, t);
  }
  return [...byKey.values()];
}

// ─── Rules ────────────────────────────────────────────────────────────────────

interface Ctx {
  readonly f: Facts;
  readonly targets: readonly AttributionTarget[];
  /** Divergence per target, in target order; undefined when never produced. */
  readonly divergences: readonly (Divergence | undefined)[];
  /** Earliest divergence across targets. */
  readonly first?: Divergence;
}

interface Hit {
  readonly reason: AttributionReason;
  readonly evidence: readonly CauseEvidence[];
  readonly needs: readonly string[];
  readonly divergence?: Divergence;
  readonly target?: AttributionTarget;
}
type Rule = (c: Ctx) => Hit | undefined;

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

/** Native non-meta calls the model emitted that never reached a tool-call-start/end before the next exchange. */
function droppedCalls(f: Facts): readonly { readonly x: LLMExchangeEvent; readonly name: string; readonly path?: string }[] {
  const out: { x: LLMExchangeEvent; name: string; path?: string }[] = [];
  for (let i = 0; i < f.exchanges.length; i++) {
    const x = f.exchanges[i]!;
    const next = f.exchanges[i + 1]?.seq ?? Number.POSITIVE_INFINITY;
    for (const c of x.response.toolCalls ?? []) {
      if (isMeta(c.name)) continue;
      const ran = [...f.toolStarts, ...f.toolEnds].some((t) => t.toolName === c.name && t.seq > x.seq && t.seq < next);
      if (ran) continue;
      const p = argPath(c.arguments);
      out.push({ x, name: c.name, ...(p !== undefined ? { path: p } : {}) });
    }
  }
  return out;
}

const ruleToolCallDropped: Rule = ({ f, targets, divergences }) => {
  const drops = droppedCalls(f);
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
    !f.toolEnds.some((e) => sameResource(e, d) && e.ok !== false && e.seq > d.x.seq) &&
    !f.toolEnds.some((e) => sameResource(e, d) && e.ok === false && e.seq < d.x.seq));
  if (!req) return undefined;
  const what = `${req.name}${req.path !== undefined ? `(${baseName(req.path)})` : ""}`;
  const switched = f.ev.find((e) => e.kind === "strategy-switched" && e.seq > req.x.seq);
  return {
    reason: "harness:tool-call-dropped",
    evidence: [
      ev1(req.x, `model emitted native ${what} — no tool-call-start/end followed, and the run never reached it afterwards`),
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
  const stopGuard = f.ev.filter((e): e is GuardFiredEvent =>
    e.kind === "guard-fired" && e.outcome === "terminate" && e.guard !== "terminal_decision" && str(e.metadata, "counter") === "iteration").at(-1);
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
  for (const r of results) by[presence(r, req)].push(r);
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
  const drops = chk.absent.length > 0 ? droppedRefsBefore(f, first) : [];
  if (chk.elided.length === 0 && drops.length === 0) return undefined;
  return {
    reason: "harness:evidence-truncated",
    divergence: first,
    evidence: [
      ...chk.elided.slice(0, 2).map((r) => ev1(r, `the divergence turn's request carried only a compressed preview of this ${r.toolName} result (${ELIDED_LINES.exec(resultText(r))?.[0].trim() ?? "elided"})`)),
      ...drops.slice(-3),
      ...(drops.length > 0 ? chk.absent.slice(0, 2).map((r) => ev1(r, `${r.toolName} result absent from the divergence turn's request`)) : []),
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

const ruleMisleadingGuidance: Rule = ({ f, targets, divergences }) => {
  const unwritten = targets.filter((t, i) => t.kind === "file" && divergences[i] === undefined);
  if (unwritten.length === 0) return undefined;
  for (const g of guidanceSignals(f)) {
    if (g.target === undefined || !satisfiedBefore(f, g.target, g.sig.seq)) continue;
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
    needs: chk.unverifiable.length > 0 ? [`full request text (${chk.unverifiable.length} result(s) clipped by the ${RECORDER_MESSAGE_CAP}-char recorder cap)`] : [],
  };
};

const RULES: readonly Rule[] = [
  ruleFalseVeto, ruleToolSurface, ruleToolCallDropped, ruleToolCallCorrupted, rulePrematureStop,
  ruleEvidenceTruncated, ruleEvidenceMissing, ruleMisleadingGuidance, ruleIgnoredGuidance, ruleHadEvidence,
];

const verdictOf = (r: AttributionReason): AttributionVerdict =>
  r.startsWith("harness:") ? "harness" : r.startsWith("model:") ? "model" : r === "not-failed" ? "not-failed" : "unattributed";

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
  L.push(`${a.runId}: ${a.verdict} (${a.reason}) confidence=${a.confidence}${a.target ? ` target=${a.target.ref}` : ""}${a.divergenceTurn ? ` divergence=iter ${a.divergenceTurn.iter} seq ${a.divergenceTurn.seq}` : ""}`);
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
  const byVerdict: Record<AttributionVerdict, number> = { harness: 0, model: 0, unattributed: 0, "not-failed": 0 };
  const byReason: Record<string, number> = {};
  const byConfidence: Record<CauseConfidence, number> = { decisive: 0, probable: 0, "insufficient-trace": 0 };
  for (const a of attributions) {
    byVerdict[a.verdict] += 1;
    byReason[a.reason] = (byReason[a.reason] ?? 0) + 1;
    byConfidence[a.confidence] += 1;
  }
  return { total: attributions.length, byVerdict, byReason, byConfidence };
}
