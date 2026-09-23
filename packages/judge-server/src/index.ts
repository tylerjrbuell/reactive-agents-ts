import { Effect, Layer, Schema } from "effect";
import { JudgeLLMService } from "@reactive-agents/eval";
import { JudgmentService, type JudgmentAnswers } from "@reactive-agents/judgment";
import { secureServe, isMain } from "@reactive-agents/runtime-shim";
import { JudgeRequest, type ReproducibilityMetadata } from "./contract.js";
import { handleJudgeRequest } from "./handler.js";
import { handleJudgeRequestViaJudgment } from "./judgment-handler.js";
import { buildJudgeLayer, buildJudgmentLayer, resolveLiveLayerConfig } from "./live-layer.js";

export type {
  JudgeRequest,
  JudgeResponse,
  JudgeLayerResult,
  ReproducibilityMetadata,
} from "./contract.js";

/**
 * Stub layer used in tests and for HTTP-shape validation without a live provider.
 * Returns a structured "passing" judgment so HTTP tests can exercise the full path
 * without booting the real LLM provider stack.
 *
 * The shape now matches eval's `JudgeLLMService` Tag: `complete(CompletionRequest)`
 * returning `CompletionResponse`. The handler reads `result.content`.
 */
const StubJudgeLayer: Layer.Layer<JudgeLLMService> = Layer.succeed(
  JudgeLLMService,
  JudgeLLMService.of({
    complete: () =>
      Effect.succeed({
        content: JSON.stringify({
          passed: true,
          overallScore: 0.95,
          recommendation: "accept",
          layerResults: [{ layerName: "stub", score: 0.95, passed: true }],
        }),
        stopReason: "end_turn" as const,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedCost: 0,
        },
        model: "stub-judge",
      }),
  }),
);

/**
 * Task 5: stub `JudgmentService` for the `judgeEngine: "jev"` path — same
 * "structured passing judgment for HTTP-shape tests" role as `StubJudgeLayer`
 * above, without booting the real TypeSafe SDK.
 */
const StubJudgmentLayer: Layer.Layer<JudgmentService> = Layer.succeed(JudgmentService, {
  ask: (input) => {
    const answers: Record<string, unknown> = {};
    for (const id of Object.keys(input.questions)) {
      const spec = input.questions[id]!;
      answers[id] =
        spec.type === "noul"
          ? { kind: "noul", probability: 0.95 }
          : spec.type === "choice"
            ? { kind: "choice", value: "accept", probabilities: { accept: 0.95 }, confidence: 0.95, calibrated: true }
            : { kind: "score", value: (spec.criteria.length - 1), probabilities: {}, confidence: 0.95, calibrated: true };
    }
    return Effect.succeed(answers as unknown as JudgmentAnswers<typeof input.questions>);
  },
  listModels: () => Effect.succeed([]),
});

export interface ServerConfig {
  port: number;
  judgeModelSha: string;
  judgeCodeSha: string;
  judgeLayer: "stub" | "live";
  /**
   * Which engine scores `/judge` requests. `"llm"` (default) is the original
   * text-prompt + `parseJudgmentText` path over `JudgeLLMService`, gated by
   * `judgeLayer` as before. `"jev"` routes through `JudgmentService` (batched
   * Noul+Score+Choice, no text parsing) — `judgeLayer` then selects
   * `StubJudgmentLayer` vs `buildJudgmentLayer()` (reads TYPESAFE_API_KEY)
   * instead of the LLM provider stack.
   */
  judgeEngine?: "llm" | "jev";
}

export interface ServerHandle {
  port: number;
  stop: (force?: boolean) => void;
  /**
   * Which Layer the server was wired with, for the active `judgeEngine`.
   * `"live"` selects the real provider/SDK Layer from `live-layer.ts`;
   * `"stub"` selects the in-process stub above.
   */
  activeLayer: "stub" | "live";
  /** Which engine is scoring requests — see `ServerConfig.judgeEngine`. */
  activeEngine: "llm" | "jev";
}

export const startServer = async (config: ServerConfig): Promise<ServerHandle> => {
  const reproducibility: ReproducibilityMetadata = {
    judgeModelSha: config.judgeModelSha,
    judgeCodeSha: config.judgeCodeSha,
  };

  const judgeEngine = config.judgeEngine ?? "llm";

  const llmLayer: Layer.Layer<JudgeLLMService> =
    config.judgeLayer === "live" ? buildJudgeLayer(resolveLiveLayerConfig()) : StubJudgeLayer;
  const judgmentLayer: Layer.Layer<JudgmentService> =
    config.judgeLayer === "live" ? buildJudgmentLayer() : StubJudgmentLayer;

  // Secure-by-default ingress (F4): loopback unless RA_JUDGE_HOST is set;
  // a non-loopback bind requires RA_JUDGE_TOKEN. Prevents anonymous peers from
  // draining the operator's provider key via unbounded /judge LLM calls.
  const server = await secureServe({
    port: config.port,
    hostname: process.env.RA_JUDGE_HOST,
    token: process.env.RA_JUDGE_TOKEN,
    fetch: async (req) => {
      const url = new URL(req.url);

      if (url.pathname === "/version" && req.method === "GET") {
        return Response.json({
          judgeModelSha: config.judgeModelSha,
          judgeCodeSha: config.judgeCodeSha,
        });
      }

      if (url.pathname === "/judge") {
        if (req.method !== "POST") {
          return new Response("Method Not Allowed", { status: 405 });
        }
        let raw: unknown;
        try {
          raw = await req.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }
        const decoded = Schema.decodeUnknownEither(JudgeRequest)(raw);
        if (decoded._tag === "Left") {
          return Response.json(
            { error: "Invalid request shape", detail: String(decoded.left) },
            { status: 400 },
          );
        }
        const provided =
          judgeEngine === "jev"
            ? handleJudgeRequestViaJudgment(decoded.right, reproducibility).pipe(Effect.provide(judgmentLayer))
            : handleJudgeRequest(decoded.right, reproducibility).pipe(Effect.provide(llmLayer));
        const result = await Effect.runPromise(provided);
        return Response.json(result);
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  const boundPort = server.port;
  if (typeof boundPort !== "number") {
    server.stop(true);
    throw new Error("Bun.serve did not assign a port");
  }
  return {
    port: boundPort,
    stop: (force?: boolean) => server.stop(force),
    activeLayer: config.judgeLayer,
    activeEngine: judgeEngine,
  };
};

if (isMain(import.meta.url)) {
  const port = Number(process.env.PORT ?? "8910");
  const judgeModelSha = process.env.JUDGE_MODEL_SHA ?? "unknown";
  const judgeCodeSha = process.env.JUDGE_CODE_SHA ?? "unknown";
  const judgeLayer = (process.env.JUDGE_LAYER as "stub" | "live") ?? "stub";
  const judgeEngine = (process.env.JUDGE_ENGINE as "llm" | "jev") ?? "llm";
  const handle = await startServer({ port, judgeModelSha, judgeCodeSha, judgeLayer, judgeEngine });
  // eslint-disable-next-line no-console
  console.log(
    `judge-server listening on :${handle.port} (model=${judgeModelSha} code=${judgeCodeSha} layer=${handle.activeLayer} engine=${handle.activeEngine})`,
  );
}
