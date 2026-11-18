/**
 * S6 spike: purpose-routed, request-recording, reactive scripted LLM layer.
 *
 * Harness-internal calls (classify/extract/plan/verify/...) never reach the
 * agent policy, so they cannot consume the agent script (the classifier-peek
 * defect of `TestLLMService`). Every request is recorded, and tokens are counted
 * from the recorded request (system prompt + full history + tool schemas), which
 * `TestLLMService`'s `fakeUsage` does not do.
 */
import { Layer } from "effect";
import {
  LLMService,
  TestLLMService,
  messageContentToString,
  type CompletionRequest,
  type TestTurn,
} from "@reactive-agents/llm-provider";

/** Deterministic PRNG (mulberry32). Same seed, same stream. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PolicyContext {
  readonly rng: () => number;
  /** 0-based index among agent (think / unpurposed) calls. */
  readonly agentTurn: number;
  /** Every request so far, this one last. */
  readonly history: readonly CompletionRequest[];
}

/** Maps a request to the next model turn. Reactive: reads the request, not a cursor. */
export type PolicyModel = (req: CompletionRequest, ctx: PolicyContext) => TestTurn;

export interface RecordedCall {
  readonly purpose: CompletionRequest["purpose"];
  readonly channel: "agent" | "harness";
  readonly req: CompletionRequest;
  readonly inputTokens: number;
}

/** Token estimate from the recorded request: system + all messages + tool schemas (chars / 4). */
export function requestTokens(req: CompletionRequest): number {
  const sys = req.systemPrompt?.length ?? 0;
  const msgs = req.messages.reduce((n, m) => n + messageContentToString(m.content).length, 0);
  const tools = req.tools === undefined ? 0 : JSON.stringify(req.tools).length;
  return Math.ceil((sys + msgs + tools) / 4);
}

/** Harness calls answer an empty JSON object; override to script them. */
const HARNESS_DEFAULT: TestTurn = { text: "{}" };

export function policyLLMLayer(
  model: PolicyModel,
  seed: number,
  harnessTurn: TestTurn = HARNESS_DEFAULT,
) {
  const rng = makeRng(seed);
  const calls: RecordedCall[] = [];
  let agentTurn = 0;

  const route = (req: CompletionRequest): typeof LLMService.Service => {
    const channel = req.purpose === undefined || req.purpose === "think" ? "agent" : "harness";
    calls.push({ purpose: req.purpose, channel, req, inputTokens: requestTokens(req) });
    const turn =
      channel === "harness"
        ? harnessTurn
        : model(req, { rng, agentTurn: agentTurn++, history: calls.map((c) => c.req) });
    // A fresh one-turn scenario per call: the policy, not a cursor, picks the turn.
    return TestLLMService([turn]);
  };

  const base = TestLLMService([HARNESS_DEFAULT]);
  const layer = Layer.succeed(
    LLMService,
    LLMService.of({
      ...base,
      complete: (req) => route(req).complete(req),
      stream: (req) => route(req).stream(req),
      completeStructured: (req) => route(req).completeStructured(req),
    }),
  );
  return { layer, calls, agentCalls: () => calls.filter((c) => c.channel === "agent") };
}
