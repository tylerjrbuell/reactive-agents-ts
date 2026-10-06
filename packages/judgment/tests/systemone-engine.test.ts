import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  JudgmentBadResponse,
  JudgmentConnectionError,
  JudgmentRateLimited,
  JudgmentTimeout,
  JudgmentUnauthorized,
  JudgmentUnsupported,
  type NoulSpec,
  type QuestionSpecs,
} from "../src/types.js";
import {
  makeSystemOneHttpBackend,
  type SystemOneHttpConfig,
  type SystemOneProviderDescriptor,
} from "../src/backends/systemone/engine.js";

const syntheticDescriptor = (
  overrides?: Partial<SystemOneProviderDescriptor>,
): SystemOneProviderDescriptor => ({
  name: "synthetic",
  defaultModel: "test-model",
  defaultTimeoutMs: 5_000,
  resolveEndpoint: (explicit) => explicit ?? "http://synthetic.test",
  limits: {
    minQuestions: 1,
    maxQuestions: 4,
    minCriteria: 2,
    maxCriteria: 5,
    maxBodyBytes: 512,
    images: { maxBodyBytes: 4_096, max: 2 },
  },
  extraBodyFields: () => ({ synthetic: true }),
  headers: () => ({ "X-Descriptor": "1" }),
  describeHttpError: ({ status, model }) =>
    status === 404 ? `hint for ${model}` : undefined,
  ...overrides,
});

const noulQuestion: NoulSpec = { type: "noul" };

const oneNoul: QuestionSpecs = { q: noulQuestion };

const okAnswers: QuestionSpecs = {
  c: { type: "choice", instructions: "Pick", criteria: { a: null, b: null } },
  s: { type: "score", instructions: "Rate", criteria: ["low", "mid", "high"] },
  n: { type: "noul", instructions: "Yes?" },
};

const noulAnswerBody = JSON.stringify({
  answers: {
    q: { type: "noul", noul: 0.5 },
  },
});

const okWireResponse = {
  answers: {
    c: { type: "choice", choice: "a", probabilities: { a: 0.7, b: 0.3 }, confidence: 0.7 },
    s: {
      type: "score",
      score: 1.8,
      probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 },
      confidence: 0.75,
    },
    n: { type: "noul", noul: 0.87 },
  },
};

const makeFakeFetch = (behavior: {
  status?: number;
  body?: string;
  reject?: Error;
  headers?: Record<string, string>;
} = {}) => {
  let calls = 0;
  const captured: Array<{ url: string; init?: RequestInit }> = [];

  const fakeFetch: typeof globalThis.fetch = (input, init) => {
    calls += 1;
    captured.push({ url: String(input), init });

    if (behavior.reject) {
      return Promise.reject(behavior.reject);
    }

    const body = behavior.body ?? noulAnswerBody;
    return Promise.resolve(
      new Response(body, {
        status: behavior.status ?? 200,
        headers: { "Content-Type": "application/json", ...behavior.headers },
      }),
    );
  };

  return { fakeFetch, getCalls: () => calls, getCaptured: () => captured };
};

