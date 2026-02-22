// File: src/strategies/tree-of-thought.ts
/**
 * Tree-of-Thought Strategy
 *
 * Breadth-first thought expansion: generate multiple candidate thoughts,
 * score each branch, prune below threshold, then select the best path.
 */
import { Effect } from "effect";
import { ulid } from "ulid";
import type { ReasoningResult, ReasoningStep } from "../types/index.js";
import type { StepId } from "../types/step.js";
import { ExecutionError, IterationLimitError } from "../errors/errors.js";
import type { ReasoningConfig } from "../types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { PromptService } from "@reactive-agents/prompts";

interface TreeOfThoughtInput {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  readonly availableTools: readonly string[];
  readonly config: ReasoningConfig;
}

interface ThoughtNode {
  readonly id: string;
  readonly content: string;
  readonly score: number;
  readonly depth: number;
  readonly parentId: string | null;
}

export const executeTreeOfThought = (
  input: TreeOfThoughtInput,
): Effect.Effect<
  ReasoningResult,
  ExecutionError | IterationLimitError,
  LLMService
> =>
  Effect.gen(function* () {
    const llm = yield* LLMService;
    const promptServiceOpt = yield* Effect.serviceOption(PromptService).pipe(
      Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
    );
    const { breadth, depth, pruningThreshold } =
      input.config.strategies.treeOfThought;
    const steps: ReasoningStep[] = [];
    const start = Date.now();
    let totalTokens = 0;
    let totalCost = 0;

    // All thought nodes across the tree
    let allNodes: ThoughtNode[] = [];

    // Current frontier (nodes at current depth to expand)
    let frontier: ThoughtNode[] = [
      {
        id: ulid(),
        content: `Root: ${input.taskDescription}`,
        score: 1.0,
        depth: 0,
        parentId: null,
      },
    ];

    steps.push({
      id: ulid() as StepId,
      type: "thought",
      content: `[TOT] Starting tree exploration: breadth=${breadth}, depth=${depth}, pruningThreshold=${pruningThreshold}`,
      timestamp: new Date(),
    });

    // ── BFS expansion ──
    for (let d = 1; d <= depth; d++) {
      const nextFrontier: ThoughtNode[] = [];

      for (const parent of frontier) {
        // Generate `breadth` candidate thoughts from this parent
        const expansionResponse = yield* llm
          .complete({
            messages: [
              {
                role: "user",
                content: buildExpansionPrompt(
                  input,
                  parent,
                  breadth,
                  getAncestorPath(allNodes, parent),
                ),
              },
            ],
            systemPrompt: yield* compilePromptOrFallback(
              promptServiceOpt,
              "reasoning.tree-of-thought-expand",
              { task: input.taskDescription, breadth },
              `You are exploring solution paths for: ${input.taskDescription}. Generate ${breadth} distinct approaches.`,
            ),
            maxTokens: 200 * breadth,
            temperature: 0.8,
          })
          .pipe(
            Effect.mapError(
              (err) =>
                new ExecutionError({
                  strategy: "tree-of-thought",
                  message: `Expansion failed at depth ${d}`,
                  step: d,
                  cause: err,
                }),
            ),
          );

        totalTokens += expansionResponse.usage.totalTokens;
        totalCost += expansionResponse.usage.estimatedCost;

        const candidates = parseCandidates(expansionResponse.content, breadth);

        // Score each candidate
        for (const candidate of candidates) {
          const scoreResponse = yield* llm
            .complete({
              messages: [
                {
                  role: "user",
                  content: buildScoringPrompt(
                    input.taskDescription,
                    candidate,
                    getAncestorPath(allNodes, parent),
                  ),
                },
              ],
              systemPrompt: yield* compilePromptOrFallback(
                promptServiceOpt,
                "reasoning.tree-of-thought-score",
                {},
                "You are evaluating a reasoning path. Rate its promise on a scale of 0.0 to 1.0. Respond with ONLY a number.",
              ),
              maxTokens: 50,
              temperature: 0.2,
            })
            .pipe(
              Effect.mapError(
                (err) =>
                  new ExecutionError({
                    strategy: "tree-of-thought",
                    message: `Scoring failed at depth ${d}`,
                    step: d,
                    cause: err,
                  }),
              ),
            );

          totalTokens += scoreResponse.usage.totalTokens;
          totalCost += scoreResponse.usage.estimatedCost;

          const score = parseScore(scoreResponse.content);

          const node: ThoughtNode = {
            id: ulid(),
            content: candidate,
            score,
            depth: d,
            parentId: parent.id,
          };

          allNodes.push(node);

          steps.push({
            id: ulid() as StepId,
            type: "thought",
            content: `[TOT d=${d}] score=${score.toFixed(2)}: ${candidate.substring(0, 100)}...`,
            timestamp: new Date(),
          });

          // Prune: only keep nodes above threshold
          if (score >= pruningThreshold) {
            nextFrontier.push(node);
          }
        }
      }

      // If all paths pruned, stop early
      if (nextFrontier.length === 0) {
        steps.push({
          id: ulid() as StepId,
          type: "observation",
          content: `[TOT] All paths pruned at depth ${d}. Selecting best from previous depth.`,
          timestamp: new Date(),
        });
        break;
      }

      // Sort by score and keep top `breadth` nodes for next depth
      frontier = nextFrontier
        .sort((a, b) => b.score - a.score)
        .slice(0, breadth);
    }

    // ── Select best path ──
    const bestLeaf = [...allNodes, ...frontier].sort(
      (a, b) => b.score - a.score,
    )[0];

    if (!bestLeaf) {
      return buildResult(
        steps,
        null,
        "partial",
        start,
        totalTokens,
        totalCost,
      );
    }

    // Reconstruct the full path
    const bestPath = getAncestorPath(allNodes, bestLeaf);

    steps.push({
      id: ulid() as StepId,
      type: "observation",
      content: `[TOT] Best path (score=${bestLeaf.score.toFixed(2)}): ${bestPath.join(" -> ")}`,
      timestamp: new Date(),
    });

    // ── Synthesize final answer from best path ──
    const synthesisResponse = yield* llm
      .complete({
        messages: [
          {
            role: "user",
            content: `Based on this reasoning path, provide a final answer to: ${input.taskDescription}\n\nReasoning path:\n${bestPath.join("\n→ ")}`,
          },
        ],
        systemPrompt: yield* compilePromptOrFallback(
          promptServiceOpt,
          "reasoning.tree-of-thought-synthesize",
          {},
          "Synthesize the reasoning path into a clear, concise final answer.",
        ),
        maxTokens: 500,
        temperature: 0.3,
      })
      .pipe(
        Effect.mapError(
          (err) =>
            new ExecutionError({
              strategy: "tree-of-thought",
              message: "Synthesis failed",
              step: 999,
              cause: err,
            }),
        ),
      );

    totalTokens += synthesisResponse.usage.totalTokens;
    totalCost += synthesisResponse.usage.estimatedCost;

    steps.push({
      id: ulid() as StepId,
      type: "thought",
      content: `[TOT FINAL] ${synthesisResponse.content}`,
      timestamp: new Date(),
    });

    return buildResult(
      steps,
      synthesisResponse.content,
      "completed",
      start,
      totalTokens,
      totalCost,
    );
  });

