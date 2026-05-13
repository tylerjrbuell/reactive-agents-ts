import type { Debrief } from "./types.js";

export type DebriefFormat = "markdown" | "json";

export function renderDebrief(debrief: Debrief, format: DebriefFormat = "markdown"): string {
  if (format === "json") {
    return JSON.stringify(debrief, null, 2);
  }
  return renderMarkdown(debrief);
}

function renderMarkdown(d: Debrief): string {
  const lines: string[] = [];
  lines.push(`Debrief: run ${d.runId}`);
  if (d.goal) lines.push(`├─ Goal: ${truncate(d.goal, 100)}`);

  // ── Path summary line ──
  if (d.path.length > 0) {
    const summary = d.path.map((s) => s.action.replace(/^tool:/, "")).join(" → ");
    lines.push(`├─ Path: ${truncate(summary, 120)}`);
  }

  // ── Why this path ──
  const decisions = d.path.filter((s) => s.rationale);
  if (decisions.length > 0) {
    lines.push(`├─ Why this path`);
    for (const step of decisions) {
      const refs = step.rationale!.refs?.length
        ? ` (refs: ${step.rationale!.refs.join(", ")})`
        : "";
      lines.push(`│   • iter ${step.iter} chose ${step.action}: "${truncate(step.rationale!.why, 120)}"${refs}`);
    }
  }

  // ── Assumptions ──
  if (d.assumptions.length > 0) {
    lines.push(`├─ Assumptions`);
    for (const a of d.assumptions) {
      const conf = a.rationale.confidence !== undefined ? ` (conf: ${a.rationale.confidence.toFixed(2)})` : "";
      lines.push(`│   • "${truncate(a.assumption, 80)}"${conf} — ${truncate(a.rationale.why, 80)}`);
    }
  }

  // ── Curator actions ──
  if (d.curatorActions.length > 0) {
    lines.push(`├─ Curator`);
    for (const c of d.curatorActions) {
      lines.push(`│   • iter ${c.iter} ${c.action} ${c.targetRef} — "${truncate(c.rationale.why, 80)}"`);
    }
  }

  // ── Alternatives considered ──
  if (d.alternatives.length > 0) {
    lines.push(`├─ Alternatives considered`);
    for (const a of d.alternatives) {
      lines.push(`│   • iter ${a.iter} chose ${a.chosen}`);
      for (const r of a.rejected) {
        lines.push(`│     ✗ ${r.option} — ${truncate(r.rejectedBecause, 80)}`);
      }
    }
  }

  // ── Termination ──
  const termWhy = d.termination.rationale?.why;
  const termLine = termWhy
    ? `├─ Termination: ${d.termination.by} — "${truncate(termWhy, 120)}"`
    : `├─ Termination: ${d.termination.by}`;
  lines.push(termLine);

  // ── Verdict ──
  if (d.verdict) {
    lines.push(
      `└─ Verdict: ${d.verdict.status} | ${d.verdict.tokens} tok | ${d.verdict.durationMs}ms`,
    );
  } else {
    lines.push(`└─ Verdict: (no run-completed event found)`);
  }

  return lines.join("\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