describe("makeSystemOneHttpBackend", () => {
  test("model precedence: per-call model beats config.model beats descriptor.defaultModel", async () => {
    const { fakeFetch, getCaptured } = makeFakeFetch();
    const backend = makeSystemOneHttpBackend(syntheticDescriptor(), {
      fetch: fakeFetch,
      model: "config-model",
    });

    await Effect.runPromise(backend.evaluate({ state: null, questions: oneNoul, model: "call-model" }));
    expect(JSON.parse(String(getCaptured()[0].init.body)).model).toBe("call-model");

    await Effect.runPromise(backend.evaluate({ state: null, questions: oneNoul }));
    expect(JSON.parse(String(getCaptured()[1].init.body)).model).toBe("config-model");

    const defaultBackend = makeSystemOneHttpBackend(syntheticDescriptor(), { fetch: fakeFetch });
    await Effect.runPromise(defaultBackend.evaluate({ state: null, questions: oneNoul }));
    expect(JSON.parse(String(getCaptured()[2].init.body)).model).toBe("test-model");
  });

  test("posts to resolveEndpoint(baseUrl) + path, defaulting path to /v1/systemone", async () => {
    const { fakeFetch, getCaptured } = makeFakeFetch();
    const backend = makeSystemOneHttpBackend(syntheticDescriptor(), {
      fetch: fakeFetch,
      baseUrl: "http://explicit.example",
    });

    await Effect.runPromise(backend.evaluate({ state: null, questions: oneNoul }));
    expect(getCaptured()[0].url).toBe("http://explicit.example/v1/systemone");

    const withPath = makeSystemOneHttpBackend(
      syntheticDescriptor({ path: "/custom/path", resolveEndpoint: () => "http://resolved.test" }),
      { fetch: fakeFetch },
    );
    await Effect.runPromise(withPath.evaluate({ state: null, questions: oneNoul }));
    expect(getCaptured()[1].url).toBe("http://resolved.test/custom/path");
  });

  test("sends Content-Type plus merged headers with config headers winning over descriptor headers", async () => {
    const { fakeFetch, getCaptured } = makeFakeFetch();
    const backend = makeSystemOneHttpBackend(syntheticDescriptor(), {
      fetch: fakeFetch,
      headers: { "X-Descriptor": "config-wins", "X-Extra": "yes" },
    });

    await Effect.runPromise(backend.evaluate({ state: null, questions: oneNoul }));
    expect(getCaptured()[0].init.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Descriptor": "config-wins",
      "X-Extra": "yes",
    });
  });

  test("spreads extraBodyFields into the body", async () => {
    const { fakeFetch, getCaptured } = makeFakeFetch();
    const backend = makeSystemOneHttpBackend(syntheticDescriptor(), { fetch: fakeFetch });

    await Effect.runPromise(backend.evaluate({ state: null, questions: oneNoul }));
    const body = JSON.parse(String(getCaptured()[0].init.body));
    expect(body.synthetic).toBe(true);
  });

  test("omits images from the body when absent; includes them verbatim and in order when present", async () => {
    const { fakeFetch, getCaptured } = makeFakeFetch();
    const backend = makeSystemOneHttpBackend(syntheticDescriptor(), { fetch: fakeFetch });

    await Effect.runPromise(backend.evaluate({ state: null, questions: oneNoul }));
    expect(JSON.parse(String(getCaptured()[0].init.body))).not.toHaveProperty("images");

    await Effect.runPromise(
      backend.evaluate({ state: null, questions: oneNoul, images: ["first", "second"] }),
    );
    expect(JSON.parse(String(getCaptured()[1].init.body)).images).toEqual(["first", "second"]);
  });

  test("sets capabilities from descriptor.limits: maxQuestions, images:true, calibrated:true, distributions:true, modelCatalog:false", () => {
    const backend = makeSystemOneHttpBackend(syntheticDescriptor());
    expect(backend.capabilities).toEqual({
      maxQuestions: 4,
      supportedKinds: ["noul", "choice", "score"],
      distributions: true,
      calibrated: true,
      images: true,
      modelCatalog: false,
    });
    expect(backend).not.toHaveProperty("listModels");
  });
});

