import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { FinalAnswerCapture } from "@reactive-agents/tools";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ToolCallStat {
  name: string;
  calls: number;
  errors: number;
  avgDurationMs: number;
}

export interface DebriefInput {
  taskPrompt: string;
  agentId: string;
  taskId: string;
  terminatedBy: "final_answer_tool" | "final_answer" | "max_iterations" | "end_turn";
  finalAnswerCapture?: FinalAnswerCapture;
  toolCallHistory: ToolCallStat[];
  errorsFromLoop: string[];
  metrics: { tokens: number; duration: number; iterations: number; cost: number };
}

export interface AgentDebrief {
  outcome: "success" | "partial" | "failed";
  summary: string;
  keyFindings: string[];
  errorsEncountered: string[];
  lessonsLearned: string[];
  confidence: "high" | "medium" | "low";
  caveats?: string;
  toolsUsed: { name: string; calls: number; successRate: number }[];
  metrics: { tokens: number; duration: number; iterations: number; cost: number };
  markdown: string;
}

// ─── Outcome derivation ────────────────────────────────────────────────────

function deriveOutcome(
  terminatedBy: DebriefInput["terminatedBy"],
  errorsFromLoop: string[],
): AgentDebrief["outcome"] {
  if (terminatedBy === "final_answer_tool" || terminatedBy === "final_answer") {
    return errorsFromLoop.length > 0 ? "partial" : "success";
  }
  return "partial";
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
