import { Effect, Context } from "effect";
import type { JudgeRequest, JudgeResponse, ReproducibilityMetadata, JudgeLayerResult } from "./contract.js";

// Local Tag declaration matching the @reactive-agents/eval JudgeLLMService identifier.
// Using GenericTag here keeps the handler decoupled from the eval package's exact module path,
// which lets tests provide a stub layer with the same identifier "JudgeLLMService".
const JudgeLLMService = Context.GenericTag<{
  complete: (req: { prompt: string; sutModel: string }) => Effect.Effect<{ text: string }>;
}>("JudgeLLMService");

/**
 * Build the prompt string the judge LLM sees.
 * Kept minimal for Task 4; Task 6 will refine when the live layer lands.
 */
const buildJudgePrompt = (req: JudgeRequest): string => {
  return [
    "You are an evaluation judge. Score the response below.",
    `SUT model: ${req.sutModel}`,
    `Task input: ${JSON.stringify(req.taskInput)}`,
    `SUT response: ${req.sutResponse}`,
    req.taskCriteria ? `Criteria: ${req.taskCriteria}` : "",
    "Return a JSON object with shape: {passed: boolean, overallScore: number 0-1, recommendation: 'accept'|'review'|'reject', layerResults: Array<{layerName, score, passed, details?}>}",
  ].filter(Boolean).join("\n");
};

/**
 * Parse the judge LLM's text response into the structured verdict shape.
 * Defensive: returns a degraded "review" verdict if parsing fails.
 */
export const parseJudgmentText = (text: string): {
  passed: boolean;
  overallScore: number;
  recommendation: "accept" | "review" | "reject";
  layerResults: JudgeLayerResult[];
} => {
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed === "object" && parsed !== null &&
      "passed" in parsed && typeof (parsed as { passed: unknown }).passed === "boolean" &&
      "overallScore" in parsed && typeof (parsed as { overallScore: unknown }).overallScore === "number" &&
      "recommendation" in parsed &&
      ((parsed as { recommendation: unknown }).recommendation === "accept" ||
        (parsed as { recommendation: unknown }).recommendation === "review" ||
        (parsed as { recommendation: unknown }).recommendation === "reject") &&
      "layerResults" in parsed && Array.isArray((parsed as { layerResults: unknown }).layerResults)
    ) {
      const p = parsed as {
        passed: boolean;
        overallScore: number;
        recommendation: "accept" | "review" | "reject";
        layerResults: JudgeLayerResult[];
      };
      return {
        passed: p.passed,
        overallScore: p.overallScore,
        recommendation: p.recommendation,
        layerResults: p.layerResults,
      };
    }
  } catch {
    // fall through to degraded verdict
  }
  return {
    passed: false,
    overallScore: 0.5,
    recommendation: "review",
    layerResults: [{
      layerName: "judge_parse_failure",
      score: 0.5,
      passed: false,
      details: "Could not parse judge text into structured verdict",
    }],
  };
};

export const handleJudgeRequest = (
  req: JudgeRequest,
  reproducibility: ReproducibilityMetadata,
): Effect.Effect<JudgeResponse, never, Context.Tag.Identifier<typeof JudgeLLMService>> =>
  Effect.gen(function* () {
    const judge = yield* JudgeLLMService;
    const prompt = buildJudgePrompt(req);
    const llmResult = yield* judge.complete({ prompt, sutModel: req.sutModel });
    const verdict = parseJudgmentText(llmResult.text);
    return {
      taskId: req.taskId,
      passed: verdict.passed,
      overallScore: verdict.overallScore,
      recommendation: verdict.recommendation,
      layerResults: verdict.layerResults,
      reproducibility,
    };
  });
