import { afterEach, describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { resolveOllamaEndpoint } from "@reactive-agents/llm-provider";
import {
  JudgmentBadResponse,
  JudgmentUnsupported,
  type QuestionSpecs,
} from "../src/types.js";
import {
  JudgmentService,
  makeJudgmentServiceLive,
} from "../src/services/judgment-service.js";
import {
  makeOllamaBackend,
  type OllamaJudgmentConfig,
} from "../src/backends/systemone/providers/ollama.js";

const VARS = ["OLLAMA_ENDPOINT", "OLLAMA_HOST", "OLLAMA_BASE"] as const;

afterEach(() => {
  for (const v of VARS) delete process.env[v];
});

const oneNoul: QuestionSpecs = { q: { type: "noul" } };

const okNoulBody = JSON.stringify({
  answers: {
    q: { type: "noul", noul: 0.5 },
  },
});

const makeFakeFetch = () => {
  const captured: Array<{
    readonly url: string;
    readonly init: RequestInit;
    readonly bodyText: string;
  }> = [];

  const fakeFetch: typeof globalThis.fetch = (input, init) => {
    const bodyText = String(init?.body ?? "");
    captured.push({ url: String(input), init: init ?? {}, bodyText });
    return Promise.resolve(
      new Response(okNoulBody, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };

  return { fakeFetch, getCaptured: () => captured };
};

const makeFailingFetch = (status: number, body: string) => {
  const fakeFetch: typeof globalThis.fetch = (input, init) =>
    Promise.resolve(
      new Response(body, {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  return { fakeFetch };
};

const run = <A>(eff: Effect.Effect<A>): Promise<A> => Effect.runPromise(eff);

describe("makeOllamaBackend", () => {
  it("name is 'ollama' and it posts to <resolved endpoint>/v1/systemone", async () => {
    const { fakeFetch, getCaptured } = makeFakeFetch();
    const backend = makeOllamaBackend({ fetch: fakeFetch });

    expect(backend.name).toBe("ollama");

    await run(backend.evaluate({ state: null, questions: oneNoul }));

    expect(getCaptured()[0].url).toBe("http://localhost:11434/v1/systemone");
  });

  it("honors OLLAMA_HOST when baseUrl is absent; baseUrl wins when present", async () => {
    process.env.OLLAMA_HOST = "http://host.docker.internal:11434";
    const { fakeFetch, getCaptured } = makeFakeFetch();
    const backend = makeOllamaBackend({ fetch: fakeFetch });

    await run(backend.evaluate({ state: null, questions: oneNoul }));
    expect(getCaptured()[0].url).toBe("http://host.docker.internal:11434/v1/systemone");

    const withBaseUrl = makeOllamaBackend({
      fetch: fakeFetch,
      baseUrl: "http://explicit.example:11434",
    });
    await run(withBaseUrl.evaluate({ state: null, questions: oneNoul }));
    expect(getCaptured()[1].url).toBe("http://explicit.example:11434/v1/systemone");
  });

  it("defaults model to 'nimble' and timeoutMs to 30_000", async () => {
    const { fakeFetch, getCaptured } = makeFakeFetch();
    const backend = makeOllamaBackend({ fetch: fakeFetch });

    await run(backend.evaluate({ state: null, questions: oneNoul }));

    const body = JSON.parse(getCaptured()[0].bodyText);
    expect(body.model).toBe("nimble");
    expect(getCaptured()[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("passes model:'clef' and model:'clef-flash' through to the body", async () => {
    const { fakeFetch, getCaptured } = makeFakeFetch();
    const backend = makeOllamaBackend({ fetch: fakeFetch, model: "clef" });

    await run(backend.evaluate({ state: null, questions: oneNoul }));
    expect(JSON.parse(getCaptured()[0].bodyText).model).toBe("clef");

    const override = makeOllamaBackend({ fetch: fakeFetch, model: "clef" });
    await run(override.evaluate({ state: null, questions: oneNoul, model: "clef-flash" }));
    expect(JSON.parse(getCaptured()[1].bodyText).model).toBe("clef-flash");

    const defaultBackend = makeOllamaBackend({ fetch: fakeFetch });
    await run(defaultBackend.evaluate({ state: null, questions: oneNoul }));
    expect(JSON.parse(getCaptured()[2].bodyText).model).toBe("nimble");
  });

  it("omits keep_alive when keepAlive is undefined", async () => {
    const { fakeFetch, getCaptured } = makeFakeFetch();
    const backend = makeOllamaBackend({ fetch: fakeFetch });

    await run(backend.evaluate({ state: null, questions: oneNoul }));
    expect(JSON.parse(getCaptured()[0].bodyText)).not.toHaveProperty("keep_alive");
  });

  it("sends keep_alive when keepAlive is '10m', -1, and 0", async () => {
    for (const value of ["10m", -1, 0] as const) {
      const { fakeFetch, getCaptured } = makeFakeFetch();
      const backend = makeOllamaBackend({ fetch: fakeFetch, keepAlive: value });

      await run(backend.evaluate({ state: null, questions: oneNoul }));
      expect(JSON.parse(getCaptured()[0].bodyText).keep_alive).toBe(value);
    }
  });

  it("capabilities() reports maxQuestions:64, distributions:true, calibrated:true, images:true, modelCatalog:false", () => {
    const backend = makeOllamaBackend();
    expect(backend.capabilities).toEqual({
      maxQuestions: 64,
      supportedKinds: ["noul", "choice", "score"],
      distributions: true,
      calibrated: true,
      images: true,
      modelCatalog: false,
    });
  });

  it("has no listModels, so JudgmentService.listModels fails JudgmentUnsupported", async () => {
    const backend = makeOllamaBackend();
    const layer = makeJudgmentServiceLive(backend);

    const error = await run(
      Effect.gen(function* () {
        const svc = yield* JudgmentService;
        return yield* svc.listModels().pipe(Effect.flip);
      }).pipe(Effect.provide(layer)),
    );

    expect(error).toBeInstanceOf(JudgmentUnsupported);
    expect(error.message).toContain("no model catalog");
  });

  it("maps a 404 to JudgmentBadResponse whose message contains 'ollama pull' and the resolved model name", async () => {
    const { fakeFetch } = makeFailingFetch(404, "model not found");
    const backend = makeOllamaBackend({ fetch: fakeFetch, model: "custom-model" });

    const error = await run(
      Effect.flip(backend.evaluate({ state: null, questions: oneNoul })),
    );

    expect(error).toBeInstanceOf(JudgmentBadResponse);
    expect(error.message).toContain("ollama pull custom-model");
  });

  it("maps a 400 to a message naming the local-GGUF requirement and clef/clef-flash for images", async () => {
    const { fakeFetch } = makeFailingFetch(400, "bad request");
    const backend = makeOllamaBackend({ fetch: fakeFetch });

    const error = await run(
      Effect.flip(backend.evaluate({ state: null, questions: oneNoul })),
    );

    expect(error).toBeInstanceOf(JudgmentBadResponse);
    expect(error.message).toContain("GGUF");
    expect(error.message).toContain("clef");
    expect(error.message).toContain("clef-flash");
  });
});
