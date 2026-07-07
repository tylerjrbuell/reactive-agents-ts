import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { gatewayComplete } from "@reactive-agents/reasoning";
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
  /**
   * User-facing task output (what the user sees as the answer), when available.
   * The debrief model must treat this as authoritative when judging completeness
   * versus `taskPrompt`, especially when `finalAnswerCapture` is missing or has
   * no summary.
   */
  readonly finalOutputText?: string;
  /** Decision rationale events collected during execution (why agent made key choices) */
  readonly rationale?: readonly {
    readonly iteration: number;
    readonly decision: string;
    readonly toolName?: string;
    readonly rationale: { readonly why: string; readonly refs?: readonly string[]; readonly confidence?: number };
  }[];
}

/** Max characters of combined final output included in the debrief user prompt (token safety). */
const MAX_DEBRIEF_FINAL_OUTPUT_CHARS = 12_000;

function truncateForDebriefPrompt(text: string): string {
  const t = text.trim();
  if (t.length <= MAX_DEBRIEF_FINAL_OUTPUT_CHARS) return t;
  return `${t.slice(0, MAX_DEBRIEF_FINAL_OUTPUT_CHARS)}\n… [truncated ${t.length - MAX_DEBRIEF_FINAL_OUTPUT_CHARS} more characters]`;
}

function briefOutputFallback(text: string | undefined): string | undefined {
  const t = text?.trim();
  if (!t) return undefined;
  return t.length <= 400 ? t : `${t.slice(0, 400)}…`;
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
  metrics: {
    tokens: number;
    duration: number;
    iterations: number;
    cost: number;
    /**
     * GH #143 (honesty fix) — tokens consumed by the debrief LLM call
     * itself. Populated by synthesizeDebrief when the call succeeds;
     * absent when the fallback path was taken (no LLM call happened).
     * Consumers MUST aggregate these into the run's reported
     * `tokensUsed` so token accounting reflects every LLM call the
     * framework made on the user's behalf — not just the reasoning loop.
     * Bench undercounts pre-this-fix were ~5× on local-tier trivial.
     */
    synthesisTokens?: {
      readonly input: number;
      readonly output: number;
      readonly total: number;
      readonly cost: number;
    };
  };
  /**
   * Decision rationale events captured from tool calls during execution.
   * Each entry records why the agent picked a tool at a given iteration.
   * Empty array when the model never emitted rationale.
   */
  rationale: readonly {
    readonly iteration: number;
    readonly decision: string;
    readonly toolName?: string;
    readonly rationale: { readonly why: string; readonly refs?: readonly string[]; readonly confidence?: number };
  }[];
  /** Pre-rendered markdown version of the full debrief report */
  markdown: string;
}

/**
 * Wrapper returned by `synthesizeDebrief` so the engine can attribute the
 * debrief LLM call's token cost into `ctx.tokensUsed` instead of dropping
 * it on the floor. See GH #143 — bench undercounted RA by ~5x on local
 * tier because debrief tokens were never aggregated.
 */
export interface DebriefResult {
  readonly debrief: AgentDebrief;
  /** Tokens consumed by the debrief LLM call. Zero when the synthetic-fallback path was used. */
  readonly tokensUsed: number;
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
}

