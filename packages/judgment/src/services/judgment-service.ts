import { Context, Effect, Layer } from "effect";
import { EventBus } from "@reactive-agents/core";
import {
  DEFAULT_JUDGMENT_CAPABILITIES,
  JudgmentUnsupported,
  type JudgmentAnswer,
  type JudgmentAnswers,
  type JudgmentBackend,
  type JudgmentCapabilities,
  type JudgmentEntry,
  type JudgmentError,
  type JudgmentModel,
  type QuestionSpecs,
} from "../types.js";

/**
 * The batched-ask judgment primitive. Backend-agnostic — construction wires
 * in a `JudgmentBackend` (jev, llm-emulation, or a future third provider).
 * Consumers never import a backend or the vendor SDK directly.
 */
export class JudgmentService extends Context.Tag("JudgmentService")<
  JudgmentService,
  {
    readonly ask: <Q extends QuestionSpecs>(input: {
      readonly state: JudgmentEntry;
      readonly questions: Q;
      readonly model?: string;
      readonly images?: readonly string[];
    }) => Effect.Effect<JudgmentAnswers<Q>, JudgmentError>;
    /** List the models/aliases the backend's account can send in `ask`'s `model` field. Fails `JudgmentUnsupported` if the backend has no catalog endpoint. */
    readonly listModels: () => Effect.Effect<ReadonlyArray<JudgmentModel>, JudgmentError>;
    /**
     * Discover backend limits. Optional because ~25 existing service fakes across
     * the monorepo do not implement it; when absent, `capabilitiesOf` returns
     * `DEFAULT_JUDGMENT_CAPABILITIES`.
     */
    readonly capabilities?: () => Effect.Effect<JudgmentCapabilities>;
  }
>() {}

/**
 * Resolve capabilities from any `JudgmentService`-shaped value, falling back to
 * defaults when the service does not expose the optional method.
 */
export const capabilitiesOf = (svc: JudgmentService["Type"]): Effect.Effect<JudgmentCapabilities> =>
  svc.capabilities?.() ?? Effect.succeed(DEFAULT_JUDGMENT_CAPABILITIES);

/** Wraps a `JudgmentBackend` with no observability — tests and internal composition. */
export const makeJudgmentServiceLive = (backend: JudgmentBackend): Layer.Layer<JudgmentService> => {
  const caps: JudgmentCapabilities = {
    ...DEFAULT_JUDGMENT_CAPABILITIES,
    modelCatalog: backend.listModels !== undefined,
    ...backend.capabilities,
  };

  const guardAsk = <Q extends QuestionSpecs>(input: {
    readonly state: JudgmentEntry;
    readonly questions: Q;
    readonly model?: string;
    readonly images?: readonly string[];
  }): Effect.Effect<JudgmentAnswers<Q>, JudgmentError> => {
    for (const [id, question] of Object.entries(input.questions)) {
      if (!caps.supportedKinds.includes(question.type)) {
        return Effect.fail(
          new JudgmentUnsupported({
            message: `Backend "${backend.name}" does not support question kind "${question.type}" (question "${id}")`,
          }),
        );
      }
    }
    if (input.images !== undefined && input.images.length > 0 && !caps.images) {
      return Effect.fail(
        new JudgmentUnsupported({
          message: `Backend "${backend.name}" does not support images`,
        }),
      );
    }
    return backend.evaluate(input).pipe(
      // `evaluate` returns one answer per requested id (or fails) — the cast
      // recovers the per-call generic `Q` the plain `JudgmentBackend`
      // interface can't express; see translate.ts's `fromSdkResult` for the
      // "never partial-trust a missing answer" guarantee this relies on.
      Effect.map((answers) => answers as JudgmentAnswers<typeof input.questions>),
    );
  };

  return Layer.succeed(JudgmentService, {
    ask: guardAsk,
    listModels: () =>
      backend.listModels?.() ??
      Effect.fail(new JudgmentUnsupported({ message: `Backend "${backend.name}" has no model catalog` })),
    capabilities: () => Effect.succeed(caps),
  });
};

const summarizeAnswer = (
  id: string,
  answer: JudgmentAnswer,
): { readonly id: string; readonly kind: JudgmentAnswer["kind"]; readonly value: string | number | boolean; readonly confidence?: number; readonly calibrated?: boolean } => {
  switch (answer.kind) {
    case "noul":
      return { id, kind: "noul", value: answer.probability };
    case "choice":
      return { id, kind: "choice", value: answer.value, confidence: answer.confidence, calibrated: answer.calibrated };
    case "score":
      return { id, kind: "score", value: answer.value, confidence: answer.confidence, calibrated: answer.calibrated };
  }
};

/**
 * Decorates a `JudgmentService` with EventBus observability: `judgment:evaluated`
 * on success, `judgment:failed` on any backend error — never the API key.
 * Wrap the backend's Live layer with this at the site a consumer wires
 * `JudgmentService` in (Task 2 Step 4).
 */
export const withEvents = (
  site: string,
  backendName: string,
): Layer.Layer<JudgmentService, never, JudgmentService | EventBus> =>
  Layer.effect(
    JudgmentService,
    Effect.gen(function* () {
      const inner = yield* JudgmentService;
      const eventBus = yield* EventBus;
      return {
        ask: (input) =>
          Effect.gen(function* () {
            const start = Date.now();
            const result = yield* inner.ask(input).pipe(
              Effect.tapError((error) =>
                eventBus.publish({
                  _tag: "JudgmentFailed",
                  site,
                  backend: backendName,
                  errorTag: error._tag,
                  message: error.message,
                  latencyMs: Date.now() - start,
                }),
              ),
            );
            yield* eventBus.publish({
              _tag: "JudgmentEvaluated",
              site,
              backend: backendName,
              answers: Object.entries(result).map(([id, answer]) => summarizeAnswer(id, answer as JudgmentAnswer)),
              latencyMs: Date.now() - start,
            });
            return result;
          }),
        listModels: () => inner.listModels(),
        capabilities: inner.capabilities,
      };
    }),
  );
