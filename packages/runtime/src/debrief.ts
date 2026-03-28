import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { FinalAnswerCapture } from "@reactive-agents/tools";

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * Aggregated statistics for a single tool across all calls during an execution.
 *
 * Used by `DebriefInput` to summarize tool usage for the debrief synthesis prompt.
 */
export interface ToolCallStat {
  /** Tool name */
  name: string;
  /** Total number of times this tool was called */
  calls: number;
  /** Number of calls that resulted in an error */
  errors: number;
  /** Average execution time across all calls in milliseconds */
  avgDurationMs: number;
}

/**
 * Input to the `synthesizeDebrief` function — raw execution signals collected
 * by the ExecutionEngine after the reasoning loop exits.
 */
export interface DebriefInput {
  /** The original task prompt the agent was given */
  taskPrompt: string;
  /** Agent identifier */
  agentId: string;
  /** Task identifier */
  taskId: string;
  /** How the agent loop terminated */
  terminatedBy: "final_answer_tool" | "final_answer" | "max_iterations" | "end_turn" | "llm_error";
  /** Structured capture from the `final-answer` tool (if used) */
  finalAnswerCapture?: FinalAnswerCapture;
  /** Per-tool aggregated call statistics */
  toolCallHistory: ToolCallStat[];
  /** Error messages collected during loop execution */
  errorsFromLoop: string[];
  /** Quantitative execution metrics */
  metrics: { tokens: number; duration: number; iterations: number; cost: number };
}

/**
 * Structured post-run analysis produced by `synthesizeDebrief`.
 *
 * Generated via a single small LLM call after execution completes.
 * Included in `AgentResult.debrief` when memory is enabled.
 * Persisted to SQLite via `DebriefStore` (`agent_debriefs` table) when memory is enabled.
 *
 * @example
 * ```typescript
 * const result = await agent.run("Research TypeScript frameworks");
 * if (result.debrief) {
 *   console.log(result.debrief.outcome);      // "success"
 *   console.log(result.debrief.summary);      // "The agent researched..."
 *   console.log(result.debrief.keyFindings);  // ["Finding 1", ...]
 *   console.log(result.debrief.markdown);     // Pre-rendered markdown report
 * }
 * ```
 */
export interface AgentDebrief {
  /** Overall execution outcome */
  outcome: "success" | "partial" | "failed";
  /** One-paragraph summary of what the agent did and accomplished */
  summary: string;
  /** Key facts or results discovered during execution */
  keyFindings: string[];
  /** Errors encountered during execution (tool failures, guardrail blocks, etc.) */
  errorsEncountered: string[];
  /** Lessons learned that may improve future executions on similar tasks */
  lessonsLearned: string[];
  /** Agent's self-assessed confidence in the result */
  confidence: "high" | "medium" | "low";
  /** Caveats or limitations of the result (undefined if none) */
  caveats?: string;
  /** Summary of tools used with call counts and success rates */
  toolsUsed: { name: string; calls: number; successRate: number }[];
  /** Quantitative execution metrics */
  metrics: { tokens: number; duration: number; iterations: number; cost: number };
  /** Pre-rendered markdown version of the full debrief report */
  markdown: string;
}

// ─── Outcome derivation ────────────────────────────────────────────────────

function deriveOutcome(
  terminatedBy: DebriefInput["terminatedBy"],
  errorsFromLoop: string[],
): AgentDebrief["outcome"] {
  if (terminatedBy === "llm_error") {
    return "failed";
  }
  // max_iterations — incomplete work without provider failure
  if (terminatedBy === "max_iterations") {
    return "partial";
  }
  // final_answer, final_answer_tool, end_turn — clean terminations
  return errorsFromLoop.length > 0 ? "partial" : "success";
}

// ─── LLM synthesis ────────────────────────────────────────────────────────

const DEBRIEF_SYSTEM_PROMPT = `You are summarizing an AI agent's completed task for a structured debrief record.
Return ONLY a JSON object — no prose, no markdown fences — with exactly these fields:
{
  "summary": "2-3 sentence narrative of what was accomplished",
  "keyFindings": ["finding 1", "finding 2"],
  "errorsEncountered": ["error description if any"],
  "lessonsLearned": ["actionable lesson for future runs"],
  "caveats": "anything uncertain, incomplete, or worth flagging (empty string if none)"
}`;

