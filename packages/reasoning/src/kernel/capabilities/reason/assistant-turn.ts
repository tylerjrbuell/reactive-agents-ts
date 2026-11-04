/**
 * Think phase — THE assistant-turn boundary (canonical tool-call extraction
 * P1, D2 + D3: wiki/Architecture/Design-Specs/2026-11-03-canonical-tool-call-extraction.md).
 *
 * `resolveAssistantTurn` runs ONCE per turn, in normalize-think-response,
 * BEFORE the thought step is created — so the step is born annotated with
 * `metadata.assistantTurn`. Streaming and complete responses both converge on
 * `accumulatedContent` / `accumulatedToolCalls` before normalize, so this one
 * call site covers both. Native calls win; text is parsed only when zero
 * native calls resolve (the resolver's own semantics — P1 reuses the existing
 * NativeFCStrategy extraction unchanged as the parser behind this boundary).
 *
 * `deliverableTextOf(step)` is the ONE deliverable view of a thought: the raw
 * content minus the spans consumed as tool calls. Every site that would ship
 * a thought as user output (assembleOutput, the fallback chooser,
 * lastDeliverableThought, deliverable evidence containment, loop-resolution)
 * reads it — a printed call that was already executed is never delivered.
 */
import { Effect } from "effect";
import type { ResolverInput, ToolCallResolver, ToolCallResult } from "@reactive-agents/tools";
import type { ReasoningStep, StepMetadata } from "../../../types/index.js";
import type { ToolSchema } from "../attend/tool-formatting.js";
import { emitGuardFired } from "../../utils/diagnostics.js";

/** The typed annotation stamped on a thought step (`metadata.assistantTurn`). */
export type AssistantTurnMeta = NonNullable<StepMetadata["assistantTurn"]>;
/** A half-open `[start, end)` span of the step content consumed as a tool call. */
export type AssistantTurnSpan = AssistantTurnMeta["consumedSpans"][number];

/** The resolver's verdict for this turn (consumed by the dispatch stage). */
export interface AssistantTurnResolution {
  readonly result: ToolCallResult;
  readonly dialect: string;
}

/** One resolved assistant turn. `resolution` is present iff a resolver is wired. */
export interface AssistantTurn {
  readonly meta: AssistantTurnMeta;
  readonly resolution?: AssistantTurnResolution;
}

/** Inputs of the boundary — the converged stream record plus this turn's surface. */
export interface ResolveAssistantTurnParams {
  /** The run's ToolCallResolver (absent ⇒ native calls pass through as-is). */
  readonly resolver?: ToolCallResolver;
  /** Provider native tool calls (names already de-sanitized). */
  readonly nativeCalls: readonly { readonly id: string; readonly name: string; readonly input: string }[];
  /** Raw assistant content — what the resolver parses. */
  readonly content: string;
  readonly stopReason: string;
  /** This turn's tool universe (the names the resolver may resolve against). */
  readonly surface: readonly ToolSchema[];
  /** The stored thought text — consumed spans index into THIS string. */
  readonly thought: string;
}

/** Parse the native tool-call inputs (moved verbatim from the dispatch stage). */
const parseNativeCalls = (calls: ResolveAssistantTurnParams["nativeCalls"]) =>
  calls.map((tc) => {
    let parsedInput: unknown = {};
    try {
      parsedInput = tc.input ? JSON.parse(tc.input) : {};
    } catch {
      parsedInput = {};
    }
    return { id: tc.id, name: tc.name, input: parsedInput };
  });

