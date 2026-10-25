/**
 * signal-gap-detector.ts — read-only detector for the signal consumption edge.
 *
 * Walks a trace's signal events and reports where a harness signal was
 * injected but never rendered, rendered but ignored/contradicted, or left
 * open at run end. Consumed by `rax diagnose` as a finding class.
 */
import type { Trace, TraceEvent } from "@reactive-agents/trace"

export interface SignalGapFinding {
  readonly signalId: string
  readonly kind: "unrendered" | "ignored" | "contradicted" | "unobserved"
  readonly detail?: string
}

export function detectSignalGaps(trace: Trace): readonly SignalGapFinding[] {
  const findings: SignalGapFinding[] = []
  const rendered = new Set<string>()
  const effects = new Map<string, TraceEvent & { kind: "signal-effect" }>()

  for (const e of trace.events) {
    if (e.kind === "signal-rendered") rendered.add(e.signalId)
    if (e.kind === "signal-effect") effects.set(e.signalId, e as TraceEvent & { kind: "signal-effect" })
  }

  for (const e of trace.events) {
    if (e.kind !== "harness-signal-injected") continue
    const id = e.signalId
    if (!id) continue
    if (!rendered.has(id)) {
      findings.push({ signalId: id, kind: "unrendered", detail: "injected but never rendered into the prompt" })
      continue
    }
    const eff = effects.get(id)
    if (!eff) {
      findings.push({ signalId: id, kind: "unobserved", detail: "rendered but no effect classified (open at run end)" })
      continue
    }
    if (eff.response === "ignored") findings.push({ signalId: id, kind: "ignored", detail: eff.detail })
    else if (eff.response === "contradicted") findings.push({ signalId: id, kind: "contradicted", detail: eff.detail })
  }
  return findings
}
