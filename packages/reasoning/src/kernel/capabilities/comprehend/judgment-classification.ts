/**
 * judgment-classification.ts — Task 10 (shadow-only): fires ONE batched
 * judgment request (chunked when the tool roster is large) reproducing the
 * union of `classifyTask()`'s four regex signals plus per-tool
 * `requires::<toolName>` nominations, via `Effect.forkDaemon` — never
 * awaited, never altering the regex-derived `TaskClassification` or
 * `nominatedTools` returned to the rest of the kernel. Backend-agnostic —
 * works against whichever `JudgmentBackend` the resolved `JudgmentService`
 * was constructed with.
 *
 * Pattern mirrors `judgmentClassifyShadow` in `strategies/adaptive.ts`
 * (Task 9) and `judgmentComplexityShadow` in `@reactive-agents/cost`'s
 * `complexity-router.ts` (Task 9b): `Effect.serviceOption(JudgmentService)`
 * resolution (does not widen this function's `R`), fire-and-forget via
 * `Effect.forkDaemon`, `JudgmentShadow` events for later agreement analysis
 * (Task 10 Step 4's exit gate). Emits ONE `JudgmentShadow` event per
 * sub-question — `site: "task-comprehension"` — rather than one aggregate
 * event, since this shadow spans several independent signals instead of a
 * single classification.
 *
 * Absent `JudgmentService` (no `.withJudgment()` on the builder) is a clean,
 * zero-cost no-op.
 */
import { Effect, Either, Option } from "effect";
import { JudgmentService } from "@reactive-agents/judgment";
import type { JudgmentAnswer, QuestionSpecs } from "@reactive-agents/judgment";
import { publishReasoningStep } from "../../utils/service-utils.js";
import type { EventBusInstance } from "../../state/kernel-state.js";
import type { TaskClassification } from "./task-classification.js";
import {
  buildComprehendJudgmentBaseQuestions,
  buildComprehendJudgmentState,
  buildToolRequirementQuestions,
  answerToBoolean,
  answerToComplexity,
  answerToOutputFormat,
} from "./judgment-comprehend-questions.js";

/**
 * Per-`ask()` question ceiling. No documented hard cap from TypeSafe on
 * question count per request (unlike `ChoiceCriteria`'s documented 255-option
 * cap) — this is a pragmatic ceiling so a run with a very large tool roster
 * doesn't send one unbounded batched request. Chosen conservatively; revisit
 * with real latency/token data once Task 10 Step 4 has shadow telemetry.
 */
const CHUNK_CAP = 30;

/** Splits the base questions + per-tool Nouls into `ask()`-sized chunks (≤ CHUNK_CAP each). */
function chunkQuestions(toolNames: readonly string[]): readonly QuestionSpecs[] {
  const base = buildComprehendJudgmentBaseQuestions();
  const firstChunkToolCap = Math.max(0, CHUNK_CAP - Object.keys(base).length);
  const firstChunkTools = toolNames.slice(0, firstChunkToolCap);
  const remainingTools = toolNames.slice(firstChunkToolCap);

  const chunks: QuestionSpecs[] = [
    { ...base, ...buildToolRequirementQuestions(firstChunkTools) },
  ];
  for (let i = 0; i < remainingTools.length; i += CHUNK_CAP) {
    chunks.push(buildToolRequirementQuestions(remainingTools.slice(i, i + CHUNK_CAP)));
  }
  return chunks;
}

/** The regex-derived ("current") value for a given question id, as a string — the shadow's agreement baseline. */
function currentValueFor(
  id: string,
  classification: TaskClassification,
  nominatedToolNames: ReadonlySet<string>,
): string {
  switch (id) {
    case "complexity":
      return classification.complexity.complexity;
    case "long-horizon":
      return String(classification.horizon.horizon === "long");
    case "multi-step":
      return String(classification.shape.needsMultiStep);
    case "output-format":
      return classification.intent.format ?? "prose";
    case "citation-needed":
      return String(classification.shape.needsCitation);
    default:
      // `requires::<toolName>` — the boolean the guard-fallback floor already
      // derived from `nominateRequiredTools` (any confidence, not just ≥0.7 —
      // the shadow compares against the raw nomination, not the guard's floor).
      return String(nominatedToolNames.has(id.slice("requires::".length)));
  }
}

