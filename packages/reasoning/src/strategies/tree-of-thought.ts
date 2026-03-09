// File: src/strategies/tree-of-thought.ts
/**
 * Tree-of-Thought Strategy
 *
 * Breadth-first thought expansion: generate multiple candidate thoughts,
 * score each branch, prune below threshold, then select the best path.
 *
 * Phase 1: BFS exploration — generate, score, prune, select best path.
 * Phase 2: Execute selected plan using the shared ReAct kernel.
 */
import { Effect } from "effect";
import { ulid } from "ulid";
import type { ReasoningResult, ReasoningStep } from "../types/index.js";
import { ExecutionError } from "../errors/errors.js";
import type { ReasoningConfig } from "../types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { runKernel } from "./shared/kernel-runner.js";
import { reactKernel } from "./shared/react-kernel.js";
import { resolveStrategyServices, compilePromptOrFallback, publishReasoningStep } from "./shared/service-utils.js";
import { parseScore } from "./shared/quality-utils.js";
import { stripThinking } from "./shared/thinking-utils.js";
import type { ToolSchema } from "./shared/tool-utils.js";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import { makeStep, buildStrategyResult } from "./shared/step-utils.js";

interface TreeOfThoughtInput {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  readonly availableTools: readonly string[];
  readonly availableToolSchemas?: readonly ToolSchema[];
  readonly config: ReasoningConfig;
  /** Custom system prompt for steering agent behavior */
  readonly systemPrompt?: string;
  /** Task ID for event correlation */
  readonly taskId?: string;
  /** Tool result compression config */
  readonly resultCompression?: ResultCompressionConfig;
  /** Agent ID for tool execution attribution. Falls back to "reasoning-agent". */
  readonly agentId?: string;
  /** Session ID for tool execution attribution. Falls back to "reasoning-session". */
  readonly sessionId?: string;
  /** Tools that MUST be called before the agent can declare success */
  readonly requiredTools?: readonly string[];
  /** Max redirects when required tools are missing (default: 2) */
  readonly maxRequiredToolRetries?: number;
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
  ExecutionError,
  LLMService
> =>
  Effect.gen(function* () {
    const services = yield* resolveStrategyServices;
    const { llm, promptService, eventBus } = services;

    const { breadth, depth, pruningThreshold } =
      input.config.strategies.treeOfThought;
    const maxCost = input.config.strategies.treeOfThought.maxCost;
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

    steps.push(makeStep("thought", `[TOT] Starting tree exploration: breadth=${breadth}, depth=${depth}, pruningThreshold=${pruningThreshold}`));

    // ── BFS expansion ──
    for (let d = 1; d <= depth; d++) {
      const nextFrontier: ThoughtNode[] = [];

      // Budget guard: abort exploration if cost exceeds limit
      if (maxCost !== undefined && totalCost >= maxCost) {
        steps.push(makeStep("observation", `[TOT] Budget guard: cost $${totalCost.toFixed(4)} reached limit $${maxCost.toFixed(4)}. Stopping exploration.`));
        break;
      }

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
              promptService,
              "reasoning.tree-of-thought-expand",
              { task: input.taskDescription, breadth },
              input.systemPrompt
                ? `${input.systemPrompt}\n\nYou are exploring solution paths for: ${input.taskDescription}. Generate ${breadth} distinct approaches.`
                : `You are exploring solution paths for: ${input.taskDescription}. Generate ${breadth} distinct approaches.`,
            ),
            maxTokens: 800 * breadth,
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

        // Strip <think> blocks from expansion to prevent thinking from
        // being parsed as candidate thoughts.
        const candidates = parseCandidates(stripThinking(expansionResponse.content), breadth);

        // Score each candidate
        for (const candidate of candidates) {
          // Budget guard: abort scoring if cost exceeds limit
          if (maxCost !== undefined && totalCost >= maxCost) {
            steps.push(makeStep("observation", `[TOT] Budget guard: cost $${totalCost.toFixed(4)} reached limit $${maxCost.toFixed(4)}. Stopping scoring.`));
            break;
          }

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
                promptService,
                "reasoning.tree-of-thought-score",
                {},
                input.systemPrompt
                  ? `${input.systemPrompt}\n\nYou are evaluating a reasoning path. Rate its promise on a scale of 0.0 to 1.0. Respond with ONLY a number.`
                  : "You are evaluating a reasoning path. Rate its promise on a scale of 0.0 to 1.0. Respond with ONLY a number.",
              ),
              maxTokens: 1500,
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

          const score = parseScore(stripThinking(scoreResponse.content));

          const node: ThoughtNode = {
            id: ulid(),
            content: candidate,
            score,
            depth: d,
            parentId: parent.id,
          };

          allNodes.push(node);

          steps.push(makeStep("thought", `[TOT d=${d}] score=${score.toFixed(2)}: ${candidate.substring(0, 100)}...`));

          yield* publishReasoningStep(eventBus, {
            _tag: "ReasoningStepCompleted",
            taskId: input.taskId ?? "tree-of-thought",
            strategy: "tree-of-thought",
            step: steps.length,
            totalSteps: depth * breadth,
            thought: `[TOT d=${d}] score=${score.toFixed(2)}: ${candidate.substring(0, 100)}...`,
            kernelPass: "tree-of-thought:explore",
          });

          // Prune: only keep nodes above threshold
          if (score >= pruningThreshold) {
            nextFrontier.push(node);
          }
        }
      }

