/**
 * The safety lane of a run: every time a guardrail, a verifier, a budget, the
 * context window, calibration or the reactive controller stepped in, as one
 * plain-language entry linked to the loop it happened in. Pure; reads the
 * framework events a run already publishes (`AgentEvent` `_tag` + payload).
 *
 * Loop rule: an event that carries the kernel's `iteration` (interventions,
 * kernel verdicts, budget signals) is in that loop (`iteration` 0, the kernel
 * before its first loop closed, is loop 1). An event without one belongs to
 * the loop in progress when it fired: loop N closes with
 * `ReasoningIterationProgress { iteration: N }`, so an event after that close
 * is in loop N + 1. An event before the run's first model call is `before`
 * (input guardrails); the runtime's result check, the answer screen, and,
 * once the run ended, any entry past the last closed loop are `end`.
 */

/** Which mechanism stepped in. */
export type SafetyKind = "intervention" | "guardrail" | "verifier" | "budget" | "context" | "calibration";

/**
 * How an entry reads: `bad` = something was blocked or rejected, `warn` = a
 * limit or check fired, `info` = the controller adapted the run, `ok` = a
 * check ran and passed (listed, never counted).
 */
export type SafetyTone = "bad" | "warn" | "info" | "ok";

/** When in the run the entry happened. */
export type SafetyPhase = "before" | "loop" | "end";

/** One safety entry. */
export interface SafetyEntry {
  /** Stable within a run: the event's position. */
  readonly id: string;
  readonly kind: SafetyKind;
  readonly tone: SafetyTone;
  /** One plain sentence: what happened. */
  readonly title: string;
  /** Optional second line: why, or the numbers. */
  readonly detail?: string;
  readonly phase: SafetyPhase;
  /** 1-based loop when `phase` is `loop`. */
  readonly loop?: number;
  /** The event's `_tag`. */
  readonly source: string;
  readonly ts: number;
}

/** An event as Cortex and the bindings carry it. */
export interface SafetyEventLike {
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly ts: number;
}

/** Per-loop marker for a trace row. */
export interface SafetyLoopMark {
  readonly count: number;
  readonly tone: Exclude<SafetyTone, "ok">;
}

/** The lane's totals. */
export interface SafetySummary {
  /** Entries that fired (every tone but `ok`). */
  readonly count: number;
  /** Worst tone among them; `undefined` when `count` is 0. */
  readonly tone?: Exclude<SafetyTone, "ok">;
  /** Marks for trace rows, by 1-based loop. */
  readonly byLoop: ReadonlyMap<number, SafetyLoopMark>;
}

/** Event tags the lane reads. */
export const SAFETY_EVENT_TAGS: readonly string[] = [
  "InterventionDispatched",
  "GuardrailViolationDetected",
  "GuardrailReviewFlagged",
  "GuardrailOutputFlagged",
  "VerifierVerdictEmitted",
  "BudgetExhausted",
  "BudgetSignalCollectedEmitted",
  "ContextWindowWarning",
  "CalibrationDrift",
  // Only when `terminationReason` is `budget_exceeded`.
  "AgentCompleted",
];

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const pct = (v: number): string => `${Math.round(v * 100)}%`;
/** `pii_exposure` / `early-stop` → `pii exposure` / `early stop`. */
const words = (s: string): string => s.replace(/[_-]+/g, " ").trim();

const DECISION_WORDS: Record<string, string> = {
  "early-stop": "stopped the run early",
  "switch-strategy": "switched the reasoning strategy",
  "tool-failure-redirect": "redirected the agent away from a failing tool",
  compress: "compressed the context",
  branch: "branched the reasoning",
};

type Body = Omit<SafetyEntry, "id" | "phase" | "loop" | "source" | "ts">;

function interventionOf(p: Record<string, unknown>): Body {
  const decision = str(p.decisionType) ?? "intervention";
  const what = DECISION_WORDS[decision] ?? `applied ${words(decision)}`;
  const tokens = num((p.cost as { tokensEstimated?: unknown } | undefined)?.tokensEstimated);
  const patch = str(p.patchKind);
  const parts = [patch ? `Change: ${words(patch)}` : undefined, tokens && tokens > 0 ? `about ${tokens.toLocaleString("en-US")} tokens` : undefined];
  const detail = parts.filter((x): x is string => x !== undefined).join(" · ");
  return { kind: "intervention", tone: "info", title: `The controller ${what}`, ...(detail ? { detail } : {}) };
}

