import {
  visibleIterations,
  type TraceToolCall,
  type TurnContext,
  type TurnEnding,
  type TurnTrace,
  type TurnTraceState,
} from "./turn-trace.js";

/**
 * Action-first step view of one agent turn: the answer to "what is my agent
 * doing?". Each step is titled by what the agent DID (the tools it called,
 * retries grouped, failures counted), never by its thinking. The model's
 * narration and the provider's reasoning ride along as secondary fields;
 * narration that repeats an earlier step is collapsed to a reference.
 *
 * Pure: build it from a live {@link TurnTraceState} ({@link turnStepsOf}), from a
 * persisted {@link TurnTrace} ({@link persistedTurnStepsOf}), or from your own
 * per-iteration data ({@link buildTurnSteps}).
 */

/** The minimum a tool call needs to be placed in a step. Your own call type may carry more (args, result). */
export interface StepCall {
  readonly id: string;
  readonly name: string;
  readonly status: TraceToolCall["status"];
  /** Iteration the call ran in; calls without one form a trailing step. */
  readonly iteration?: number;
  readonly error?: string;
  readonly durationMs?: number;
}

/** One iteration's text, as produced by the turn-trace fold. */
export interface StepIterationText {
  readonly iteration: number;
  readonly narration?: string;
  readonly thinking?: string;
}

/** All calls of one tool within a step. */
export interface StepAction<C extends StepCall = StepCall> {
  /** Full tool name (e.g. `umami/get_website_metrics`). */
  readonly name: string;
  /** Display name without an MCP server prefix (`get_website_metrics`). */
  readonly shortName: string;
  readonly calls: readonly C[];
  readonly failed: number;
  /** True when a call failed and a later call of the same tool in this step succeeded. */
  readonly recovered: boolean;
  /** `get_website_metrics ×3 · 2 failed → ok`. */
  readonly label: string;
}

/** A failed call, why it failed, and the call that fixed it (if any). */
export interface StepFailure {
  readonly callId: string;
  readonly tool: string;
  /** First line of the error, tool-error wrapping and recovery guidance removed. */
  readonly reason: string;
  /** The later successful call of the same tool, and the step it ran in. */
  readonly fixedBy?: { readonly callId: string; readonly step: number };
}

/** One step of a turn. */
export interface TurnStep<C extends StepCall = StepCall> {
  /** 1-based position in the turn. */
  readonly n: number;
  /** Stable key, from the first iteration in the step (`i3`; `i?` for calls with no iteration). */
  readonly key: string;
  /** Iterations folded into this step (more than one when retries were grouped). */
  readonly iterations: readonly number[];
  /** Action-first title: the tool actions (`list_websites · get_website_stats`), or `No tool call`. */
  readonly label: string;
  readonly actions: readonly StepAction<C>[];
  /** Calls in start order. */
  readonly calls: readonly C[];
  /** The model's narration, unless it repeated an earlier step or this step's thinking. */
  readonly narration?: string;
  /** The provider's reasoning (thinking models). Never used as the label. */
  readonly thinking?: string;
  /** Set when this step's narration repeated step N word for word (the text is then omitted). */
  readonly sameAsStep?: number;
  readonly failures: readonly StepFailure[];
  /** `running` while a call runs; `failed` when a failure was never fixed in the turn; else `done`. */
  readonly status: "running" | "failed" | "done";
  /** Sum of reported call durations, when any reported. */
  readonly durationMs?: number;
}

/** One-line rollup of a turn. */
export interface TurnSummary {
  readonly steps: number;
  readonly toolCalls: number;
  /** Distinct tools called. */
  readonly tools: number;
  readonly failures: number;
  /** Failures a later call fixed. */
  readonly recovered: number;
  /** `running` until the turn ends. */
  readonly outcome: TurnEnding | "running";
  readonly context?: TurnContext;
  /** `6 steps · 11 calls (8 tools) · 3 failed, 3 fixed · failed · context 7.5k / 8.2k`. */
  readonly line: string;
}

const norm = (text: string | undefined): string => (text ?? "").replace(/\s+/g, " ").trim();

/** Display name of a tool: the MCP server prefix (`server/` or `mcp__server__`) removed. */
export const shortToolName = (name: string): string => {
  const slash = name.lastIndexOf("/");
  const tail = slash >= 0 ? name.slice(slash + 1) : name;
  return tail.startsWith("mcp__") ? tail.split("__").slice(2).join("__") || tail : tail;
};