const normName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Fenced code blocks and tool-call markup blocks — the units a text call is printed in. */
const CALL_BLOCK_RE =
  /```[^\n`]*\n?[\s\S]*?```|<\|?tool_call\|?>[\s\S]*?<\|?\/?tool_call\|?>|<tool_use>[\s\S]*?<\/tool_use>/g;

const parsesAsJsonObject = (text: string): boolean => {
  const body = text.replace(/^```[^\n]*\n?/, "").replace(/```$/, "").trim();
  try {
    const v: unknown = JSON.parse(body);
    return typeof v === "object" && v !== null;
  } catch {
    return false;
  }
};

/**
 * Spans of `thought` that printed the text-extracted calls. A block is consumed
 * only when it names one of THIS turn's extracted calls (or, for a nameless
 * shape-matched call, is a JSON object) — an unrelated code block in the same
 * reply is never consumed (D7d). Fallbacks when no block matched: a reply that
 * is wholly one JSON value, else the lines that print `name(` / `name {`.
 */
export function consumedSpansOf(
  thought: string,
  calls: readonly { readonly id: string; readonly name: string }[],
): AssistantTurnSpan[] {
  const names = calls.map((c) => normName(c.name)).filter((n) => n.length > 0);
  const shapeCall = calls.some((c) => c.id.startsWith("shape_"));
  const spans: AssistantTurnSpan[] = [];
  for (const m of thought.matchAll(CALL_BLOCK_RE)) {
    const block = m[0];
    const start = m.index ?? 0;
    const n = normName(block);
    if (names.some((nm) => n.includes(nm)) || (shapeCall && parsesAsJsonObject(block))) {
      spans.push({ start, end: start + block.length });
    }
  }
  if (spans.length > 0) return spans;
  const trimmed = thought.trim();
  if ((trimmed.startsWith("{") || trimmed.startsWith("[")) && parsesAsJsonObject(trimmed)) {
    const start = thought.indexOf(trimmed);
    return [{ start, end: start + trimmed.length }];
  }
  const callLine = calls.map((c) => escapeRe(c.name).replace(/\\?[-_]/g, "[-_ ]?")).join("|");
  if (callLine.length === 0) return spans;
  const lineRe = new RegExp(`^.*\\b(?:${callLine})\\s*[({].*$`, "gim");
  for (const m of thought.matchAll(lineRe)) {
    const start = m.index ?? 0;
    spans.push({ start, end: start + m[0].length });
  }
  return spans;
}

/** `text` with `spans` removed (merged, order-independent), blank runs collapsed. */
export function stripSpans(text: string, spans: readonly AssistantTurnSpan[]): string {
  if (spans.length === 0) return text;
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const s of sorted) {
    if (s.start > cursor) out += text.slice(cursor, s.start);
    cursor = Math.max(cursor, s.end);
  }
  out += text.slice(cursor);
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

const callsMeta = (
  thought: string,
  source: "native" | "text",
  dialect: string,
  callIds: readonly string[],
  spans: readonly AssistantTurnSpan[],
): AssistantTurnMeta => {
  const deliverableText = stripSpans(thought, spans);
  return {
    disposition: deliverableText.trim().length === 0 ? "calls" : "mixed",
    consumedSpans: spans,
    callIds,
    deliverableText,
    source,
    dialect,
  };
};

const proseMeta = (thought: string, dialect: string): AssistantTurnMeta => ({
  disposition: "prose",
  consumedSpans: [],
  callIds: [],
  deliverableText: thought,
  source: "none",
  dialect,
});

/** Classify the resolver verdict into the step annotation (pure). */
export function describeResolution(
  resolution: AssistantTurnResolution,
  params: Pick<ResolveAssistantTurnParams, "nativeCalls" | "thought">,
): AssistantTurnMeta {
  const { result, dialect } = resolution;
  const { thought, nativeCalls } = params;
  if (result._tag === "tool_calls") {
    const ids = result.calls.map((c) => c.id);
    return dialect === "native-fc" || (dialect === "none" && nativeCalls.length > 0)
      ? callsMeta(thought, "native", dialect, ids, [])
      : callsMeta(thought, "text", dialect, ids, consumedSpansOf(thought, result.calls));
  }
  if (result._tag === "abstained") {
    return callsMeta(thought, "native", dialect, nativeCalls.map((c) => c.id), []);
  }
  if (result._tag === "thinking" && result.reason === "unresolved-tool-call") {
    return {
      disposition: "unresolved",
      consumedSpans: [],
      callIds: [],
      deliverableText: "",
      source: nativeCalls.length > 0 ? "native" : "text",
      dialect,
    };
  }
  return proseMeta(thought, dialect);
}

/**
 * THE per-turn boundary. Runs the wired resolver exactly once (pure —
 * `Effect.succeed` in NativeFCStrategy) and annotates the turn; with no
 * resolver, native calls pass through and the turn is `calls`/`mixed`.
 */
export function resolveAssistantTurn(params: ResolveAssistantTurnParams): Effect.Effect<AssistantTurn> {
  return Effect.gen(function* () {
    const { resolver, nativeCalls, thought } = params;
    if (resolver === undefined) {
      return {
        meta: nativeCalls.length > 0
          ? callsMeta(thought, "native", "none", nativeCalls.map((c) => c.id), [])
          : proseMeta(thought, "none"),
      };
    }
    const parsedToolCalls = parseNativeCalls(nativeCalls);
    const resolverInput: ResolverInput = {
      content: params.content || undefined,
      toolCalls: parsedToolCalls.length > 0 ? parsedToolCalls : undefined,
      stopReason: params.stopReason,
    };
    const hints = params.surface.map((ts) => ({
      name: ts.name,
      paramNames: ts.parameters?.map((p) => p.name) ?? [],
    }));
    // resolveWithDialect captures which tier fired (native-fc / fenced-json / pseudo-code / ...).
    const resolution: AssistantTurnResolution = resolver.resolveWithDialect
      ? yield* resolver.resolveWithDialect(resolverInput, hints)
      : { result: yield* resolver.resolve(resolverInput, hints), dialect: "none" };
    return { meta: describeResolution(resolution, params), resolution };
  });
}

/** Tier label from the extracted call ids (`pseudo_…`, `marker_…`, `dialectjson_…`, `shape_…`, `text-tc-…`). */
const tierOf = (meta: AssistantTurnMeta): string =>
  meta.source === "native"
    ? "native"
    : [...new Set(meta.callIds.map((id) => id.split(/[_-]/)[0] ?? id))].join(",") || "none";

/**
 * D5 trace — one `guard-fired` event per non-prose turn, through the existing
 * kernel event path (packages/trace types it later):
 * `guard:"tool_call_extracted"`, `metadata:{source, dialect, tier, disposition, callCount}`.
 */
export const emitAssistantTurn = (taskId: string, iteration: number, meta: AssistantTurnMeta) =>
  meta.disposition === "prose"
    ? Effect.void
    : emitGuardFired({
        taskId,
        iteration,
        guard: "tool_call_extracted",
        outcome: meta.disposition === "unresolved" ? "warn" : "pass",
        reason: meta.disposition,
        metadata: {
          source: meta.source,
          dialect: meta.dialect,
          tier: tierOf(meta),
          disposition: meta.disposition,
          callCount: meta.callIds.length,
        },
      });

/**
 * THE deliverable view of a step: the raw content minus the spans consumed as
 * tool calls. Steps without an annotation (non-kernel producers, hand-built
 * steps) deliver their raw content.
 */
export const deliverableTextOf = (step: ReasoningStep): string =>
  step.metadata?.assistantTurn?.deliverableText ?? step.content;

/**
 * True when the step's turn left NO deliverable text: every printed byte was a
 * consumed call (or the turn was unresolved). Such a thought is never a
 * delivery candidate.
 */
export const hasNoDeliverableText = (step: ReasoningStep): boolean => {
  const turn = step.metadata?.assistantTurn;
  return turn !== undefined && turn.disposition !== "prose" && turn.deliverableText.trim().length === 0;
};
