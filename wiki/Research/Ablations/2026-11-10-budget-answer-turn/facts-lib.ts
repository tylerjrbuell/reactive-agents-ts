// Per-run mechanism facts for the budget answer turn, read from one trace (.jsonl).
// Shared by run-custom.ts and the post-hoc readers (facts.ts).
import { existsSync, readFileSync } from "node:fs"

export interface MechanismFacts {
  readonly llmCalls: number
  /** Sum of tokensIn + tokensOut over every llm-exchange. */
  readonly tokens: number
  /** guard-fired events with guard === "budget_answer_turn". */
  readonly batFires: number
  /** Tools on the LAST wire request (guard-fired wire-request toolsShipped). */
  readonly lastToolsShipped: number | null
  /** Did the LAST llm-exchange answer with tool calls (work nobody reads)? */
  readonly lastCallUsedTools: boolean | null
  readonly toolsCalled: readonly string[]
  readonly okToolResults: number
  readonly terminatedBy: string | null
  /** run-completed.status (success / partial / failed / ...). */
  readonly runStatus: string | null
  readonly outcomeStatus: string | null
  readonly authority: string | null
  /** Last terminal verifier verdict (kernel or runtime), null when none ran. */
  readonly verified: boolean | null
  readonly failedChecks: readonly string[]
  readonly iterations: number
}

export function mechanismFacts(traceFile: string | null): MechanismFacts {
  const empty: MechanismFacts = { llmCalls: 0, tokens: 0, batFires: 0, lastToolsShipped: null, lastCallUsedTools: null, toolsCalled: [], okToolResults: 0,
    terminatedBy: null, runStatus: null, outcomeStatus: null, authority: null, verified: null, failedChecks: [], iterations: 0 }
  if (!traceFile || !existsSync(traceFile)) return empty
  const ev = readFileSync(traceFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)
  const llm = ev.filter((e) => e.kind === "llm-exchange")
  const wires = ev.filter((e) => e.kind === "guard-fired" && e.guard === "wire-request")
  const lastWire = wires.at(-1)?.metadata as { toolsShipped?: unknown[] } | undefined
  const lastResp = llm.at(-1)?.response as { toolCalls?: unknown[] } | undefined
  const verdicts = ev.filter((e) => e.kind === "verifier-verdict" && e.terminal === true)
  const lastV = verdicts.at(-1) as { verified?: boolean; checks?: Array<{ name: string; passed: boolean }> } | undefined
  const done = ev.find((e) => e.kind === "run-completed")
  const o = done?.outcome as Record<string, unknown> | undefined
  let tokens = 0
  for (const e of llm) { const r = e.response as Record<string, number> | undefined; tokens += (r?.tokensIn ?? 0) + (r?.tokensOut ?? 0) }
  return {
    llmCalls: llm.length,
    tokens,
    batFires: ev.filter((e) => e.kind === "guard-fired" && e.guard === "budget_answer_turn").length,
    lastToolsShipped: Array.isArray(lastWire?.toolsShipped) ? lastWire!.toolsShipped!.length : null,
    lastCallUsedTools: lastResp ? (lastResp.toolCalls?.length ?? 0) > 0 : null,
    toolsCalled: [...new Set(ev.filter((e) => e.kind === "tool-call-end" && typeof e.toolName === "string").map((e) => e.toolName as string))],
    okToolResults: ev.filter((e) => e.kind === "tool-call-end" && e.ok === true).length,
    terminatedBy: typeof done?.terminatedBy === "string" ? done.terminatedBy : null,
    runStatus: typeof done?.status === "string" ? done.status : null,
    outcomeStatus: typeof o?.status === "string" ? o.status : null,
    authority: typeof o?.authority === "string" ? o.authority : null,
    verified: lastV ? lastV.verified === true : null,
    failedChecks: (lastV?.checks ?? []).filter((c) => !c.passed).map((c) => c.name),
    iterations: Math.max(0, ...ev.map((e) => (typeof e.iter === "number" ? e.iter : 0))),
  }
}