The user message may include a "Final output" section. That text is what the user actually received as the task answer.
You MUST align your summary with it: if it substantively answers the task (relative to the stated task), say so clearly and do NOT claim that no answer or summary was produced. Multiple tool calls are not evidence of failure by themselves.`;

/**
 * Build a debrief from captured execution signals WITHOUT calling the LLM.
 *
 * Mirrors the same shape `synthesizeDebrief` returns, but uses the data
 * already in `DebriefInput` instead of asking the LLM to summarize it.
 * Used in two situations:
 *
 *  1. Trivial-task gate (#143): when output is short (<100 chars), no tools
 *     were called, and no errors fired, the LLM call adds no information the
 *     fallback couldn't synthesize from the captured data — and on local
 *     tier (qwen3.5:latest) 52% of those calls hit `max_tokens` and produce
 *     empty content anyway. Skip the LLM, use this builder, save ~825 tok/task.
 *
 *  2. LLM-call failure: the catchAll inside `synthesizeDebrief` already uses
 *     this shape; centralizing the construction here avoids the divergence
 *     between the in-place fallback at the old catchAll site and the new
 *     trivial-task path.
 */
export function buildFallbackDebrief(input: DebriefInput): AgentDebrief {
  const outcome = deriveOutcome(input.terminatedBy, input.errorsFromLoop);
  const summary =
    input.finalAnswerCapture?.summary ??
    briefOutputFallback(input.finalOutputText) ??
    "Task completed.";
  const toolsUsed = input.toolCallHistory.map((t) => ({
    name: t.name,
    calls: t.calls,
    successRate: t.calls > 0 ? (t.calls - t.errors) / t.calls : 1,
  }));
  const debrief: Omit<AgentDebrief, "markdown"> = {
    outcome,
    summary,
    keyFindings: [],
    errorsEncountered: [...input.errorsFromLoop].filter((e, i, arr) => arr.indexOf(e) === i),
    lessonsLearned: [],
    confidence:
      (input.finalAnswerCapture?.confidence as AgentDebrief["confidence"]) ??
      (input.finalOutputText?.trim().length ? "high" : "medium"),
    caveats: undefined,
    toolsUsed,
    metrics: input.metrics,
    rationale: input.rationale ?? [],
  };
  return { ...debrief, markdown: formatDebriefMarkdown(debrief) };
}

export function synthesizeDebrief(
  input: DebriefInput,
): Effect.Effect<DebriefResult, Error, LLMService> {
  return Effect.gen(function* () {
    const llm = yield* LLMService;
    const outcome = deriveOutcome(input.terminatedBy, input.errorsFromLoop);

    const toolSummary =
      input.toolCallHistory
        .map((t) => `- ${t.name}: ${t.calls} call(s), ${t.errors} error(s), avg ${t.avgDurationMs}ms`)
        .join("\n") || "No tools called";

    const summaryFromCapture = input.finalAnswerCapture?.summary?.trim();
    const captureOutput =
      typeof input.finalAnswerCapture?.output === "string"
        ? input.finalAnswerCapture.output.trim()
        : "";
    const finalShown = (input.finalOutputText ?? "").trim();
    const authoritativeOutput = truncateForDebriefPrompt(finalShown || captureOutput);

    const agentSelfReport =
      summaryFromCapture && summaryFromCapture.length > 0
        ? summaryFromCapture
        : captureOutput.length > 0
          ? `No summary field on final-answer capture; opening of final-answer output:\n${truncateForDebriefPrompt(captureOutput)}`
          : finalShown.length > 0
            ? "No final-answer tool metadata; user-facing output is in the Final output section below."
            : "No self-report or final output was recorded.";

    const rationaleSection =
      input.rationale && input.rationale.length > 0
        ? `Decision rationale (why the agent made key choices):\n${input.rationale
            .map(
              (r) =>
                `- Iteration ${r.iteration}: ${r.decision}${r.toolName ? ` (${r.toolName})` : ""}\n  Why: ${r.rationale.why}${
                  r.rationale.confidence !== undefined ? ` (confidence: ${(r.rationale.confidence * 100).toFixed(0)}%)` : ""
                }`
            )
            .join("\n")}`
        : "";

    const userPrompt = [
      `Task: ${input.taskPrompt}`,
      `Agent self-report (from final-answer metadata when present): ${agentSelfReport}`,
      `Final output (authoritative — what the user received as the task answer):\n${authoritativeOutput || "(none — empty)"}`,
      `Terminated by: ${input.terminatedBy}`,
      `Tools used:\n${toolSummary}`,
      `Errors from loop: ${input.errorsFromLoop.join("; ") || "none"}`,
      rationaleSection,
      `Total iterations: ${input.metrics.iterations}`,
      `Total tokens: ${input.metrics.tokens}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    // Debrief JSON is deliberately tiny — 512 tokens, below any gateway class.
    const llmResponse = yield* gatewayComplete(llm, { purpose: "extract", budgetTokens: 512 }, {
        messages: [{ role: "user", content: userPrompt }],
        systemPrompt: DEBRIEF_SYSTEM_PROMPT,
        temperature: 0.2,
      })
      .pipe(
        Effect.catchAll(() =>
          Effect.succeed({
            content: JSON.stringify({
              summary:
                input.finalAnswerCapture?.summary ??
                briefOutputFallback(input.finalOutputText) ??
                "Task completed.",
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
        summary:
          input.finalAnswerCapture?.summary ??
          briefOutputFallback(input.finalOutputText) ??
          "Task completed.",
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
      summary:
        parsed.summary ??
        input.finalAnswerCapture?.summary ??
        briefOutputFallback(input.finalOutputText) ??
        "Task completed.",
      keyFindings: Array.isArray(parsed.keyFindings) ? parsed.keyFindings : [],
      errorsEncountered: [
        ...(Array.isArray(parsed.errorsEncountered) ? parsed.errorsEncountered : []),
        ...input.errorsFromLoop,
      ].filter((e, i, arr) => arr.indexOf(e) === i), // deduplicate
      lessonsLearned: Array.isArray(parsed.lessonsLearned) ? parsed.lessonsLearned : [],
      confidence:
        (input.finalAnswerCapture?.confidence as AgentDebrief["confidence"]) ??
        (input.finalOutputText?.trim().length ? "high" : "medium"),
      caveats: parsed.caveats || undefined,
      toolsUsed,
      // GH #143 honesty fix — fold the debrief LLM's own usage into
      // metrics.synthesisTokens so callers can aggregate it into the
      // run's reported tokensUsed. Skipped when the fallback path was
      // taken (usage is zeroed there at the `.complete().catchAll(...)`
      // recovery block — totalTokens === 0 is the signal).
      metrics: {
        ...input.metrics,
        ...(llmResponse.usage.totalTokens > 0
          ? {
              synthesisTokens: {
                input: llmResponse.usage.inputTokens ?? 0,
                output: llmResponse.usage.outputTokens ?? 0,
                total: llmResponse.usage.totalTokens,
                cost: llmResponse.usage.estimatedCost ?? 0,
              },
            }
          : {}),
      },
      rationale: input.rationale ?? [],
    };

    const tokensUsed = llmResponse.usage?.totalTokens ?? 0;
    return {
      debrief: { ...debrief, markdown: formatDebriefMarkdown(debrief) },
      tokensUsed,
    };
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

  if (d.rationale.length > 0) {
    lines.push("## Decision Rationale", "");
    for (const r of d.rationale) {
      const conf =
        r.rationale.confidence !== undefined
          ? ` _(confidence: ${(r.rationale.confidence * 100).toFixed(0)}%)_`
          : "";
      const tool = r.toolName ? ` \`${r.toolName}\`` : "";
      lines.push(`- **Iteration ${r.iteration}** — ${r.decision}${tool}${conf}`);
      lines.push(`  - Why: ${r.rationale.why}`);
      if (r.rationale.refs && r.rationale.refs.length > 0) {
        lines.push(`  - Refs: ${r.rationale.refs.join(", ")}`);
      }
    }
    lines.push("");
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
