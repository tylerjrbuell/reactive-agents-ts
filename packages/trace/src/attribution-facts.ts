// packages/trace/src/attribution-facts.ts
//
// The facts layer of `attribution.ts`: what a trace records about a run
// (completion, grade, contract, known deliverables, tool calls, exchanges), the
// failing targets, the divergence turn that produced each target, and whether a
// tool result was present in a turn's projected request. Pure reads of trace
// events; the rules that turn these facts into a verdict live in attribution.ts
// and attribution-rules.ts.

import { contentText } from "@reactive-agents/core";
import type { Trace } from "./replay.js";
import type { CauseEvidence } from "./cause.js";
import type { AttributionTarget } from "./attribution.js";
import type { AttributionReason } from "./taxonomy.js";
import type {
  TraceEvent,
  RunStartedEvent,
  RunCompletedEvent,
  RunAbortedEvent,
  EvalGradedEvent,
  LLMExchangeEvent,
  ToolCallEvent,
  ContractCompiledEvent,
  AssessmentEvent,
  GuardFiredEvent,
  ProjectionRenderedEvent,
} from "./events.js";

// ─── Facts ────────────────────────────────────────────────────────────────────

/** Harness bookkeeping tools: never evidence, never a deliverable. Mirrors cause.ts. */
export const META_TOOLS: ReadonlySet<string> = new Set([
  "brief", "pulse", "find", "recall", "discover-tools", "context-status",
  "checkpoint", "final-answer", "task-complete", "activate-skill",
  "get-skill-section", "todo",
]);
export const isMeta = (name: string): boolean => META_TOOLS.has(name);

/** Tools that produce files (writers), by name. Their results are receipts, not evidence. */
export const WRITER = /write|edit|patch|create|save/i;
export const isWriter = (toolName: string): boolean => WRITER.test(toolName);

/** A terminatedBy the harness (not the model) chose. */
export const HARNESS_STOP = /dispatcher|early[_-]stop|max[_-]iterations|budget|loop_graceful|harness_deliverable|harness_synthesis|stall|controller/;

