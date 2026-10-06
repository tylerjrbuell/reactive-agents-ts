import { describe, expect, it } from "bun:test";
import { Effect, Layer, Ref } from "effect";
import { EventBus, EventBusLive, type AgentEvent } from "@reactive-agents/core";
import {
  JudgmentService,
  makeJudgmentServiceLive,
  withEvents,
  capabilitiesOf,
} from "../src/services/judgment-service.js";
import {
  DEFAULT_JUDGMENT_CAPABILITIES,
  JudgmentUnsupported,
  type JudgmentAnswers,
  type JudgmentBackend,
  type JudgmentCapabilities,
  type QuestionSpecs,
} from "../src/index.js";

const QUESTIONS: QuestionSpecs = {
  onTopic: { type: "noul", instructions: "on topic?" },
};

const fakeBackend = (
  result: () => Effect.Effect<JudgmentAnswers>,
  extra?: Partial<Omit<JudgmentBackend, "name" | "evaluate">>,
): JudgmentBackend => ({
  name: "fake",
  evaluate: () => result(),
  ...extra,
});

const run = <A>(eff: Effect.Effect<A>): Promise<A> => Effect.runPromise(eff);

describe("capability negotiation", () => {
  it("defaults: a backend that omits capabilities gets DEFAULT_JUDGMENT_CAPABILITIES with modelCatalog derived from listModels", async () => {
    const backend = fakeBackend(() => Effect.succeed({}));
    const layer = makeJudgmentServiceLive(backend);

    const caps = await run(
      Effect.gen(function* () {
        const svc = yield* JudgmentService;
        return yield* svc.capabilities!();
      }).pipe(Effect.provide(layer)),
    );

    expect(caps).toEqual({
      ...DEFAULT_JUDGMENT_CAPABILITIES,
      modelCatalog: false,
    });
  });

  it("defaults derive modelCatalog:true when the backend defines listModels", async () => {
    const backend = fakeBackend(() => Effect.succeed({}), {
      listModels: () => Effect.succeed([]),
    });
    const layer = makeJudgmentServiceLive(backend);

    const caps = await run(
      Effect.gen(function* () {
        const svc = yield* JudgmentService;
        return yield* svc.capabilities!();
      }).pipe(Effect.provide(layer)),
    );

    expect(caps.modelCatalog).toBe(true);
  });

  it("overlay: a backend-supplied capabilities record wins field-by-field over the defaults", async () => {
    const backendCaps: JudgmentCapabilities = {
      maxQuestions: 64,
      distributions: true,
      calibrated: true,
      images: true,
      modelCatalog: false,
      supportedKinds: ["noul", "choice", "score"],
    };
    const backend = fakeBackend(() => Effect.succeed({}), {
      capabilities: backendCaps,
    });
    const layer = makeJudgmentServiceLive(backend);

    const caps = await run(
      Effect.gen(function* () {
        const svc = yield* JudgmentService;
        return yield* svc.capabilities!();
      }).pipe(Effect.provide(layer)),
    );

    expect(caps).toEqual(backendCaps);
    expect(caps.calibrated).toBe(true);
  });

  it("withEvents forwards capabilities() unchanged", async () => {
    const backend = fakeBackend(() => Effect.succeed({}), {
      listModels: () => Effect.succeed([]),
    });
    const baseLayer = makeJudgmentServiceLive(backend);
    const layer = withEvents("test-site", "fake").pipe(
      Layer.provide(baseLayer),
      Layer.provideMerge(EventBusLive),
    );

    const caps = await run(
      Effect.gen(function* () {
        const svc = yield* JudgmentService;
        return yield* svc.capabilities!();
      }).pipe(Effect.provide(layer)),
    );

    expect(caps).toEqual({
      ...DEFAULT_JUDGMENT_CAPABILITIES,
      modelCatalog: true,
    });
  });

  it("kind guard: a noul question against supportedKinds:['choice'] fails JudgmentUnsupported and never calls evaluate", async () => {
    let evaluateCalls = 0;
    const backend: JudgmentBackend = {
      name: "fake",
      evaluate: () => {
        evaluateCalls += 1;
        return Effect.succeed({});
      },
      capabilities: {
        supportedKinds: ["choice"],
        distributions: false,
        calibrated: false,
        images: false,
        modelCatalog: false,
      },
    };
    const layer = makeJudgmentServiceLive(backend);

    const error = await run(
      Effect.gen(function* () {
        const svc = yield* JudgmentService;
        return yield* svc.ask({ state: "x", questions: QUESTIONS }).pipe(Effect.flip);
      }).pipe(Effect.provide(layer)),
    );

    expect(error).toBeInstanceOf(JudgmentUnsupported);
    expect(evaluateCalls).toBe(0);
  });

  it("image guard: a non-empty images array against images:false fails JudgmentUnsupported and never calls evaluate", async () => {
    let evaluateCalls = 0;
    const backend: JudgmentBackend = {
      name: "fake",
      evaluate: () => {
        evaluateCalls += 1;
        return Effect.succeed({});
      },
      capabilities: {
        supportedKinds: ["noul", "choice", "score"],
        distributions: false,
        calibrated: false,
        images: false,
        modelCatalog: false,
      },
    };
    const layer = makeJudgmentServiceLive(backend);

    const error = await run(
      Effect.gen(function* () {
        const svc = yield* JudgmentService;
        return yield* svc
          .ask({ state: "x", questions: QUESTIONS, images: ["data:image/png;base64,abc"] })
          .pipe(Effect.flip);
      }).pipe(Effect.provide(layer)),
    );

    expect(error).toBeInstanceOf(JudgmentUnsupported);
    expect(evaluateCalls).toBe(0);
  });

  it("capabilitiesOf falls back to DEFAULT_JUDGMENT_CAPABILITIES for a service literal that omits the method", async () => {
    const legacy = {
      ask: () => Effect.succeed({}),
      listModels: () => Effect.die(new Error("x")),
    };

    const caps = await run(capabilitiesOf(legacy));

    expect(caps).toEqual(DEFAULT_JUDGMENT_CAPABILITIES);
  });
});