function violationOf(p: Record<string, unknown>): Body {
  // Detectors report `<id>: <message>` (`pii-detected: PII detected: Phone number`): show the message.
  const list = Array.isArray(p.violations)
    ? p.violations.filter((v): v is string => typeof v === "string").map((v) => {
        const i = v.indexOf(": ");
        return i > 0 && i < v.length - 2 ? v.slice(i + 2) : words(v);
      })
    : [];
  const score = num(p.score);
  const blocked = p.blocked === true;
  const what = list.length > 0 ? list.join(", ") : "a policy violation";
  return {
    kind: "guardrail",
    tone: blocked ? "bad" : "warn",
    title: blocked ? `A guardrail blocked the run: ${what}` : `A guardrail detected ${what}`,
    ...(score !== undefined ? { detail: `Score ${score.toFixed(2)}` } : {}),
  };
}

function reviewOf(p: Record<string, unknown>): Body {
  const side = p.side === "output" ? "the answer" : "the input";
  const dim = str(p.dimension);
  const prob = num(p.probability);
  const sev = str(p.severity);
  return {
    kind: "guardrail",
    tone: "warn",
    title: `A guardrail flagged ${side} for review${dim ? `: ${words(dim)}` : ""}`,
    ...(prob !== undefined || sev ? { detail: [prob !== undefined ? `likelihood ${pct(prob)}` : "", sev ? `${sev} severity` : ""].filter(Boolean).join(" · ") } : {}),
  };
}

const OUTPUT_DIMS: readonly [string, string][] = [
  ["injection", "injection"],
  ["piiExposure", "personal data"],
  ["toxicity", "toxicity"],
  ["jailbreakRoleplay", "jailbreak role-play"],
];

function outputFlagOf(p: Record<string, unknown>): Body {
  const scored = OUTPUT_DIMS.map(([k, label]) => ({ label, v: num(p[k]) })).filter((d): d is { label: string; v: number } => d.v !== undefined);
  const top = scored.reduce<{ label: string; v: number } | undefined>((a, d) => (a === undefined || d.v > a.v ? d : a), undefined);
  const sev = str(p.severity);
  return {
    kind: "guardrail",
    tone: sev === "high" || sev === "critical" ? "bad" : "warn",
    title: `The answer screen flagged ${top ? top.label : "the output"}${sev ? ` (${sev})` : ""}`,
    ...(top ? { detail: scored.map((d) => `${d.label} ${pct(d.v)}`).join(" · ") } : {}),
  };
}

function verdictOf(p: Record<string, unknown>): Body {
  const verified = p.verified === true;
  const summary = str(p.summary);
  const checks = Array.isArray(p.checks) ? (p.checks as { name?: unknown; passed?: unknown; reason?: unknown }[]) : [];
  const failed = checks.filter((c) => c.passed === false).map((c) => {
    const n = str(c.name);
    const r = str(c.reason);
    return n ? (r ? `${words(n)}: ${r}` : words(n)) : r;
  }).filter((x): x is string => x !== undefined);
  const who = p.source === "runtime" ? "The result check" : "The verifier";
  return verified
    ? { kind: "verifier", tone: "ok", title: `${who} passed the answer`, ...(summary ? { detail: summary } : {}) }
    : {
        kind: "verifier",
        tone: p.terminal === true ? "bad" : "warn",
        title: `${who} rejected the answer`,
        ...(failed.length > 0 || summary ? { detail: failed.length > 0 ? failed.join(" · ") : (summary as string) } : {}),
      };
}

function exhaustedOf(p: Record<string, unknown>): Body {
  const type = str(p.budgetType);
  const used = num(p.used);
  const limit = num(p.limit);
  return {
    kind: "budget",
    tone: "bad",
    title: `The ${type ? words(type) : ""} budget ran out`.replace(/\s+/g, " "),
    ...(used !== undefined && limit !== undefined ? { detail: `Used ${used.toLocaleString("en-US")} of ${limit.toLocaleString("en-US")}` } : {}),
  };
}