      // If all paths pruned, try adaptive pruning before giving up
      if (nextFrontier.length === 0) {
        // Adaptive pruning: lower threshold by 0.15 before giving up entirely
        const adaptiveThreshold = Math.max(0.15, pruningThreshold - 0.15);
        const nodesAtThisDepth = allNodes.filter((n) => n.depth === d);
        const rescued = nodesAtThisDepth
          .filter((n) => n.score >= adaptiveThreshold)
          .sort((a, b) => b.score - a.score)
          .slice(0, breadth);

        if (rescued.length > 0) {
          steps.push(makeStep("observation", `[TOT] Adaptive pruning at depth ${d}: threshold ${pruningThreshold} → ${adaptiveThreshold}, rescued ${rescued.length} path(s).`));
          frontier = rescued;
          continue;
        }

        // Log the adaptive attempt even when no paths could be rescued
        steps.push(makeStep("observation", `[TOT] Adaptive pruning at depth ${d}: threshold ${pruningThreshold} → ${adaptiveThreshold}, no paths above adaptive threshold. Selecting best from all explored nodes.`));
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
      return buildStrategyResult({
        strategy: "tree-of-thought",
        steps,
        output: null,
        status: "partial",
        start,
        totalTokens,
        totalCost,
      });
    }

    // Reconstruct the full path
    const bestPath = getAncestorPath(allNodes, bestLeaf);

    steps.push(makeStep("observation", `[TOT] Best path (score=${bestLeaf.score.toFixed(2)}): ${bestPath.join(" -> ")}`));

    // ── Phase 2: Execute best path using ReAct kernel ──
    const bestPathSummary = bestPath.join("\n→ ");
    const execState = yield* runKernel(reactKernel, {
      task: input.taskDescription,
      systemPrompt: input.systemPrompt
        ? `${input.systemPrompt}\n\nYou are a systematic problem solver. Execute the given approach to produce a final answer.`
        : "You are a systematic problem solver. Execute the given approach to produce a final answer.",
      availableToolSchemas: input.availableToolSchemas,
      priorContext: `Selected Approach (from planning phase):\n${bestPathSummary}`,
      resultCompression: input.resultCompression,
      temperature: 0.7,
      agentId: input.agentId,
      sessionId: input.sessionId,
      requiredTools: input.requiredTools,
      maxRequiredToolRetries: input.maxRequiredToolRetries,
    }, {
      maxIterations: input.config.strategies.treeOfThought?.depth ?? 3,
      strategy: "tree-of-thought",
      kernelType: "react",
      taskId: input.taskId,
      kernelPass: "tree-of-thought:execute",
    });

    totalTokens += execState.tokens;
    totalCost += execState.cost;
    steps.push(...execState.steps);
    const finalOutput = execState.output
      ?? [...execState.steps].filter((s) => s.type === "thought").pop()?.content
      ?? null;

    return buildStrategyResult({
      strategy: "tree-of-thought",
      steps,
      output: finalOutput || null,
      status: finalOutput ? "completed" : "partial",
      start,
      totalTokens,
      totalCost,
    });
  });

// ─── Private Helpers ───

function buildExpansionPrompt(
  input: TreeOfThoughtInput,
  parent: ThoughtNode,
  breadth: number,
  ancestorPath: string[],
): string {
  const contextStr = ancestorPath.length > 0
    ? `\nReasoning so far:\n${ancestorPath.join("\n→ ")}`
    : "";

  const toolStr =
    input.availableToolSchemas && input.availableToolSchemas.length > 0
      ? `\nAvailable tools: ${input.availableToolSchemas.map((t) => t.name).join(", ")}`
      : input.availableTools.length > 0
        ? `\nAvailable tools: ${input.availableTools.join(", ")}`
        : "";

  const toolHint = input.availableTools.length > 0
    ? " — reference specific tools where relevant"
    : "";

  return `Current thought: ${parent.content}${contextStr}${toolStr}

Generate exactly ${breadth} distinct next thoughts or approaches to continue solving this task.
Format each as a numbered item (1., 2., etc.).
Each should explore a meaningfully different direction${toolHint}.`;
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