/** File names named in grader checks (`low-stock.txt exists`, `out-2.txt is 84`). */
export const FILE_IN_TEXT = /(?:^|[\s"'`(/])((?:[\w-]+\/)*[\w.-]+\.(?:txt|md|json|csv|tsv|ts|tsx|js|mjs|cjs|py|html|css|ya?ml|xml|sql|sh|toml))\b/gi;

/** Object-literal source text inside a string argument: `{\n  path: "..."` — the mark of a text-parsed call. */
export const OBJECT_LITERAL_FRAGMENT = /\{\s*["']?[A-Za-z_][\w-]*["']?\s*:/;

/** Argument names that locate a resource (a path, URL or the single wrapped `input`), never free content. */
export const LOCATOR_ARG = /^(path|file|filePath|filename|dir|directory|url|uri|input|target)$/i;

/** Grader check names that are commands (`bun test ./x.test.ts`), not a file the run had to write. */
export const COMMAND_CHECK = /^(bun|bunx|npm|npx|node|deno|yarn|pnpm|python3?|pytest|sh|bash|make|go|cargo)\s/;

/** A recorded `llm-exchange` request holds at most this many chars per message (llm-provider exchange-projection). */
export const RECORDER_MESSAGE_CAP = 2_000;

export type Meta = Readonly<Record<string, unknown>>;
export const str = (m: Meta | undefined, k: string): string | undefined => {
  const v = m?.[k];
  return typeof v === "string" ? v : undefined;
};
export const strArr = (m: Meta | undefined, k: string): readonly string[] => {
  const v = m?.[k];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
};
export const ev1 = (e: TraceEvent, detail: string): CauseEvidence => ({ eventKind: e.kind, seq: e.seq, detail });
export const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}...` : s);
export const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

export interface Facts {
  readonly ev: readonly TraceEvent[];
  /** The task text (`run-started.task`); empty when the trace has no run-started. */
  readonly task: string;
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
  /**
   * File names the harness knew the run had to produce: the compiled contract's
   * artifact deliverables plus every `artifact:` requirement the run ledger
   * records as `declared` (items added after compile, e.g. plan-declared).
   */
  readonly knownFiles: readonly string[];
  readonly outstanding: readonly string[];
  readonly failureSignals: readonly string[];
}

export function gatherFacts(trace: Trace): Facts {
  const ev = trace.events;
  const started = ev.find((e): e is RunStartedEvent => e.kind === "run-started");
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
  const knownFiles = new Set((contract?.deliverables ?? []).filter((d) => d.id.startsWith("artifact:")).map((d) => artifactRef(d.id)));
  for (const e of ev) {
    if (e.kind !== "ledger-entry") continue;
    for (const entry of e.entries) {
      const id = entry["requirementId"];
      if (entry["kind"] === "requirement" && entry["status"] === "declared" && typeof id === "string" && id.startsWith("artifact:")) {
        knownFiles.add(artifactRef(id));
      }
    }
  }
  return {
    ev,
    task: started?.task ?? "",
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
    knownFiles: [...knownFiles],
    outstanding: completed?.outcome?.outstanding ?? [],
    failureSignals,
  };
}

// ─── Rule shape (shared by attribution.ts and attribution-rules.ts) ──────────

export interface Ctx {
  readonly f: Facts;
  readonly targets: readonly AttributionTarget[];
  /** Divergence per target, in target order; undefined when never produced. */
  readonly divergences: readonly (Divergence | undefined)[];
  /** Earliest divergence across targets. */
  readonly first?: Divergence;
}

export interface Hit {
  readonly reason: AttributionReason;
  readonly evidence: readonly CauseEvidence[];
  readonly needs: readonly string[];
  readonly divergence?: Divergence;
  readonly target?: AttributionTarget;
}
export type Rule = (c: Ctx) => Hit | undefined;

// ─── Executed vs. replaced calls ──────────────────────────────────────────────

/**
 * The repetition guard's notice. A `tool-call-end` whose result is this notice
 * did NOT run the tool: the guard replaced the call (a write wrote nothing, a
 * read returned no content). Instrument fault I5 (2026-11-06 evidence audit).
 */
export const REPETITION_NOTICE = /^⚠️ You have already called/;

/** A tool call that ran and succeeded: not failed, not replaced by a repetition notice. */
export const executedOk = (t: ToolCallEvent): boolean => t.ok !== false && !REPETITION_NOTICE.test(resultText(t));

/** The `content` argument of a write call or a native tool call's arguments. */
export const contentArg = (args: unknown): string | undefined => {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return undefined;
  const v = (args as Meta)["content"];
  return typeof v === "string" ? v : undefined;
};

/** What happened to one native tool call the model emitted. */
export type CallFate = "ran" | "notice" | "refused" | "dropped";
export interface NativeCall {
  /** The exchange whose response emitted the call. */
  readonly x: LLMExchangeEvent;
  readonly name: string;
  readonly args: unknown;
  readonly path?: string;
  /**
   * `ran`: a tool-call-end (or an unpaired tool-call-start) followed before the
   * next exchange. `notice`: it ran into the repetition guard (not executed).
   * `refused`: the tool gate refused it (`guard-fired{guard:"tool-gate"}`).
   * `dropped`: nothing followed: the harness never ran it and never said why.
   */
  readonly fate: CallFate;
  readonly end?: ToolCallEvent;
}

/**
 * Every native non-meta tool call the model emitted, with its fate. Calls are
 * matched to the events that followed them before the next exchange by tool
 * name AND target path, so one `file-write` running cannot hide two dropped
 * ones in the same batch (instrument fault I3). Path matches are claimed first;
 * calls without a matching end then take an unclaimed end of the same tool when
 * either side has no path; leftover calls take open starts, then tool-gate
 * refusals of the same tool; the rest are dropped.
 */
export function nativeCalls(f: Facts): readonly NativeCall[] {
  const out: NativeCall[] = [];
  for (let i = 0; i < f.exchanges.length; i++) {
    const x = f.exchanges[i]!;
    const next = f.exchanges[i + 1]?.seq ?? Number.POSITIVE_INFINITY;
    const inWin = (e: TraceEvent): boolean => e.seq > x.seq && e.seq < next;
    const calls = (x.response.toolCalls ?? []).filter((c) => !isMeta(c.name));
    if (calls.length === 0) continue;
    const ends = f.toolEnds.filter((t) => inWin(t) && !isMeta(t.toolName));
    const used = new Set<ToolCallEvent>();
    const fates: (CallFate | undefined)[] = calls.map(() => undefined);
    const matched: (ToolCallEvent | undefined)[] = calls.map(() => undefined);
    const claim = (ci: number, e: ToolCallEvent): void => {
      used.add(e);
      matched[ci] = e;
      fates[ci] = REPETITION_NOTICE.test(resultText(e)) ? "notice" : "ran";
    };
    // Pass 1: same tool and same target path.
    calls.forEach((c, ci) => {
      const p = argPath(c.arguments);
      if (p === undefined) return;
      const e = ends.find((t) => !used.has(t) && t.toolName === c.name && argPath(t.args) !== undefined && baseName(argPath(t.args)!) === baseName(p));
      if (e) claim(ci, e);
    });
    // Pass 2: same tool, an unclaimed end where either side carries no path.
    calls.forEach((c, ci) => {
      if (fates[ci] !== undefined) return;
      const e = ends.find((t) => !used.has(t) && t.toolName === c.name &&
        (argPath(t.args) === undefined || argPath(c.arguments) === undefined));
      if (e) claim(ci, e);
    });
    // Starts with no end in the window (the tool is still running at the next turn).
    const openStarts = new Map<string, number>();
    for (const s of f.toolStarts) {
      if (!inWin(s) || isMeta(s.toolName)) continue;
      openStarts.set(s.toolName, (openStarts.get(s.toolName) ?? 0) + 1);
    }
    for (const e of ends) openStarts.set(e.toolName, (openStarts.get(e.toolName) ?? 0) - 1);
    const refusals = new Map<string, number>();
    for (const e of f.ev) {
      if (e.kind === "guard-fired" && e.guard === "tool-gate" && inWin(e)) {
        const n = str(e.metadata, "toolName");
        if (n !== undefined) refusals.set(n, (refusals.get(n) ?? 0) + 1);
      }
    }
    calls.forEach((c, ci) => {
      if (fates[ci] !== undefined) return;
      if ((openStarts.get(c.name) ?? 0) > 0) { openStarts.set(c.name, openStarts.get(c.name)! - 1); fates[ci] = "ran"; return; }
      if ((refusals.get(c.name) ?? 0) > 0) { refusals.set(c.name, refusals.get(c.name)! - 1); fates[ci] = "refused"; return; }
      fates[ci] = "dropped";
    });
    calls.forEach((c, ci) => {
      const p = argPath(c.arguments);
      const e = matched[ci];
      out.push({ x, name: c.name, args: c.arguments, ...(p !== undefined ? { path: p } : {}), fate: fates[ci]!, ...(e ? { end: e } : {}) });
    });
  }
  return out;
}

// ─── Inputs the task lists ────────────────────────────────────────────────────

/** A path token in task text: absolute (`/w/notes-1.txt`) or explicitly relative (`./ledger.json`). */
const INPUT_PATH = /(?:^|[\s"'`(])((?:\.\/|\/)[\w.-]+(?:\/[\w.-]+)*\.[A-Za-z0-9]+)(?=$|[\s"'`),.;:])/g;
/** A numbered range of files (`/w/notes-1.txt through /w/notes-6.txt`). */
const INPUT_RANGE = /((?:\.\/|\/)[\w./-]*?)(\d+)(\.[A-Za-z0-9]+)\s+(?:through|to|thru)\s+(?:\.\/|\/)[\w./-]*?(\d+)\3/g;
/** A sentence that makes its inputs conditional (`If the API is unavailable, check whether x.json exists`). */
const CONDITIONAL_SENTENCE = /^\s*(?:if|when|unless|in case|otherwise)\b/i;

/**
 * File names the task text gives as existing inputs: path tokens written with a
 * leading `/` or `./` (deliverables are named bare, `write out.txt`), plus each
 * member of a numbered range (`notes-1.txt through notes-6.txt`). Inputs named
 * only in a conditional sentence (`If ...`) are not required reading. Base names.
 */
export function listedInputs(task: string): readonly string[] {
  const out = new Set<string>();
  for (const sentence of task.split(/(?<=[.!?:])\s+|\n+/)) {
    if (CONDITIONAL_SENTENCE.test(sentence)) continue;
    for (const m of sentence.matchAll(INPUT_PATH)) if (m[1]) out.add(baseName(m[1]));
    for (const m of sentence.matchAll(INPUT_RANGE)) {
      const [lo, hi] = [Number(m[2]), Number(m[4])];
      const prefix = baseName(`${m[1]!}x`).slice(0, -1);
      if (!(hi > lo) || hi - lo > 50) continue;
      for (let k = lo; k <= hi; k++) out.add(`${prefix}${k}${m[3]!}`);
    }
  }
  return [...out];
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** True when `name` appears in `args` as a whole file name (`a.json` does not match `data.json`). */
export const argsMention = (args: unknown, name: string): boolean =>
  new RegExp(`(^|[^\\w.-])${escapeRe(name)}($|[^\\w.-])`).test(JSON.stringify(args ?? null));

/** True when a non-writer call that actually ran (ok or not) named `input` before `seq`. */
export const gatheredBefore = (f: Facts, input: string, seq: number): boolean =>
  f.toolEnds.some((t) => t.seq < seq && !isMeta(t.toolName) && !isWriter(t.toolName) &&
    !REPETITION_NOTICE.test(resultText(t)) && argsMention(t.args, input));

// ─── Targets and the divergence turn ─────────────────────────────────────────

export const baseName = (p: string): string => p.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ?? p;
export const artifactRef = (id: string): string => baseName(id.replace(/^artifact:/, ""));
/** A deliverable file name that is a template (`out-N.txt`, `{name}.md`, `<x>.txt`, `*.csv`). */
export const isTemplate = (ref: string): boolean => /(^|[^A-Za-z])N([^A-Za-z]|$)|[{}<>*]/.test(ref.replace(/\.[a-z0-9]+$/i, ""));
export function refMatcher(ref: string): (path: string) => boolean {
  if (!isTemplate(ref)) return (p) => baseName(p) === ref;
  const esc = ref.replace(/[.+?^$()|[\]\\]/g, "\\$&")
    .replace(/(^|[^A-Za-z])N(?=[^A-Za-z]|$)/g, "$1\\d+")
    .replace(/\{[^}]*\}|<[^>]*>|\*/g, ".+");
  const re = new RegExp(`^${esc}$`);
  return (p) => re.test(baseName(p));
}

export const argPath = (args: unknown): string | undefined => {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return undefined;
  const v = (args as Meta)["path"];
  return typeof v === "string" ? v : undefined;
};

/** The file stem (`processor` for `src/processor.ts`); undefined when shorter than 3 chars. */
export const stemOf = (ref: string): string | undefined => {
  const s = baseName(ref).replace(/\.[A-Za-z0-9]+$/, "");
  return s.length >= 3 ? s : undefined;
};
/** True when a check name mentions the file's stem as a whole word (`processor bug (...)` names processor.ts). */
export const namesStem = (checkName: string, ref: string): boolean => {
  const s = stemOf(ref);
  return s !== undefined && new RegExp(`(^|[^A-Za-z0-9])${escapeRe(s)}($|[^A-Za-z0-9])`, "i").test(checkName);
};

/** Pick the failing targets: grader check file names, else contract/outstanding file deliverables, else run writes, else the answer. */
export function pickTargets(f: Facts): readonly AttributionTarget[] {
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
      const written = [...new Set(f.toolEnds.filter(executedOk).map((t) => argPath(t.args)).filter((p): p is string => p !== undefined && isWrite(f, p)).map(baseName))];
      // `eval-graded` records only the FAILED checks. When the failed checks name
      // files the run knows (written, or listed as input) by stem, a written file
      // none of them names passed: keep only the named ones, and judge the answer
      // when none was written (instrument fault I1). Checks that name no known
      // file (`contains a data table`) leave every written file in play.
      const known = [...new Set([...written, ...listedInputs(f.task)])];
      const namedKnown = known.filter((ref) => failedChecks.some((c) => namesStem(c.name, ref)));
      const keep = namedKnown.length === 0 ? written : written.filter((ref) => namedKnown.includes(ref));
      if (keep.length > 0) return keep.map((ref) => ({ kind: "file", ref, source: "run-writes" }));
    }
  }
  return [{ kind: "answer", ref: "answer", source: "final-output" }];
}

/** True when a write call on `path` ran and succeeded (a repetition notice wrote nothing). */
export function isWrite(f: Facts, path: string): boolean {
  return f.toolEnds.some((t) => argPath(t.args) === path && executedOk(t) && isWriter(t.toolName));
}

/** The last exchange before `seq`. */
export const exchangeBefore = (f: Facts, seq: number): LLMExchangeEvent | undefined =>
  f.exchanges.filter((x) => x.seq < seq).at(-1);

/** The exchange whose response asked for the call that ended at `end`. */
export function sourceExchange(f: Facts, end: ToolCallEvent): LLMExchangeEvent | undefined {
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
  const content = contentArg(end.args);
  const head = content !== undefined ? content.trim().slice(0, 80) : "";
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

export interface Divergence {
  readonly target: AttributionTarget;
  readonly exchange: LLMExchangeEvent;
  /** The successful write that produced the file (file targets only). */
  readonly write?: ToolCallEvent;
}

/** Locate the divergence turn for one target, or undefined when the target was never produced. */
export function divergenceFor(f: Facts, target: AttributionTarget): Divergence | undefined {
  if (target.kind === "file") {
    const match = refMatcher(target.ref);
    const write = f.toolEnds.filter((t) => executedOk(t) && isWriter(t.toolName))
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

/**
 * The last point the divergent output could still draw on new evidence: the
 * divergence turn when the model emitted the write natively (results that land
 * after it, even in the same batch, were not visible to it), else the write
 * itself (a planned or harness-resolved write is filled in at execution time).
 */
export function evidenceCutoff(d: Divergence | undefined): number {
  if (d === undefined) return Number.POSITIVE_INFINITY;
  const w = d.write;
  if (w === undefined) return d.exchange.seq;
  const p = argPath(w.args);
  const native = (d.exchange.response.toolCalls ?? []).some((c) => c.name === w.toolName &&
    (p === undefined || baseName(argPath(c.arguments) ?? "") === baseName(p)));
  return native ? d.exchange.seq : w.seq;
}

// ─── Evidence presence in a projected request ────────────────────────────────

export interface RequestView {
  readonly text: string;
  /** The recorder clipped at least one message (or the system prompt). */
  readonly clipped: boolean;
}
export function requestView(x: LLMExchangeEvent): RequestView {
  // contentText: the one text-of-content rule (core), so a request view reads
  // message text the same way the kernel does if exchange content ever widens.
  const parts = [x.systemPrompt ?? "", ...x.messages.map((m) => contentText(m.content))];
  const clipped = x.systemPromptTruncated === true || x.messages.some((m) => m.truncated === true || m.content.length >= RECORDER_MESSAGE_CAP);
  return { text: parts.join("\n"), clipped };
}

/** Harness wrapper lines on a recorded tool result that are not tool output. */
export const WRAPPER_LINE = /^\[[^\]]*(compressed preview|recovery guidance)[^\]]*\]$|^\.\.\.\s*\d+ more lines$/i;
export const ALREADY_DONE = /\s*\[Already done[^\]]*\]\s*$/;
export const resultText = (t: ToolCallEvent): string =>
  typeof t.result === "string" ? t.result : t.result === undefined ? "" : JSON.stringify(t.result);

/** The elision marker a compressed tool-result preview ends with (`  ...43 more lines`). */
export const ELIDED_LINES = /^\s*\.\.\.\s*(\d+) more lines\s*$/m;

/**
 * `present`: the result's content is in the request. `elided`: the request carries
 * only the harness's compressed preview of it (the `...N more lines` marker is in
 * the request). `absent`: not there. `unverifiable`: hidden behind the recorder cap.
 */
export type Presence = "present" | "elided" | "absent" | "unverifiable";
/** Is a tool result's content in the request? Line-level for long results, boundary match for short ones. */
export function presence(t: ToolCallEvent, req: RequestView): Presence {
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

/**
 * Presence corrected by what the projector did in the turn (instrument fault I4).
 * The recorded result can itself be a compressed preview (structured previews
 * carry no `...N more lines` marker), so finding its lines in the request does
 * not show the model saw the payload. The projection that built this request
 * records each result it compressed, by tool: when it compressed results of this
 * result's tool, the result is `elided` if the compressions cover every result
 * of that tool, else `unverifiable` (the projection names the tool, not which
 * result). A projection that compressed nothing of this tool leaves the reading.
 */
export function curatedPresence(f: Facts, x: LLMExchangeEvent, t: ToolCallEvent, p: Presence, results: readonly ToolCallEvent[]): Presence {
  if (p === "absent") return p;
  const prev = f.exchanges.filter((y) => y.seq < x.seq).at(-1)?.seq ?? Number.NEGATIVE_INFINITY;
  const proj = f.ev.filter((e): e is ProjectionRenderedEvent => e.kind === "projection-rendered" && e.seq < x.seq && e.seq > prev).at(-1);
  const shrunk = (proj?.compressions ?? []).filter((c) => c.tool === t.toolName && c.shownChars < c.rawChars).length;
  if (shrunk === 0) return p;
  const same = results.filter((r) => r.toolName === t.toolName).length;
  return shrunk >= same ? "elided" : p === "present" ? "unverifiable" : p;
}

/** A result the harness wrote itself (repetition notices), not tool output. */
export const HARNESS_NOTICE = /^⚠️ You have already called|^\[Code execution failed/;

/** Distinct successful evidence results before `seq` (latest per tool+args; writes and meta excluded). */
export function evidenceBefore(f: Facts, seq: number): readonly ToolCallEvent[] {
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