// ─── Prompt compilation helper ───

type PromptServiceOpt =
  | { _tag: "Some"; value: { compile: (id: string, vars: Record<string, unknown>) => Effect.Effect<{ content: string }, unknown> } }
  | { _tag: "None" };

function compilePromptOrFallback(
  promptServiceOpt: PromptServiceOpt,
  templateId: string,
  variables: Record<string, unknown>,
  fallback: string,
): Effect.Effect<string, never> {
  if (promptServiceOpt._tag === "None") {
    return Effect.succeed(fallback);
  }
  return promptServiceOpt.value
    .compile(templateId, variables)
    .pipe(
      Effect.map((compiled: { content: string }) => compiled.content),
      Effect.catchAll(() => Effect.succeed(fallback)),
    );
}

// ─── Private Helpers ───

function buildExpansionPrompt(
  _input: TreeOfThoughtInput,
  parent: ThoughtNode,
  breadth: number,
  ancestorPath: string[],
): string {
  const contextStr = ancestorPath.length > 0
    ? `\nReasoning so far:\n${ancestorPath.join("\n→ ")}`
    : "";

  return `Current thought: ${parent.content}${contextStr}

Generate exactly ${breadth} distinct next thoughts or approaches to continue solving this task.
Format each as a numbered item (1., 2., etc.).
Each should explore a meaningfully different direction.`;
}

function buildScoringPrompt(
  taskDescription: string,
  candidate: string,
  ancestorPath: string[],
): string {
  const pathStr = ancestorPath.length > 0
    ? `\nPrevious reasoning:\n${ancestorPath.join("\n→ ")}`
    : "";

  return `Task: ${taskDescription}${pathStr}

Candidate thought: ${candidate}

Rate this thought on a scale from 0.0 to 1.0:
- 1.0 = Directly leads to a correct, complete solution
- 0.7 = Promising direction, needs more development
- 0.5 = Plausible but uncertain
- 0.3 = Unlikely to lead to a good solution
- 0.0 = Clearly wrong or irrelevant

Respond with ONLY a decimal number between 0.0 and 1.0.`;
}

function parseCandidates(text: string, expectedCount: number): string[] {
  const lines = text.split("\n");
  const candidates: string[] = [];
  for (const line of lines) {
    const match = line.match(/^\s*\d+[\.\)]\s+(.+)/);
    if (match) {
      candidates.push(match[1].trim());
    }
  }
  // If parsing failed, split into chunks
  if (candidates.length === 0) {
    return [text.trim()];
  }
  return candidates.slice(0, expectedCount);
}

function parseScore(text: string): number {
  const match = text.trim().match(/([01]\.?\d*)/);
  if (match) {
    const score = parseFloat(match[1]);
    return Math.max(0, Math.min(1, score));
  }
  return 0.5;
}

function getAncestorPath(
  allNodes: ThoughtNode[],
  node: ThoughtNode,
): string[] {
  const path: string[] = [node.content];
  let current: ThoughtNode | undefined = node;

  while (current?.parentId) {
    current = allNodes.find((n) => n.id === current!.parentId);
    if (current) {
      path.unshift(current.content);
    }
  }

  return path;
}

function buildResult(
  steps: readonly ReasoningStep[],
  output: unknown,
  status: "completed" | "partial",
  startMs: number,
  tokensUsed: number,
  cost: number,
): ReasoningResult {
  return {
    strategy: "tree-of-thought",
    steps: [...steps],
    output,
    metadata: {
      duration: Date.now() - startMs,
      cost,
      tokensUsed,
      stepsCount: steps.length,
      confidence: status === "completed" ? 0.85 : 0.4,
    },
    status,
  };
}
