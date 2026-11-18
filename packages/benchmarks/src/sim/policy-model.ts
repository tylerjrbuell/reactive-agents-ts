/**
 * Phase Z: purpose-routed, request-recording, reactive scripted LLM layer.
 *
 * A {@link PolicyModel} reads the REQUEST (system prompt, history, tools on the
 * wire, `toolChoice`) and returns the next turn, so a scripted model can react
 * to a mechanism the way a real one does: no tools on the wire, a guidance line
 * in the system prompt, a forced `toolChoice`. Harness-internal calls
 * (classify / extract / plan / verify ...) never reach the policy, so they cannot
 * consume the agent script (the classifier-peek defect of `TestLLMService`).
 *
 * Token counts are derived from the request (system prompt + full history + tool
 * schemas, chars / 4) and replace `TestLLMService`'s `fakeUsage`, which counts
 * only the last turn. Zero tokens, no live model, no filesystem writes.
 */
import { Effect, Layer, Stream } from "effect";
import {
  LLMService,
  TestLLMService,
  messageContentToString,
  type CompletionRequest,
  type CompletionResponse,
  type StreamEvent,
  type TestTurn,
} from "@reactive-agents/llm-provider";

/** A seeded uniform [0, 1) generator. */
export type Rng = () => number;

/** Deterministic PRNG (mulberry32). Same seed, same stream. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What a policy can see besides the request itself. */
export interface PolicyContext {
  /** Seeded stream. Draw a fixed count per turn so paired arms share random numbers. */
  readonly rng: Rng;
  /** Probability the model follows a harness steering signal (see `compliance.ts`). Default 1. */
  readonly compliance: number;
  /** Per-run counters a policy may keep (one object per layer, so arms never share state). */
  readonly scratch: Record<string, number>;
  /** 0-based index among agent (think / unpurposed) calls. */
  readonly agentTurn: number;
  /** Every request so far, this one last. */
  readonly history: readonly CompletionRequest[];
}

/** Maps a request to the next model turn. Reactive: reads the request, not a cursor. */
export type PolicyModel = (req: CompletionRequest, ctx: PolicyContext) => TestTurn;

/** One recorded model call. */
export interface RecordedCall {
  readonly purpose: CompletionRequest["purpose"];
  readonly channel: "agent" | "harness";
  readonly req: CompletionRequest;
  /** Request-derived input tokens (see {@link requestTokens}). */
  readonly inputTokens: number;
  /** The turn the model (or the harness script) answered with. */
  readonly turn: TestTurn;
}

/** Token estimate from the recorded request: system + all messages + tool schemas (chars / 4). */
export function requestTokens(req: CompletionRequest): number {
  const sys = req.systemPrompt?.length ?? 0;
  const msgs = req.messages.reduce((n, m) => n + messageContentToString(m.content).length, 0);
  const tools = req.tools === undefined ? 0 : JSON.stringify(req.tools).length;
  return Math.ceil((sys + msgs + tools) / 4);
}

/** Everything the model has seen so far in this request, as one string. */
export function seenText(req: CompletionRequest): string {
  return req.messages.map((m) => messageContentToString(m.content)).join("\n");
}

/** One-line description of a turn: `call:name,name` or `text:<first 40 chars>`. */
export function describeTurn(turn: TestTurn): string {
  if ("toolCall" in turn) return `call:${turn.toolCall.name}`;
  if ("toolCalls" in turn) return `call:${turn.toolCalls.map((c) => c.name).join(",")}`;
  if ("text" in turn) return `text:${turn.text.slice(0, 40)}`;
  if ("json" in turn) return "json";
  return `error:${turn.error}`;
}

/** True when the request ships at least one tool. */
export function hasTools(req: CompletionRequest): boolean {
  return (req.tools?.length ?? 0) > 0;
}

/** Harness calls answer an empty JSON object; override with `opts.harnessTurn`. */
const HARNESS_DEFAULT: TestTurn = { text: "{}" };

const usageFor = (req: CompletionRequest, outputTokens: number) => {
  const inputTokens = requestTokens(req);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, estimatedCost: 0 };
};

const withRequestUsage = (req: CompletionRequest, res: CompletionResponse): CompletionResponse => ({
  ...res,
  usage: usageFor(req, res.usage.outputTokens ?? 0),
});

const withRequestUsageEvent = (req: CompletionRequest, ev: StreamEvent): StreamEvent =>
  ev.type === "usage" ? { ...ev, usage: usageFor(req, ev.usage.outputTokens ?? 0) } : ev;

/** A policy layer plus its request log. */
export interface PolicyLayer {
  readonly layer: Layer.Layer<LLMService>;
  readonly calls: RecordedCall[];
  readonly agentCalls: () => RecordedCall[];
}

/**
 * Build the layer. `harnessTurn` answers every harness-purpose call (default
 * `{}`); the policy answers think / unpurposed calls. Same seed gives an
 * identical request log.
 */
export function policyLLMLayer(
  model: PolicyModel,
  seed: number,
  opts: { readonly harnessTurn?: TestTurn; readonly compliance?: number } = {},
): PolicyLayer {
  const harnessTurn = opts.harnessTurn ?? HARNESS_DEFAULT;
  const compliance = opts.compliance ?? 1;
  const rng = makeRng(seed);
  const calls: RecordedCall[] = [];
  let agentTurn = 0;
  const scratch: Record<string, number> = {};

  const route = (req: CompletionRequest): typeof LLMService.Service => {
    const channel = req.purpose === undefined || req.purpose === "think" ? "agent" : "harness";
    const entry: { -readonly [K in keyof RecordedCall]: RecordedCall[K] } = {
      purpose: req.purpose,
      channel,
      req,
      inputTokens: requestTokens(req),
      turn: harnessTurn,
    };
    calls.push(entry);
    const turn =
      channel === "harness"
        ? harnessTurn
        : model(req, { rng, compliance, scratch, agentTurn: agentTurn++, history: calls.map((c) => c.req) });
    entry.turn = turn;
    // A fresh one-turn scenario per call: the policy, not a cursor, picks the turn.
    return TestLLMService([turn]);
  };

  const base = TestLLMService([HARNESS_DEFAULT]);
  const layer = Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      complete: (req) => route(req).complete(req).pipe(Effect.map((res) => withRequestUsage(req, res))),
      stream: (req) =>
        route(req)
          .stream(req)
          .pipe(Effect.map((s) => Stream.map(s, (ev) => withRequestUsageEvent(req, ev)))),
      completeStructured: (req) => route(req).completeStructured(req),
    }),
  );
  return { layer, calls, agentCalls: () => calls.filter((c) => c.channel === "agent") };
}
