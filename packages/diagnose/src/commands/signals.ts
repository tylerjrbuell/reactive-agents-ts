// `rax diagnose signals <runId>` — report harness signals that never landed.
//
// Walks the signal consumption edge in a trace (injected → rendered → effect)
// and lists every signal that was never rendered into the prompt, was rendered
// but never classified, or was ignored/contradicted by the model.

import { loadTrace } from "@reactive-agents/trace";
import { resolveTracePath } from "../lib/resolve.js";
import { detectSignalGaps, type SignalGapFinding } from "../lib/signal-gap-detector.js";

export interface SignalsOpts {
  readonly json?: boolean;
}

/** Render findings as a human-readable report (exported for tests). */
export function renderSignalGaps(findings: readonly SignalGapFinding[]): string {
  if (findings.length === 0) return "No signal gaps: every injected signal was rendered and remediated.";
  const lines = findings.map((f) => `  ${f.signalId.padEnd(14)} ${f.kind.padEnd(12)} ${f.detail ?? ""}`.trimEnd());
  return [`${findings.length} signal gap(s):`, ...lines].join("\n");
}

export async function signalsCommand(idOrPath: string, opts: SignalsOpts = {}): Promise<void> {
  const trace = await loadTrace(await resolveTracePath(idOrPath));
  const findings = detectSignalGaps(trace);
  console.log(opts.json ? JSON.stringify(findings, null, 2) : renderSignalGaps(findings));
}