describe("System One engine limit rejections", () => {
  const runUnsupported = async (
    descriptor: SystemOneProviderDescriptor,
    config: SystemOneHttpConfig,
    input: { readonly questions: QuestionSpecs; readonly state?: string; readonly images?: readonly string[] },
  ) => {
    const { fakeFetch, getCalls } = makeFakeFetch({ reject: new Error("should not be called") });
    const backend = makeSystemOneHttpBackend(descriptor, { ...config, fetch: fakeFetch });
    const error = await Effect.runPromise(
      Effect.flip(backend.evaluate({ state: input.state ?? null, questions: input.questions, images: input.images })),
    );
    expect(getCalls()).toBe(0);
    if (error instanceof JudgmentUnsupported) {
      return error;
    }
    throw new Error(`expected JudgmentUnsupported, got ${String(error)}`);
  };

  test("0 questions and maxQuestions+1 questions fail JudgmentUnsupported naming the count", async () => {
    const error0 = await runUnsupported(syntheticDescriptor(), {}, { questions: {} });
    expect(error0.message).toContain("0");

    const tooMany: QuestionSpecs = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [`q${i}`, noulQuestion]),
    );
    const error5 = await runUnsupported(syntheticDescriptor(), {}, { questions: tooMany });
    expect(error5.message).toContain("5");
  });

  test("1 and maxCriteria+1 choice criteria fail JudgmentUnsupported naming the question id", async () => {
    const oneChoice: QuestionSpecs = { cq: { type: "choice", criteria: { a: null } } };
    const error1 = await runUnsupported(syntheticDescriptor(), {}, { questions: oneChoice });
    expect(error1.message).toContain("cq");

    const tooMany: QuestionSpecs = {
      cq: {
        type: "choice",
        criteria: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`o${i}`, null])),
      },
    };
    const error6 = await runUnsupported(syntheticDescriptor(), {}, { questions: tooMany });
    expect(error6.message).toContain("cq");
  });

  test("1 and maxCriteria+1 score levels fail JudgmentUnsupported naming the question id", async () => {
    const oneScore: QuestionSpecs = { sq: { type: "score", criteria: ["low"] } };
    const error1 = await runUnsupported(syntheticDescriptor(), {}, { questions: oneScore });
    expect(error1.message).toContain("sq");

    const tooMany: QuestionSpecs = {
      sq: { type: "score", criteria: ["0", "1", "2", "3", "4", "5"] },
    };
    const error6 = await runUnsupported(syntheticDescriptor(), {}, { questions: tooMany });
    expect(error6.message).toContain("sq");
  });

  test("a blank question key and a blank choice label fail JudgmentUnsupported naming the offender", async () => {
    const blankKey: QuestionSpecs = { "  ": noulQuestion };
    const errorKey = await runUnsupported(syntheticDescriptor(), {}, { questions: blankKey });
    expect(errorKey.message).toContain('"  "');

    const blankLabel: QuestionSpecs = {
      cq: { type: "choice", criteria: { "  ": null, ok: null } },
    };
    const errorLabel = await runUnsupported(syntheticDescriptor(), {}, { questions: blankLabel });
    expect(errorLabel.message).toContain('"  "');
    expect(errorLabel.message).toContain("cq");
  });

  test("a body over maxBodyBytes fails JudgmentUnsupported naming the byte size and the text ceiling", async () => {
    const longState = "x".repeat(600);
    const error = await runUnsupported(syntheticDescriptor(), {}, { questions: oneNoul, state: longState });
    expect(error.message).toMatch(/\d+ bytes/);
    expect(error.message).toContain("text");
  });

  test("the same body with images is measured against images.maxBodyBytes instead and passes", async () => {
    const longState = "x".repeat(600);
    const { fakeFetch, getCalls } = makeFakeFetch();
    const backend = makeSystemOneHttpBackend(syntheticDescriptor(), { fetch: fakeFetch });

    await Effect.runPromise(
      backend.evaluate({ state: longState, questions: oneNoul, images: ["img"] }),
    );
    expect(getCalls()).toBe(1);
  });

  test("images over limits.images.max fail JudgmentUnsupported naming the count", async () => {
    const error = await runUnsupported(syntheticDescriptor(), {}, { questions: oneNoul, images: ["a", "b", "c"] });
    expect(error.message).toContain("3");
  });

  test("images against a descriptor with no limits.images fail JudgmentUnsupported", async () => {
    const noImages = syntheticDescriptor({ limits: { ...syntheticDescriptor().limits, images: undefined } });
    const error = await runUnsupported(noImages, {}, { questions: oneNoul, images: ["a"] });
    expect(error).toBeInstanceOf(JudgmentUnsupported);
  });
});