export function synthesizeDebrief(
  input: DebriefInput,
): Effect.Effect<AgentDebrief, Error, LLMService> {
  return Effect.gen(function* () {
    const llm = yield* LLMService;
    const outcome = deriveOutcome(input.terminatedBy, input.errorsFromLoop);

    const toolSummary =
      input.toolCallHistory
        .map((t) => `- ${t.name}: ${t.calls} call(s), ${t.errors} error(s), avg ${t.avgDurationMs}ms`)
        .join("\n") || "No tools called";

    const userPrompt = [
      `Task: ${input.taskPrompt}`,
      `Agent self-report: ${input.finalAnswerCapture?.summary ?? "No self-report provided"}`,
      `Terminated by: ${input.terminatedBy}`,
      `Tools used:\n${toolSummary}`,
      `Errors from loop: ${input.errorsFromLoop.join("; ") || "none"}`,
      `Total iterations: ${input.metrics.iterations}`,
      `Total tokens: ${input.metrics.tokens}`,
    ].join("\n\n");

    const llmResponse = yield* llm
      .complete({
        messages: [{ role: "user", content: userPrompt }],
        systemPrompt: DEBRIEF_SYSTEM_PROMPT,
        temperature: 0.2,
        maxTokens: 512,
      })
      .pipe(
        Effect.catchAll(() =>
          Effect.succeed({
            content: JSON.stringify({
              summary: input.finalAnswerCapture?.summary ?? "Task completed.",
              keyFindings: [],
              errorsEncountered: input.errorsFromLoop,
              lessonsLearned: [],
              caveats: "",
            }),
            stopReason: "end_turn" as const,
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 },
            model: "fallback",
          }),
        ),
      );

    let parsed: {
      summary: string;
      keyFindings: string[];
      errorsEncountered: string[];
      lessonsLearned: string[];
      caveats: string;
    };

    try {
      const cleaned = llmResponse.content
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // Fallback: use agent self-report when LLM returns non-parseable output
      parsed = {
        summary: input.finalAnswerCapture?.summary ?? "Task completed.",
        keyFindings: [],
        errorsEncountered: input.errorsFromLoop,
        lessonsLearned: [],
        caveats: "",
      };
    }

    const toolsUsed = input.toolCallHistory.map((t) => ({
      name: t.name,
      calls: t.calls,
      successRate: t.calls > 0 ? (t.calls - t.errors) / t.calls : 1,
    }));

    const debrief: Omit<AgentDebrief, "markdown"> = {
      outcome,
      summary: parsed.summary ?? input.finalAnswerCapture?.summary ?? "Task completed.",
      keyFindings: Array.isArray(parsed.keyFindings) ? parsed.keyFindings : [],
      errorsEncountered: [
        ...(Array.isArray(parsed.errorsEncountered) ? parsed.errorsEncountered : []),
        ...input.errorsFromLoop,
      ].filter((e, i, arr) => arr.indexOf(e) === i), // deduplicate
      lessonsLearned: Array.isArray(parsed.lessonsLearned) ? parsed.lessonsLearned : [],
      confidence: (input.finalAnswerCapture?.confidence as AgentDebrief["confidence"]) ?? "medium",
      caveats: parsed.caveats || undefined,
      toolsUsed,
      metrics: input.metrics,
    };

    return { ...debrief, markdown: formatDebriefMarkdown(debrief) };
  });
}

// ─── Markdown renderer ─────────────────────────────────────────────────────

export function formatDebriefMarkdown(d: Omit<AgentDebrief, "markdown">): string {
  const outcomeEmoji = d.outcome === "success" ? "✅" : d.outcome === "partial" ? "⚠️" : "❌";
  const lines: string[] = [
    `# Agent Debrief ${outcomeEmoji}`,
    "",
    `**Outcome:** ${d.outcome} | **Confidence:** ${d.confidence}`,
    "",
    "## Summary",
    "",
    d.summary,
    "",
  ];

  if (d.keyFindings.length > 0) {
    lines.push("## Key Findings", "");
    for (const f of d.keyFindings) lines.push(`- ${f}`);
    lines.push("");
  }

  if (d.errorsEncountered.length > 0) {
    lines.push("## Errors Encountered", "");
    for (const e of d.errorsEncountered) lines.push(`- ${e}`);
    lines.push("");
  }

  if (d.lessonsLearned.length > 0) {
    lines.push("## Lessons Learned", "");
    for (const l of d.lessonsLearned) lines.push(`- ${l}`);
    lines.push("");
  }

  if (d.caveats) {
    lines.push("## Caveats", "", d.caveats, "");
  }

  lines.push("## Tools Used", "");
  if (d.toolsUsed.length === 0) {
    lines.push("No tools called.", "");
  } else {
    for (const t of d.toolsUsed) {
      const pct = Math.round(t.successRate * 100);
      lines.push(`- \`${t.name}\`: ${t.calls} call(s), ${pct}% success`);
    }
    lines.push("");
  }

  lines.push(
    "## Metrics",
    "",
    `- Tokens: ${d.metrics.tokens.toLocaleString()}`,
    `- Duration: ${(d.metrics.duration / 1000).toFixed(1)}s`,
    `- Iterations: ${d.metrics.iterations}`,
    `- Cost: $${d.metrics.cost.toFixed(4)}`,
  );

  return lines.join("\n");
}
