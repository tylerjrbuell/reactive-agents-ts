import { Context, Effect, Layer } from "effect";
import { EventBus } from "@reactive-agents/core";
import {
  JudgmentUnsupported,
  type JudgmentAnswer,
  type JudgmentAnswers,
  type JudgmentBackend,
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
    }) => Effect.Effect<JudgmentAnswers<Q>, JudgmentError>;
    /** List the models/aliases the backend's account can send in `ask`'s `model` field. Fails `JudgmentUnsupported` if the backend has no catalog endpoint. */
    readonly listModels: () => Effect.Effect<ReadonlyArray<JudgmentModel>, JudgmentError>;
  }
>() {}

/** Wraps a `JudgmentBackend` with no observability — tests and internal composition. */
export const makeJudgmentServiceLive = (backend: JudgmentBackend): Layer.Layer<JudgmentService> =>
  Layer.succeed(JudgmentService, {
    ask: (input) =>
      backend.evaluate(input).pipe(
        // `evaluate` returns one answer per requested id (or fails) — the cast
        // recovers the per-call generic `Q` the plain `JudgmentBackend`
        // interface can't express; see translate.ts's `fromSdkResult` for the
        // "never partial-trust a missing answer" guarantee this relies on.
        Effect.map((answers) => answers as JudgmentAnswers<typeof input.questions>),
      ),
    listModels: () =>
      backend.listModels?.() ??
      Effect.fail(new JudgmentUnsupported({ message: `Backend "${backend.name}" has no model catalog` })),
  });

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
      };
    }),
  );
