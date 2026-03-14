import type { ContextPressure, ContextSection } from "../types.js";

/** Estimate token count from text. Matches @reactive-agents/core: ceil(length / 4). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function computeContextPressure(params: {
  systemPrompt: string;
  toolResults: readonly string[];
  history: readonly string[];
  taskDescription: string;
  contextLimit: number;
  skillInstructions?: string;
}): ContextPressure {
  const { systemPrompt, toolResults, history, taskDescription, contextLimit, skillInstructions } = params;

  const sections: ContextSection[] = [];

  // Task — always highest signal
  const taskTokens = estimateTokens(taskDescription);
  sections.push({ label: "task", tokenEstimate: taskTokens, signalDensity: 1.0, position: "near" });

  // System prompt
  if (systemPrompt) {
    const spTokens = estimateTokens(systemPrompt);
    sections.push({ label: "system-prompt", tokenEstimate: spTokens, signalDensity: 0.7, position: "near" });
  }

  // Skill instructions
  if (skillInstructions) {
    const skillTokens = estimateTokens(skillInstructions);
    sections.push({ label: "skill", tokenEstimate: skillTokens, signalDensity: 0.8, position: "near" });
  }

  // Tool results — signal density decays with age
  if (toolResults.length > 0) {
    const totalToolTokens = toolResults.reduce((sum, r) => sum + estimateTokens(r), 0);
    // Decay: most recent = 1.0, older decays linearly
    const avgAge = toolResults.length > 1 ? 0.5 : 0; // rough midpoint
    const signalDensity = Math.max(0.3, 1.0 - avgAge * 0.4);
    sections.push({
      label: "tool-results",
      tokenEstimate: totalToolTokens,
      signalDensity,
      position: toolResults.length > 3 ? "mid" : "near",
    });
  }

  // History — signal density decays with iteration distance
  if (history.length > 0) {
    const totalHistoryTokens = history.reduce((sum, h) => sum + estimateTokens(h), 0);
    const signalDensity = Math.max(0.2, 1.0 - (history.length * 0.1));
    sections.push({
      label: "history",
      tokenEstimate: totalHistoryTokens,
      signalDensity,
      position: history.length > 5 ? "far" : "mid",
    });
  }

  const totalTokens = sections.reduce((sum, s) => sum + s.tokenEstimate, 0);
  const utilizationPct = contextLimit > 0 ? totalTokens / contextLimit : 0;

  // At-risk sections: those near truncation boundary (>80% utilization)
  const atRiskSections: string[] = [];
  if (utilizationPct > 0.8) {
    // Sections with lowest signal density are most at risk
    const sorted = [...sections].sort((a, b) => a.signalDensity - b.signalDensity);
    for (const s of sorted) {
      if (s.signalDensity < 0.8) atRiskSections.push(s.label);
    }
  }

  // Compression headroom: sum of tokens from low-signal sections
  const compressionHeadroom = sections
    .filter((s) => s.signalDensity < 0.7)
    .reduce((sum, s) => sum + Math.floor(s.tokenEstimate * (1 - s.signalDensity)), 0);

  return {
    utilizationPct: Math.min(1, utilizationPct),
    sections,
    atRiskSections,
    compressionHeadroom,
  };
}
