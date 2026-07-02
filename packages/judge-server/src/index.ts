import { Effect, Layer, Schema } from "effect";
import { JudgeLLMService } from "@reactive-agents/eval";
import { secureServe, isMain } from "@reactive-agents/runtime-shim";
import { JudgeRequest, type ReproducibilityMetadata } from "./contract.js";
import { handleJudgeRequest } from "./handler.js";
import { buildJudgeLayer, resolveLiveLayerConfig } from "./live-layer.js";

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

export interface ServerConfig {
  port: number;
  judgeModelSha: string;
  judgeCodeSha: string;
  judgeLayer: "stub" | "live";
}

export interface ServerHandle {
  port: number;
  stop: (force?: boolean) => void;
  /**
   * Which JudgeLLMService Layer the server was wired with.
   * `"live"` selects `buildJudgeLayer(resolveLiveLayerConfig())` from
   * `live-layer.ts`; `"stub"` selects the in-process `StubJudgeLayer` above.
   */
  activeLayer: "stub" | "live";
}

export const startServer = async (config: ServerConfig): Promise<ServerHandle> => {
  const reproducibility: ReproducibilityMetadata = {
    judgeModelSha: config.judgeModelSha,
    judgeCodeSha: config.judgeCodeSha,
  };

  const layer: Layer.Layer<JudgeLLMService> =
    config.judgeLayer === "live"
      ? buildJudgeLayer(resolveLiveLayerConfig())
      : StubJudgeLayer;

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
        const provided = handleJudgeRequest(decoded.right, reproducibility).pipe(
          Effect.provide(layer),
        );
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
  };
};

if (isMain(import.meta.url)) {
  const port = Number(process.env.PORT ?? "8910");
  const judgeModelSha = process.env.JUDGE_MODEL_SHA ?? "unknown";
  const judgeCodeSha = process.env.JUDGE_CODE_SHA ?? "unknown";
  const judgeLayer = (process.env.JUDGE_LAYER as "stub" | "live") ?? "stub";
  const handle = await startServer({ port, judgeModelSha, judgeCodeSha, judgeLayer });
  // eslint-disable-next-line no-console
  console.log(
    `judge-server listening on :${handle.port} (model=${judgeModelSha} code=${judgeCodeSha} layer=${handle.activeLayer})`,
  );
}
