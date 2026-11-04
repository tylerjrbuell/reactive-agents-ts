// packages/trace/src/attribution-facts.ts
//
// The facts layer of `attribution.ts`: what a trace records about a run
// (completion, grade, contract, known deliverables, tool calls, exchanges), the
// failing targets, the divergence turn that produced each target, and whether a
// tool result was present in a turn's projected request. Pure reads of trace
// events; the rules that turn these facts into a verdict live in attribution.ts.

import type { Trace } from "./replay.js";
import type { CauseEvidence } from "./cause.js";
import type { AttributionTarget } from "./attribution.js";
import type {
  TraceEvent,
  RunCompletedEvent,
  RunAbortedEvent,
  EvalGradedEvent,
  LLMExchangeEvent,
  ToolCallEvent,
  ContractCompiledEvent,
  AssessmentEvent,
  GuardFiredEvent,
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
      const written = [...new Set(f.toolEnds.filter((t) => t.ok !== false).map((t) => argPath(t.args)).filter((p): p is string => p !== undefined && isWrite(f, p)).map(baseName))];
      if (written.length > 0) return written.map((ref) => ({ kind: "file", ref, source: "run-writes" }));
    }
  }
  return [{ kind: "answer", ref: "answer", source: "final-output" }];
}

/** True when a successful call on `path` came from a writer tool. */
export function isWrite(f: Facts, path: string): boolean {
  return f.toolEnds.some((t) => argPath(t.args) === path && t.ok !== false && isWriter(t.toolName));
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

export interface RequestView {
  readonly text: string;
  /** The recorder clipped at least one message (or the system prompt). */
  readonly clipped: boolean;
}
export function requestView(x: LLMExchangeEvent): RequestView {
  const parts = [x.systemPrompt ?? "", ...x.messages.map((m) => m.content)];
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