/** First meaningful line of a tool error, without `[Tool error: …]` wrapping or recovery guidance. Capped. */
export function failureReason(error: string | undefined, max = 160): string {
  const raw = (error ?? "").split(/\n\s*\n|\[Recovery guidance/)[0] ?? "";
  const line = raw.replace(/^\s*\[Tool error:\s*/, "").replace(/\]\s*$/, "").split("\n")[0]!.trim();
  const text = line.length > 0 ? line : "failed (no error reported)";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const actionLabel = (shortName: string, count: number, failed: number, recovered: boolean): string =>
  [
    count > 1 ? `${shortName} ×${count}` : shortName,
    failed > 0 ? `${failed} failed${recovered ? " → ok" : ""}` : undefined,
  ]
    .filter((p): p is string => p !== undefined)
    .join(" · ");

interface Group<C extends StepCall> {
  iterations: number[];
  key: string;
  calls: C[];
  narration: string[];
  thinking: string[];
}

const unfixedFailures = <C extends StepCall>(calls: readonly C[]): Set<string> => {
  const open = new Set<string>();
  for (const c of calls) {
    if (c.status === "failed") open.add(c.name);
    else if (c.status === "done") open.delete(c.name);
  }
  return open;
};

/**
 * Build the step view from per-iteration text and tool calls.
 *
 * - One step per iteration, in order; calls with no iteration trail as a last step.
 * - Retries group: a step whose calls are all retries of tools still failing in
 *   the previous step folds into it (`get_website_metrics ×4 · 3 failed → ok`).
 * - Narration equal to this step's thinking, or to an earlier step's narration
 *   or thinking, is dropped; a repeat sets `sameAsStep`.
 * - Narration equal to `answer` is dropped (the answer renders on its own).
 */
export function buildTurnSteps<C extends StepCall>(input: {
  readonly iterations: readonly StepIterationText[];
  readonly calls: readonly C[];
  readonly answer?: string;
}): TurnStep<C>[] {
  const texts = new Map(input.iterations.map((t) => [t.iteration, t]));
  const byIteration = new Map<number | undefined, C[]>();
  for (const c of input.calls) byIteration.set(c.iteration, [...(byIteration.get(c.iteration) ?? []), c]);
  const ordered = [...new Set([...texts.keys(), ...[...byIteration.keys()].filter((k): k is number => k !== undefined)])].sort(
    (a, b) => a - b,
  );
  const answer = norm(input.answer);

  const groups: Group<C>[] = [];
  const push = (iteration: number | undefined): void => {
    const calls = byIteration.get(iteration) ?? [];
    const text = iteration === undefined ? undefined : texts.get(iteration);
    const prev = groups[groups.length - 1];
    const retrying = prev ? unfixedFailures(prev.calls) : new Set<string>();
    const isRetry = prev !== undefined && calls.length > 0 && calls.every((c) => retrying.has(c.name));
    const g: Group<C> = isRetry
      ? prev
      : { iterations: [], key: iteration === undefined ? "i?" : `i${iteration}`, calls: [], narration: [], thinking: [] };
    if (iteration !== undefined) g.iterations.push(iteration);
    g.calls.push(...calls);
    if (text?.narration?.trim()) g.narration.push(text.narration.trim());
    if (text?.thinking?.trim()) g.thinking.push(text.thinking.trim());
    if (!isRetry) groups.push(g);
  };
  for (const iteration of ordered) push(iteration);
  if (byIteration.has(undefined)) push(undefined);

  // Steps where each call ran, for failure → fix links.
  const stepOfCall = new Map<string, number>();
  groups.forEach((g, i) => g.calls.forEach((c) => stepOfCall.set(c.id, i + 1)));
  const allCalls = groups.flatMap((g) => g.calls);

  const seenText = new Map<string, number>();
  return groups.map((g, i): TurnStep<C> => {
    const n = i + 1;
    const thinking = g.thinking.join("\n\n") || undefined;
    let narration = g.narration.join("\n\n") || undefined;
    let sameAsStep: number | undefined;
    const nNarr = norm(narration);
    const nThink = norm(thinking);
    if (narration !== undefined) {
      if (nNarr === nThink || (answer.length > 0 && nNarr === answer)) narration = undefined;
      else if (seenText.has(nNarr)) {
        sameAsStep = seenText.get(nNarr);
        narration = undefined;
      }
    }
    if (nNarr.length > 0 && !seenText.has(nNarr)) seenText.set(nNarr, n);
    if (nThink.length > 0 && !seenText.has(nThink)) seenText.set(nThink, n);

    const callsByTool = new Map<string, C[]>();
    for (const c of g.calls) callsByTool.set(c.name, [...(callsByTool.get(c.name) ?? []), c]);
    const finishedActions = [...callsByTool].map(([name, calls]): StepAction<C> => {
      const shortName = shortToolName(name);
      const failed = calls.filter((c) => c.status === "failed").length;
      const recovered = failed > 0 && unfixedFailures(calls).size === 0 && calls.some((c) => c.status === "done");
      return { name, shortName, calls, failed, recovered, label: actionLabel(shortName, calls.length, failed, recovered) };
    });

    const failures = g.calls
      .filter((c) => c.status === "failed")
      .map((c): StepFailure => {
        const after = allCalls.slice(allCalls.indexOf(c) + 1);
        const fix = after.find((x) => x.name === c.name && x.status === "done");
        return {
          callId: c.id,
          tool: c.name,
          reason: failureReason(c.error),
          ...(fix ? { fixedBy: { callId: fix.id, step: stepOfCall.get(fix.id) ?? n } } : {}),
        };
      });
    const durations = g.calls.map((c) => c.durationMs).filter((d): d is number => typeof d === "number");
    return {
      n,
      key: g.key,
      iterations: g.iterations,
      label: finishedActions.length > 0 ? finishedActions.map((a) => a.label).join(", ") : "No tool call",
      actions: finishedActions,
      calls: g.calls,
      ...(narration !== undefined ? { narration } : {}),
      ...(thinking !== undefined ? { thinking } : {}),
      ...(sameAsStep !== undefined ? { sameAsStep } : {}),
      failures,
      status: g.calls.some((c) => c.status === "running")
        ? "running"
        : failures.some((f) => f.fixedBy === undefined)
          ? "failed"
          : "done",
      ...(durations.length > 0 ? { durationMs: durations.reduce((a, b) => a + b, 0) } : {}),
    };
  });
}

/** Steps of a live (or just finished) turn, straight from the fold. */
export function turnStepsOf(s: TurnTraceState): TurnStep<TraceToolCall>[] {
  return buildTurnSteps({ iterations: visibleIterations(s), calls: s.calls, ...(s.answer ? { answer: s.answer } : {}) });
}

/**
 * Steps of a persisted turn. Traces written before narration and thinking were
 * split carry only `thought`; it is read as narration.
 */
export function persistedTurnStepsOf(t: TurnTrace, answer?: string): TurnStep<TraceToolCall>[] {
  const iterations = t.reasoningSteps.map((r): StepIterationText => {
    const split = r.narration !== undefined || r.thinking !== undefined;
    return {
      iteration: r.iteration,
      ...(split ? (r.narration ? { narration: r.narration } : {}) : { narration: r.thought }),
      ...(r.thinking ? { thinking: r.thinking } : {}),
    };
  });
  return buildTurnSteps({ iterations, calls: t.toolCalls, ...(answer ? { answer } : {}) });
}

const kTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : `${n}`);

/** Roll a turn's steps up into counts and one display line. */
export function summarizeTurn(
  steps: readonly TurnStep[],
  opts: { readonly ended?: TurnEnding | undefined; readonly context?: TurnContext | undefined } = {},
): TurnSummary {
  const calls = steps.flatMap((s) => s.calls);
  const failures = steps.flatMap((s) => s.failures);
  const recovered = failures.filter((f) => f.fixedBy !== undefined).length;
  const tools = new Set(calls.map((c) => c.name)).size;
  const outcome = opts.ended ?? "running";
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const parts = [
    plural(steps.length, "step"),
    calls.length > 0 ? `${plural(calls.length, "call")} (${plural(tools, "tool")})` : undefined,
    failures.length > 0 ? `${failures.length} failed${recovered > 0 ? `, ${recovered} fixed` : ""}` : undefined,
    outcome,
    opts.context ? `context ${kTokens(opts.context.peakTokens)} / ${kTokens(opts.context.windowTokens)}` : undefined,
  ].filter((p): p is string => p !== undefined);
  return {
    steps: steps.length,
    toolCalls: calls.length,
    tools,
    failures: failures.length,
    recovered,
    outcome,
    ...(opts.context ? { context: opts.context } : {}),
    line: parts.join(" · "),
  };
}
