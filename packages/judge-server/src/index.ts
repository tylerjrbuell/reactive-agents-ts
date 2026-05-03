import { Effect, Layer, Schema, Context } from "effect";
import { JudgeRequest, type ReproducibilityMetadata } from "./contract.js";
import { handleJudgeRequest } from "./handler.js";

const JudgeLLMService = Context.GenericTag<{
  complete: (req: { prompt: string; sutModel: string }) => Effect.Effect<{ text: string }>;
}>("JudgeLLMService");

/**
 * Stub layer used in tests and as a placeholder until Task 6 wires the live layer.
 * Returns a structured "passing" judgment so HTTP tests can exercise the full path
 * without booting the real LLM provider stack.
 */
const StubJudgeLayer = Layer.succeed(JudgeLLMService, {
  complete: () =>
    Effect.succeed({
      text: JSON.stringify({
        passed: true,
        overallScore: 0.95,
        recommendation: "accept",
        layerResults: [{ layerName: "stub", score: 0.95, passed: true }],
      }),
    }),
});

export interface ServerConfig {
  port: number;
  judgeModelSha: string;
  judgeCodeSha: string;
  judgeLayer: "stub" | "live";
}

export interface ServerHandle {
  port: number;
  stop: (force?: boolean) => void;
}

export const startServer = async (config: ServerConfig): Promise<ServerHandle> => {
  const reproducibility: ReproducibilityMetadata = {
    judgeModelSha: config.judgeModelSha,
    judgeCodeSha: config.judgeCodeSha,
  };
  // Task 5 ships only the stub layer. Task 6 will wire JudgeLLMServiceLive from @reactive-agents/eval.
  const layer = StubJudgeLayer;

  const server = Bun.serve({
    port: config.port,
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
        const result = await Effect.runPromise(
          handleJudgeRequest(decoded.right, reproducibility).pipe(Effect.provide(layer)),
        );
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
  };
};

if (import.meta.main) {
  const port = Number(process.env.PORT ?? "8910");
  const judgeModelSha = process.env.JUDGE_MODEL_SHA ?? "unknown";
  const judgeCodeSha = process.env.JUDGE_CODE_SHA ?? "unknown";
  const judgeLayer = (process.env.JUDGE_LAYER as "stub" | "live") ?? "stub";
  const handle = await startServer({ port, judgeModelSha, judgeCodeSha, judgeLayer });
  // eslint-disable-next-line no-console
  console.log(
    `judge-server listening on :${handle.port} (model=${judgeModelSha} code=${judgeCodeSha} layer=${judgeLayer})`,
  );
}
