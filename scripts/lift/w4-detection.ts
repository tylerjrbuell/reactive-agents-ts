#!/usr/bin/env bun
/**
 * W4 close-out DETECTION arm (deterministic, replay-lane). No LLM, no live calls.
 *
 * Trip side — the FROZEN false-success fixture (s3-llama32 run-4, canonical
 * discover-tools x146 thrash): the progress arbiter classifies every thrash
 * result as non-progress/meta-tool (the (c)/(d) inputs) and the loop detector
 * trips on the reconstructed step shape; the recorded assessments carry the
 * exact pattern-(e) precondition (evidenceDelta==0 ∧ outstanding>0 on every
 * assessment) that W4.1's band rule refuses to call green. The upstream
 * fixture pins (w4-thrash-arbiter.test.ts, loop-detector-arbiter.test.ts,
 * zero-evidence-standdown.test.ts) are executed by the close-out script and
 * recorded alongside this file's independent re-derivation.
 *
 * False-positive guard side — a substantive fixture (post-243 s3-qwen34b run
 * 01M4TQGTFWX46: real file-read/file-write evidence, non-zero evidenceDelta):
 * arbiter must classify SUBSTANTIVE, detectLoop must stay silent, and the
 * flail-signature (the stand-down's required arming signal) must NOT fire.
 */
import { join } from "node:path"
import { classifyToolResult, creditsEvidence, detectLoop, makeObservationResult } from "@reactive-agents/reasoning"
import type { ReasoningStep } from "@reactive-agents/reasoning"
import { loadRecordedRun } from "@reactive-agents/replay"
import { detectFlailSignature } from "../../packages/reasoning/src/kernel/loop/runner-helpers/flail-signature.js"
import { FIXTURES_DIR } from "./bench.ts"

const FROZEN = join(FIXTURES_DIR, "01M4SXNTN38VM8ZQ0Q85A7FA3E.jsonl")
const SUBSTANTIVE = join(FIXTURES_DIR, "post-243/01M4TQGTFWX46SX7W2BAKCSC82.jsonl")

type TraceJson = Record<string, unknown>
const rows: string[] = []
const record = (check: string, expected: string, observed: string, pass: boolean): void => {
  rows.push(JSON.stringify({ check, expected, observed, pass }))
  console.log(`${pass ? "PASS" : "FAIL"} ${check}: expected ${expected} | observed ${observed}`)
}

async function stepsOf(path: string): Promise<{ steps: ReasoningStep[]; calls: TraceJson[]; assessments: TraceJson[] }> {
  const run = await loadRecordedRun(path)
  const calls = run.trace.events.filter((e) => e.kind === "tool-call-end") as unknown as TraceJson[]
  const assessments = run.trace.events.filter((e) => e.kind === "assessment") as unknown as TraceJson[]
  const steps: ReasoningStep[] = []
  for (const c of calls) {
    const id = `call-${String(c.seq)}`
    const resultText = String(c.result ?? "")
    steps.push({
      id: `a-${String(c.seq)}` as ReasoningStep["id"],
      type: "action",
      content: JSON.stringify({ tool: c.toolName, input: JSON.stringify(c.args ?? {}) }),
      timestamp: new Date(),
      metadata: { toolCall: { id, name: c.toolName, arguments: {} } },
    })
    steps.push({
      id: `o-${String(c.seq)}` as ReasoningStep["id"],
      type: "observation",
      content: resultText,
      timestamp: new Date(),
      metadata: { toolCallId: id, observationResult: makeObservationResult(String(c.toolName), (c.ok as boolean) ?? true, resultText) },
    })
  }
  return { steps, calls, assessments }
}

// ── FROZEN thrash fixture: trip side ─────────────────────────────────────────
{
  const { steps, calls, assessments } = await stepsOf(FROZEN)
  const discover = calls.filter((c) => c.toolName === "discover-tools")
  const verdicts = discover.map((c) => classifyToolResult(String(c.toolName), (c.ok as boolean) ?? true, String(c.result ?? "")))
  const allNonProgress = verdicts.every((v) => v.kind === "non-progress" && v.reason === "meta-tool")
  record("frozen: arbiter classifies all discover-tools results non-progress/meta-tool", "all", `${verdicts.length} verdicts, all=${allNonProgress}`, allNonProgress)
  const msg = detectLoop(steps, 2, 3, 4)
  record("frozen: loop detector trips ((c)/(d) actuation)", "trip", msg === null ? "silent" : "trip", msg !== null)
  const ePre = assessments.every((a) => a.evidenceDelta === 0 && (a.requirementsOutstanding as number) > 0)
  record("frozen: pattern-(e) precondition on EVERY assessment (delta=0 ∧ outstanding>0)", "all", `n=${assessments.length}, all=${ePre}`, ePre)
}

// ── SUBSTANTIVE fixture: false-positive guard side ───────────────────────────
{
  const { steps, calls, assessments } = await stepsOf(SUBSTANTIVE)
  const real = calls.filter((c) => c.toolName === "file-read" || c.toolName === "file-write")
  const allSubstantive = real.every((c) =>
    classifyToolResult(String(c.toolName), (c.ok as boolean) ?? true, String(c.result ?? "")).kind === "substantive" &&
    creditsEvidence(String(c.toolName), (c.ok as boolean) ?? true, String(c.result ?? "")))
  record("FP-guard: substantive file ops classify substantive/credit-evidence", "all", `${real.length} ops, all=${allSubstantive}`, real.length > 0 && allSubstantive)
  const msg = detectLoop(steps, 2, 3, 4)
  record("FP-guard: loop detector SILENT on substantive run", "silent", msg === null ? "silent" : "trip", msg === null)
  const nonZeroDelta = assessments.some((a) => (a.evidenceDelta as number) > 0)
  record("FP-guard: run produces non-zero evidenceDelta turns (band-refusal premise absent)", ">=1", `n=${assessments.filter((a) => (a.evidenceDelta as number) > 0).length}`, nonZeroDelta)
  const thoughtSteps: ReasoningStep[] = steps.filter((s) => s.type === "action")
  const flail = detectFlailSignature(thoughtSteps, 3)
  record("FP-guard: flail signature does NOT arm (stand-down requires it)", "flailing=false", `flailing=${flail.flailing} refusal=${flail.refusal} repetition=${flail.repetition}`, !flail.flailing)
}

await Bun.write(join(FIXTURES_DIR, "post-w4", "detection-results.jsonl"), rows.join("\n") + "\n")