function budgetSignalOf(p: Record<string, unknown>): Body | undefined {
  const status = p.status;
  if (status !== "warning" && status !== "exceeded") return undefined;
  const tokens = num(p.tokensUsed);
  const tokenLimit = num(p.tokenLimit);
  const cost = num(p.costUsd);
  const costLimit = num(p.costLimit);
  const parts = [
    tokens !== undefined && tokenLimit !== undefined ? `${tokens.toLocaleString("en-US")} of ${tokenLimit.toLocaleString("en-US")} tokens` : undefined,
    cost !== undefined && costLimit !== undefined ? `$${cost.toFixed(4)} of $${costLimit.toFixed(4)}` : undefined,
    str(p.reason),
  ].filter((x): x is string => x !== undefined);
  return {
    kind: "budget",
    tone: status === "exceeded" ? "bad" : "warn",
    title: status === "exceeded" ? "The run went over its budget" : "The run is close to its budget",
    ...(parts.length > 0 ? { detail: parts.join(" · ") } : {}),
  };
}

/**
 * A run the budget ended (`AgentCompleted.terminationReason: "budget_exceeded"`).
 * The kernel's budget stop publishes no budget event of its own today, so the
 * ending is the only record of it.
 */
function budgetEndingOf(p: Record<string, unknown>): Body | undefined {
  if (p.terminationReason !== "budget_exceeded") return undefined;
  const why = str(p.error)?.replace(/^budget_exceeded:\s*/, "");
  return { kind: "budget", tone: "bad", title: "The budget stopped the run", ...(why ? { detail: why } : {}) };
}

function contextOf(p: Record<string, unknown>): Body {
  const util = num(p.utilizationPct);
  const atRisk = Array.isArray(p.atRiskSections) ? p.atRiskSections.filter((s): s is string => typeof s === "string").map(words) : [];
  // `utilizationPct` is a percentage; tolerate a 0-1 fraction from older emitters.
  const shown = util === undefined ? undefined : util <= 1 ? Math.round(util * 100) : Math.round(util);
  return {
    kind: "context",
    tone: "warn",
    title: shown !== undefined ? `The context window is ${shown}% full` : "The context window is nearly full",
    ...(atRisk.length > 0 ? { detail: `At risk: ${atRisk.join(", ")}` } : {}),
  };
}

/** Below this many standard deviations a drift event measured no drift. */
const MIN_DRIFT_SIGMA = 0.05;

function driftOf(p: Record<string, unknown>): Body | undefined {
  const sigma = num(p.deviationSigma);
  // The framework can publish a drift whose own numbers show none (0σ, expected =
  // observed: reactive-observer.ts / calibration-update-subscriber.ts, 2026-11-11);
  // a warning that contradicts its measurement is not shown.
  if (sigma !== undefined && Math.abs(sigma) < MIN_DRIFT_SIGMA) return undefined;
  const model = str(p.modelId);
  const exp = num(p.expectedMean);
  const obs = num(p.observedMean);
  return {
    kind: "calibration",
    tone: "warn",
    title: `${model ?? "The model"} is behaving unlike its calibration${sigma !== undefined ? ` (${sigma.toFixed(1)}σ off)` : ""}`,
    ...(exp !== undefined && obs !== undefined ? { detail: `Expected entropy ${exp.toFixed(2)}, observed ${obs.toFixed(2)}` } : {}),
  };
}

/** The entry body for one event, or `undefined` when the event is not a safety event (or did not fire). */
export function safetyBodyOf(type: string, p: Record<string, unknown>): Body | undefined {
  switch (type) {
    case "InterventionDispatched":
      return interventionOf(p);
    case "GuardrailViolationDetected":
      return violationOf(p);
    case "GuardrailReviewFlagged":
      return reviewOf(p);
    case "GuardrailOutputFlagged":
      return outputFlagOf(p);
    case "VerifierVerdictEmitted":
      return verdictOf(p);
    case "BudgetExhausted":
      return exhaustedOf(p);
    case "BudgetSignalCollectedEmitted":
      return budgetSignalOf(p);
    case "ContextWindowWarning":
      return contextOf(p);
    case "CalibrationDrift":
      return driftOf(p);
    case "AgentCompleted":
      return budgetEndingOf(p);
    default:
      return undefined;
  }
}

