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
import { ToolService } from "@reactive-agents/tools";
import { PromptService } from "@reactive-agents/prompts";
import { EventBus } from "@reactive-agents/core";

interface TotToolSchema {
  readonly name: string;
  readonly description: string;
  readonly parameters: readonly { name: string; type: string; description: string; required: boolean }[];
}

interface TreeOfThoughtInput {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  readonly availableTools: readonly string[];
  readonly availableToolSchemas?: readonly TotToolSchema[];
  readonly config: ReasoningConfig;
  /** Custom system prompt for steering agent behavior */
  readonly systemPrompt?: string;
  /** Task ID for event correlation */
  readonly taskId?: string;
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
    const promptServiceOptRaw = yield* Effect.serviceOption(PromptService).pipe(
      Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
    );
    const promptServiceOpt = promptServiceOptRaw as PromptServiceOpt;
    const ebOptRaw = yield* Effect.serviceOption(EventBus).pipe(
      Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
    );
    const ebOpt = ebOptRaw as typeof ebOptRaw;
    const toolServiceOptRaw = yield* Effect.serviceOption(ToolService).pipe(
      Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
    );
    const toolServiceOpt = toolServiceOptRaw as TotToolServiceOpt;
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
              input.systemPrompt
                ? `${input.systemPrompt}\n\nYou are exploring solution paths for: ${input.taskDescription}. Generate ${breadth} distinct approaches.`
                : `You are exploring solution paths for: ${input.taskDescription}. Generate ${breadth} distinct approaches.`,
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
                input.systemPrompt
                  ? `${input.systemPrompt}\n\nYou are evaluating a reasoning path. Rate its promise on a scale of 0.0 to 1.0. Respond with ONLY a number.`
                  : "You are evaluating a reasoning path. Rate its promise on a scale of 0.0 to 1.0. Respond with ONLY a number.",
              ),
              maxTokens: 800,
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

          if (ebOpt._tag === "Some") {
            yield* ebOpt.value.publish({
              _tag: "ReasoningStepCompleted",
              taskId: input.taskId ?? "tree-of-thought",
              strategy: "tree-of-thought",
              step: steps.length,
              totalSteps: depth * breadth,
              thought: `[TOT d=${d}] score=${score.toFixed(2)}: ${candidate.substring(0, 100)}...`,
            }).pipe(Effect.catchAll(() => Effect.void));
          }

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
          steps.push({
            id: ulid() as StepId,
            type: "observation",
            content: `[TOT] Adaptive pruning at depth ${d}: threshold ${pruningThreshold} → ${adaptiveThreshold}, rescued ${rescued.length} path(s).`,
            timestamp: new Date(),
          });
          frontier = rescued;
          continue;
        }

        // Log the adaptive attempt even when no paths could be rescued
        steps.push({
          id: ulid() as StepId,
          type: "observation",
          content: `[TOT] Adaptive pruning at depth ${d}: threshold ${pruningThreshold} → ${adaptiveThreshold}, no paths above adaptive threshold. Selecting best from all explored nodes.`,
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

    // ── Phase 2: Execute the selected plan with tools ──
    // Tree search determined the best approach; now execute it using a
    // ReAct-style think/act/observe loop with real tool access.
    const execMaxIter = input.config.strategies.reactive.maxIterations;
    let execIter = 0;

    while (execIter < execMaxIter) {
      // Compact history: cap at last 8 non-TOT steps to prevent unbounded context growth
      const rawHistory = steps.filter((s) => !s.content.startsWith("[TOT ") && !s.content.startsWith("[TOT]"));
      const recentHistory = rawHistory.slice(-8);
      const history = recentHistory
        .map((s) =>
          s.type === "observation"
            ? `Observation: ${s.content}`
            : s.type === "action"
              ? `Action: ${s.content}`
              : s.content,
        )
        .join("\n");

      const execResponse = yield* llm
        .complete({
          messages: [
            {
              role: "user",
              content: totBuildExecPrompt(input, bestPath, history),
            },
          ],
          systemPrompt: input.systemPrompt
            ? `${input.systemPrompt}\n\nYou are executing a task. Use tools as needed, then give FINAL ANSWER: <answer>.`
            : "You are executing a task. Use tools as needed, then give FINAL ANSWER: <answer>.",
          maxTokens: 1500,
          temperature: input.config.strategies.reactive.temperature,
          stopSequences: ["Observation:", "\nObservation:"],
        })
        .pipe(
          Effect.mapError(
            (err) =>
              new ExecutionError({
                strategy: "tree-of-thought",
                message: `Execution failed at iter ${execIter}`,
                step: execIter,
                cause: err,
              }),
          ),
        );

      totalTokens += execResponse.usage.totalTokens;
      totalCost += execResponse.usage.estimatedCost;

      const thought = execResponse.content;

      steps.push({
        id: ulid() as StepId,
        type: "thought",
        content: thought,
        timestamp: new Date(),
      });

      if (ebOpt._tag === "Some") {
        yield* ebOpt.value
          .publish({
            _tag: "ReasoningStepCompleted",
            taskId: input.taskId ?? "tree-of-thought",
            strategy: "tree-of-thought",
            step: steps.length,
            totalSteps: execMaxIter,
            thought,
          })
          .pipe(Effect.catchAll(() => Effect.void));
      }

      // ── Check for tool call ──
      const allReqs = totParseAllToolRequests(thought);
      const toolReq = allReqs[0] ?? null;

      // ── Check for final answer (no pending action) ──
      if (!toolReq && totHasFinalAnswer(thought)) {
        const answer = totExtractFinalAnswer(thought);
        if (ebOpt._tag === "Some") {
          yield* ebOpt.value
            .publish({
              _tag: "FinalAnswerProduced",
              taskId: input.taskId ?? "tree-of-thought",
              strategy: "tree-of-thought",
              answer,
              iteration: execIter,
              totalTokens,
            })
            .pipe(Effect.catchAll(() => Effect.void));
        }
        return buildResult(steps, answer, "completed", start, totalTokens, totalCost);
      }

      if (toolReq) {
        steps.push({
          id: ulid() as StepId,
          type: "action",
          content: JSON.stringify(toolReq),
          timestamp: new Date(),
          metadata: { toolUsed: toolReq.tool },
        });

        if (ebOpt._tag === "Some") {
          yield* ebOpt.value
            .publish({
              _tag: "ReasoningStepCompleted",
              taskId: input.taskId ?? "tree-of-thought",
              strategy: "tree-of-thought",
              step: steps.length,
              totalSteps: execMaxIter,
              action: JSON.stringify(toolReq),
            })
            .pipe(Effect.catchAll(() => Effect.void));
        }

        const toolStartMs = Date.now();
        const observation = yield* totExecTool(toolServiceOpt, toolReq.tool, toolReq.input);
        const toolDurationMs = Date.now() - toolStartMs;

        if (ebOpt._tag === "Some") {
          yield* ebOpt.value
            .publish({
              _tag: "ToolCallCompleted",
              taskId: input.taskId ?? "tree-of-thought",
              toolName: toolReq.tool,
              callId: steps[steps.length - 1]?.id ?? "unknown",
              durationMs: toolDurationMs,
              success: !observation.startsWith("[Tool error"),
            })
            .pipe(Effect.catchAll(() => Effect.void));
        }

        steps.push({
          id: ulid() as StepId,
          type: "observation",
          content: observation,
          timestamp: new Date(),
        });

        if (ebOpt._tag === "Some") {
          yield* ebOpt.value
            .publish({
              _tag: "ReasoningStepCompleted",
              taskId: input.taskId ?? "tree-of-thought",
              strategy: "tree-of-thought",
              step: steps.length,
              totalSteps: execMaxIter,
              observation,
            })
            .pipe(Effect.catchAll(() => Effect.void));
        }

        if (totHasFinalAnswer(thought)) {
          const answer = totExtractFinalAnswer(thought);
          if (ebOpt._tag === "Some") {
            yield* ebOpt.value
              .publish({
                _tag: "FinalAnswerProduced",
                taskId: input.taskId ?? "tree-of-thought",
                strategy: "tree-of-thought",
                answer,
                iteration: execIter,
                totalTokens,
              })
              .pipe(Effect.catchAll(() => Effect.void));
          }
          return buildResult(steps, answer, "completed", start, totalTokens, totalCost);
        }
      }

      execIter++;
    }

    // Max iterations reached — return last thought as partial output
    const lastThought = steps.filter((s) => s.type === "thought").pop()?.content ?? null;
    return buildResult(steps, lastThought, "partial", start, totalTokens, totalCost);
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

function parseScore(text: string): number {
  // Strip think tags (some LLMs wrap reasoning in <think>...</think>)
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const target = stripped.length > 0 ? stripped : text.trim();
  if (target.length === 0) return 0.5;

  // "75%" → 0.75
  const pctMatch = target.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pctMatch) return Math.max(0, Math.min(1, parseFloat(pctMatch[1]!) / 100));

  // "4/5" or "3/4" → ratio
  const ratioMatch = target.match(/\b(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\b/);
  if (ratioMatch) {
    const num = parseFloat(ratioMatch[1]!);
    const den = parseFloat(ratioMatch[2]!);
    if (den > 0) return Math.max(0, Math.min(1, num / den));
  }

  // "Score: 0.8", "Rating: 7" (0–10 scale if > 1)
  const labeledMatch = target.match(/(?:score|rating|value|grade)\s*[:=]\s*(\d+(?:\.\d+)?)/i);
  if (labeledMatch) {
    const val = parseFloat(labeledMatch[1]!);
    return Math.max(0, Math.min(1, val > 1 ? val / 10 : val));
  }

  // Standard decimal: "0.75", ".75", "1.0", "0", "1"
  const decMatch = target.match(/\b(1\.0*|0?\.\d+|[01])\b/);
  if (decMatch) return Math.max(0, Math.min(1, parseFloat(decMatch[1]!)));

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

// ─── Execution-phase helpers (Phase 2: plan execution with tools) ───

type TotToolServiceOpt =
  | {
      _tag: "Some";
      value: {
        execute: (input: {
          toolName: string;
          arguments: Record<string, unknown>;
          agentId: string;
          sessionId: string;
        }) => Effect.Effect<{ result: unknown; success?: boolean }, unknown>;
      };
    }
  | { _tag: "None" };

function totFormatToolSchema(tool: TotToolSchema): string {
  if (tool.parameters.length === 0) return `- ${tool.name}() — ${tool.description}`;
  const params = tool.parameters
    .map((p) => `"${p.name}": "${p.type}${p.required ? " (required)" : " (optional)"}"`)
    .join(", ");
  return `- ${tool.name}({${params}}) — ${tool.description}`;
}

function totBuildExecPrompt(
  input: TreeOfThoughtInput,
  bestPath: string[],
  history: string,
): string {
  const toolSection =
    input.availableToolSchemas && input.availableToolSchemas.length > 0
      ? `Available Tools:\n${input.availableToolSchemas.map(totFormatToolSchema).join("\n")}\n\nTo use a tool: ACTION: tool_name({"param": "value"}) — exact JSON`
      : input.availableTools.length > 0
        ? `Available Tools: ${input.availableTools.join(", ")}\nTo use a tool: ACTION: tool_name({"param": "value"})`
        : "No tools available.";

  const planSection = `Selected Approach (from planning phase):\n${bestPath.join("\n→ ")}`;
  const historySection = history ? `\nExecution so far:\n${history}` : "";

  return `Task: ${input.taskDescription}

${planSection}

${toolSection}

RULES:
1. ONE action per turn: ACTION: tool_name({"param": "value"})
2. Use EXACT parameter names from tools above.
3. When all steps are done: FINAL ANSWER: <your answer>
4. Do NOT fabricate tool results — wait for real observations.${historySection}

Think step-by-step, then take ONE action or give FINAL ANSWER:`;
}

function totParseToolRequest(thought: string): { tool: string; input: string } | null {
  const prefixMatch = thought.match(/ACTION:\s*([\w\/\-]+)\(/i);
  if (!prefixMatch) return null;
  const tool = prefixMatch[1]!;
  const argsStart = (prefixMatch.index ?? 0) + prefixMatch[0].length;
  const rest = thought.slice(argsStart);
  if (rest.trimStart().startsWith(")")) return { tool, input: "{}" };
  if (rest.trimStart().startsWith("{")) {
    const trimOffset = rest.length - rest.trimStart().length;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = trimOffset; i < rest.length; i++) {
      const ch = rest[i]!;
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth++;
      if (ch === "}") { depth--; if (depth === 0) return { tool, input: rest.slice(trimOffset, i + 1) }; }
    }
  }
  const match = thought.match(/ACTION:\s*[\w\/\-]+\((.*?)\)/is);
  return match ? { tool, input: match[1]! } : null;
}

function totParseAllToolRequests(thought: string): Array<{ tool: string; input: string }> {
  const results: Array<{ tool: string; input: string }> = [];
  const re = /ACTION:/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(thought)) !== null) {
    const req = totParseToolRequest(thought.slice(match.index));
    if (req) results.push(req);
  }
  return results;
}

function totHasFinalAnswer(thought: string): boolean {
  return /final answer:/i.test(thought);
}

function totExtractFinalAnswer(thought: string): string {
  const match = thought.match(/final answer:\s*([\s\S]*)/i);
  return match ? match[1]!.trim() : thought;
}

function totExecTool(
  toolServiceOpt: TotToolServiceOpt,
  toolName: string,
  argsStr: string,
): Effect.Effect<string, never> {
  if (toolServiceOpt._tag === "None") {
    return Effect.succeed("[ToolService not available — add .withTools() to agent builder]");
  }
  const toolService = toolServiceOpt.value;
  let args: Record<string, unknown> = {};
  const trimmed = argsStr.trim();
  if (trimmed && trimmed !== "{}") {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch { /* malformed JSON — proceed with empty args */ }
  }
  return toolService
    .execute({ toolName, arguments: args, agentId: "tot-agent", sessionId: "tot-session" })
    .pipe(
      Effect.map((r) => {
        const raw = typeof r.result === "string" ? r.result : JSON.stringify(r.result);
        if (raw.length > 800) {
          return `${raw.slice(0, 400)}\n[...${raw.length - 800} chars omitted...]\n${raw.slice(-400)}`;
        }
        return raw;
      }),
      Effect.catchAll((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        return Effect.succeed(`[Tool error: ${msg}]`);
      }),
    );
}
