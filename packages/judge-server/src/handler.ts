import { Effect } from "effect";
import { JudgeLLMService } from "@reactive-agents/eval";
import type { LLMMessage } from "@reactive-agents/llm-provider";
import type { JudgeRequest, JudgeResponse, ReproducibilityMetadata, JudgeLayerResult } from "./contract.js";

/**
 * Build the messages the judge LLM sees.
 * Wraps the prompt in a single user-role LLMMessage to satisfy the
 * `JudgeLLMService.complete(CompletionRequest)` shape from @reactive-agents/eval.
 */
const buildJudgeMessages = (req: JudgeRequest): LLMMessage[] => {
  const promptText = [
    "You are an evaluation judge. Score the response below.",
    `SUT model: ${req.sutModel}`,
    `Task input: ${JSON.stringify(req.taskInput)}`,
    `SUT response: ${req.sutResponse}`,
    req.taskCriteria ? `Criteria: ${req.taskCriteria}` : "",
    // Partial-credit protocol (2026-07-07): rubrics phrased as "Score 1.0
    // if (1)...(4); score 0.0 if X" leave the middle undefined, and judges
    // were collapsing 3-of-4-satisfied responses to 0 while their own
    // evidence said the zero condition did NOT hold (observed live: score 0
    // with evidence "All databases mentioned exist").
    "Scoring protocol:",
    "1. Decompose the criteria into individual requirements.",
    "2. Check each requirement against the response; record satisfied/violated with one line of evidence in layerResults (one entry per requirement).",
    "3. If the criteria define an explicit zero condition, apply it ONLY when that condition actually holds.",
    "4. Otherwise overallScore = fraction of requirements satisfied (partial credit is the default).",
    "5. Your evidence must be consistent with the score: never pair a 0 score with only positive findings — name the specific violated requirement.",
    "Return ONLY a raw JSON object — no markdown, no prose, no code fences. Shape: {passed: boolean, overallScore: number 0-1, recommendation: 'accept'|'review'|'reject', layerResults: Array<{layerName, score, passed, details?}>}",
  ].filter(Boolean).join("\n");
  return [{ role: "user", content: promptText }];
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
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const jsonStr = start !== -1 && end > start ? text.slice(start, end + 1) : text;
    const parsed: unknown = JSON.parse(jsonStr);
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
): Effect.Effect<JudgeResponse, unknown, JudgeLLMService> =>
  Effect.gen(function* () {
    const judge = yield* JudgeLLMService;
    const messages = buildJudgeMessages(req);
    const llmResult = yield* judge.complete({
      messages,
      systemPrompt:
        "You are a JSON evaluation API. Your entire response MUST be a single valid JSON object. " +
        "Do not include markdown, code fences, prose, or any text outside the JSON object. " +
        "Begin your response with { and end with }.",
    });
    const verdict = parseJudgmentText(llmResult.content);
    return {
      taskId: req.taskId,
      passed: verdict.passed,
      overallScore: verdict.overallScore,
      recommendation: verdict.recommendation,
      layerResults: verdict.layerResults,
      reproducibility,
    };
  });