/** Events that mark the first loop as begun (a model call). */
const LOOP_BEGUN = new Set(["LLMRequestStarted", "LLMRequestCompleted", "ReasoningStepCompleted"]);
/** Events that end a run. */
const RUN_ENDED = new Set(["AgentCompleted", "TaskFailed", "AgentAborted", "AgentStopped", "AgentTerminated", "ExecutionCancelled"]);

/**
 * The run's safety entries, in event order, each placed in its loop by the
 * rule in this module's header.
 */
export function safetyEntriesOf(events: readonly SafetyEventLike[]): readonly SafetyEntry[] {
  let closed = 0; // highest loop closed so far
  let begun = false;
  let ended = false;
  const raw: { body: Body; index: number; source: string; ts: number; loop: number; begun: boolean; atEnd: boolean }[] = [];
  events.forEach((e, index) => {
    if (e.type === "ReasoningIterationProgress") {
      const it = num(e.payload.iteration);
      closed = it !== undefined && it > closed ? it : closed;
      begun = true;
      return;
    }
    if (RUN_ENDED.has(e.type)) ended = true;
    if (LOOP_BEGUN.has(e.type)) begun = true;
    let body = safetyBodyOf(e.type, e.payload);
    // A budget ending repeats a budget event that already said the run went over.
    if (body && e.type === "AgentCompleted" && raw.some((r) => r.body.kind === "budget" && r.body.tone === "bad")) body = undefined;
    // The runtime's result check and the answer screen run on the finished answer.
    const atEnd = (e.type === "VerifierVerdictEmitted" && e.payload.source === "runtime") || e.type === "GuardrailOutputFlagged" || e.type === "AgentCompleted";
    const own = num(e.payload.iteration);
    if (body) raw.push({ body, index, source: e.type, ts: e.ts, loop: own !== undefined ? Math.max(1, Math.floor(own)) : closed + 1, begun: begun || own !== undefined, atEnd });
  });
  const lastLoop = closed;
  return raw.map(({ body, index, source, ts, loop, begun: b, atEnd }): SafetyEntry => {
    // While the run is live, an entry past the last closed loop is in the loop
    // now running; once it ended, no further loop closed, so it came after.
    const placed: Pick<SafetyEntry, "phase" | "loop"> =
      atEnd && lastLoop > 0
        ? { phase: "end" }
        : !b
          ? { phase: "before" }
          : ended && loop > lastLoop && lastLoop > 0
            ? { phase: "end" }
            : { phase: "loop", loop };
    return { id: `safety-${index}`, ...body, ...placed, source, ts };
  });
}

const TONE_ORDER: readonly Exclude<SafetyTone, "ok">[] = ["info", "warn", "bad"];
const worse = (a: Exclude<SafetyTone, "ok"> | undefined, b: Exclude<SafetyTone, "ok">): Exclude<SafetyTone, "ok"> =>
  a === undefined || TONE_ORDER.indexOf(b) > TONE_ORDER.indexOf(a) ? b : a;

/** Totals for a header count and trace-row marks; `ok` entries are listed but never counted. */
export function safetySummaryOf(entries: readonly SafetyEntry[]): SafetySummary {
  let count = 0;
  let tone: Exclude<SafetyTone, "ok"> | undefined;
  const byLoop = new Map<number, SafetyLoopMark>();
  for (const e of entries) {
    if (e.tone === "ok") continue;
    count += 1;
    tone = worse(tone, e.tone);
    if (e.loop !== undefined) {
      const prev = byLoop.get(e.loop);
      byLoop.set(e.loop, { count: (prev?.count ?? 0) + 1, tone: worse(prev?.tone, e.tone) });
    }
  }
  return { count, ...(tone !== undefined ? { tone } : {}), byLoop };
}

/** Where an entry happened, in words: `Loop 3`, `Before the first loop`, `After the last loop`. */
export function safetyPlaceLabel(entry: Pick<SafetyEntry, "phase" | "loop">): string {
  if (entry.phase === "before") return "Before the first loop";
  if (entry.phase === "end") return "After the last loop";
  return `Loop ${entry.loop ?? 1}`;
}