describe("System One engine decode and error mapping", () => {
  test("decodes a 200 into JudgmentAnswers via decodeSystemOneAnswers", async () => {
    const { fakeFetch } = makeFakeFetch({ body: JSON.stringify(okWireResponse) });
    const backend = makeSystemOneHttpBackend(syntheticDescriptor(), { fetch: fakeFetch });

    const answers = await Effect.runPromise(
      backend.evaluate({ state: null, questions: okAnswers }),
    );

    expect(answers.c).toEqual({
      kind: "choice",
      value: "a",
      probabilities: { a: 0.7, b: 0.3 },
      confidence: 0.7,
      calibrated: true,
    });
    expect(answers.s).toEqual({
      kind: "score",
      value: 1.8,
      probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 },
      confidence: 0.75,
      calibrated: true,
    });
    expect(answers.n).toEqual({ kind: "noul", probability: 0.87 });
  });

  test("maps a rejected fetch to JudgmentConnectionError", async () => {
    const { fakeFetch } = makeFakeFetch({ reject: new Error("connection refused") });
    const backend = makeSystemOneHttpBackend(syntheticDescriptor(), { fetch: fakeFetch });

    const error = await Effect.runPromise(
      Effect.flip(backend.evaluate({ state: null, questions: oneNoul })),
    );
    expect(error).toBeInstanceOf(JudgmentConnectionError);
    expect(error._tag).toBe("JudgmentConnectionError");
  });

  test("maps an abort from AbortSignal.timeout to JudgmentTimeout carrying timeoutMs", async () => {
    const fakeFetch: typeof globalThis.fetch = (_input, init) =>
      new Promise((_, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("missing signal"));
          return;
        }
        signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "TimeoutError" }));
        });
      });

    const backend = makeSystemOneHttpBackend(syntheticDescriptor(), {
      fetch: fakeFetch,
      timeoutMs: 5,
    });

    const error = await Effect.runPromise(
      Effect.flip(backend.evaluate({ state: null, questions: oneNoul })),
    );
    expect(error).toBeInstanceOf(JudgmentTimeout);
    expect(error._tag).toBe("JudgmentTimeout");
    if (error instanceof JudgmentTimeout) {
      expect(error.timeoutMs).toBe(5);
    }
  });

  test("maps 401/403 to JudgmentUnauthorized, 429 to JudgmentRateLimited with retryAfterMs parsed from Retry-After", async () => {
    const { fakeFetch: fake401 } = makeFakeFetch({ status: 401, body: "unauthorized" });
    const err401 = await Effect.runPromise(
      Effect.flip(makeSystemOneHttpBackend(syntheticDescriptor(), { fetch: fake401 }).evaluate({ state: null, questions: oneNoul })),
    );
    expect(err401).toBeInstanceOf(JudgmentUnauthorized);
    expect(err401._tag).toBe("JudgmentUnauthorized");

    const { fakeFetch: fake403 } = makeFakeFetch({ status: 403, body: "forbidden" });
    const err403 = await Effect.runPromise(
      Effect.flip(makeSystemOneHttpBackend(syntheticDescriptor(), { fetch: fake403 }).evaluate({ state: null, questions: oneNoul })),
    );
    expect(err403).toBeInstanceOf(JudgmentUnauthorized);

    const { fakeFetch: fake429 } = makeFakeFetch({
      status: 429,
      body: "rate limited",
      headers: { "Retry-After": "2" },
    });
    const err429 = await Effect.runPromise(
      Effect.flip(makeSystemOneHttpBackend(syntheticDescriptor(), { fetch: fake429 }).evaluate({ state: null, questions: oneNoul })),
    );
    expect(err429).toBeInstanceOf(JudgmentRateLimited);
    if (err429 instanceof JudgmentRateLimited) {
      expect(err429.retryAfterMs).toBe(2_000);
    }
  });

  test("maps 400, 404, 413, and 5xx to JudgmentBadResponse, appending the describeHttpError hint", async () => {
    for (const status of [400, 404, 413, 500, 502]) {
      const { fakeFetch } = makeFakeFetch({ status, body: `server error ${status}` });
      const backend = makeSystemOneHttpBackend(syntheticDescriptor(), { fetch: fakeFetch });
      const error = await Effect.runPromise(
        Effect.flip(backend.evaluate({ state: null, questions: oneNoul })),
      );
      expect(error).toBeInstanceOf(JudgmentBadResponse);
      expect(error._tag).toBe("JudgmentBadResponse");
      if (status === 404) {
        expect(error.message).toContain("hint for test-model");
      }
    }
  });

  test("assert _tag on every error row, never message text, except where the hint is the assertion", () => {
    expect(new JudgmentUnauthorized({ message: "" })._tag).toBe("JudgmentUnauthorized");
    expect(new JudgmentRateLimited({ message: "" })._tag).toBe("JudgmentRateLimited");
    expect(new JudgmentTimeout({ message: "", timeoutMs: 1 })._tag).toBe("JudgmentTimeout");
    expect(new JudgmentBadResponse({ message: "" })._tag).toBe("JudgmentBadResponse");
    expect(new JudgmentConnectionError({ message: "" })._tag).toBe("JudgmentConnectionError");
    expect(new JudgmentUnsupported({ message: "" })._tag).toBe("JudgmentUnsupported");
  });
});