/** Maps a judgment answer back to a comparable string for a given question id — `null` on any unrecognized/failed answer. */
function judgedValueFor(id: string, answer: JudgmentAnswer): string | null {
  if (id === "complexity") return answerToComplexity(answer);
  if (id === "output-format") return answerToOutputFormat(answer);
  // "long-horizon" / "multi-step" / "citation-needed" / "requires::<toolName>" are all Nouls.
  const bool = answerToBoolean(answer);
  return bool === null ? null : String(bool);
}

/** Emits one `JudgmentShadow` event per question id, given either a resolved answer map or `null` (chunk failed/timed out). */
function publishChunkShadow(
  eventBus: Option.Option<EventBusInstance>,
  questionIds: readonly string[],
  answers: Readonly<Record<string, JudgmentAnswer>> | null,
  classification: TaskClassification,
  nominatedToolNames: ReadonlySet<string>,
): Effect.Effect<void, never> {
  return Effect.forEach(
    questionIds,
    (id) => {
      const current = currentValueFor(id, classification, nominatedToolNames);
      const answer = answers?.[id];
      const judged = answer ? judgedValueFor(id, answer) : null;
      return publishReasoningStep(eventBus, {
        _tag: "JudgmentShadow",
        site: "task-comprehension",
        judged,
        current,
        agreement: judged === null ? null : judged === current,
      });
    },
    { discard: true },
  );
}

export interface JudgmentComprehendShadowInput {
  readonly task: string;
  readonly classification: TaskClassification;
  /** Names of every tool actually nominated (any confidence) by `nominateRequiredTools` for this run. */
  readonly nominatedToolNames: ReadonlySet<string>;
  /** The run's full available-tool surface — every tool gets its own `requires::<toolName>` shadow question. */
  readonly availableToolNames: readonly string[];
}

/**
 * Task 10 (shadow-only). Fires the batched (possibly chunked) judgment
 * comprehend-classification questions via `Effect.forkDaemon` — never
 * awaited, never altering `classification`/`nominatedToolNames` (the values
 * actually used by the rest of the kernel, produced by the existing
 * regex-only `classifyTask()` / `nominateRequiredTools()` path).
 *
 * `buildInput` is a thunk, not a value — `JudgmentService` is checked FIRST,
 * so the caller's `classifyTask()` re-run + tool-roster `Set`/`.map()` (real,
 * non-trivial work for a large tool roster) is only paid when the feature is
 * actually enabled, keeping the documented "absent = zero-cost no-op"
 * guarantee true rather than aspirational.
 */
export function judgmentComprehendShadow(
  buildInput: () => JudgmentComprehendShadowInput,
  eventBus: Option.Option<EventBusInstance>,
): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const maybeJudgment = yield* Effect.serviceOption(JudgmentService);
    if (Option.isNone(maybeJudgment)) return;
    const judgment = maybeJudgment.value;
    const input = buildInput();

    yield* Effect.forkDaemon(
      Effect.gen(function* () {
        const chunks = chunkQuestions(input.availableToolNames);
        const state = buildComprehendJudgmentState({ task: input.task });

        for (const chunk of chunks) {
          const questionIds = Object.keys(chunk);
          const result = yield* judgment.ask({ state, questions: chunk }).pipe(Effect.either);
          const answers = Either.isRight(result) ? result.right : null;
          yield* publishChunkShadow(
            eventBus,
            questionIds,
            answers,
            input.classification,
            input.nominatedToolNames,
          );
        }
      }),
    );
  });
}
