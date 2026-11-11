// Build the candidate calibration set from the v3 runner output (raw/<id>.txt, stdout of
// `calibration-runner.ts --model <id> --runs 5`, NO --commit) and the committed JSON
// (committed/<id>.json, `git show HEAD:packages/llm-provider/src/calibrations/<id>.json`).
//
// Candidate = committed file with the PROBE-MEASURED fields replaced by the v3 values.
// Fields the runner does not produce (actOrAnswer, classifierReliability, alias maps) are
// kept from the committed file: the runner's own `--commit` would DROP them (it writes
// only what runProbes returns), which would silently remove the act-or-answer prior for
// qwen3:4b and cogito:8b. Writes candidates/<id>.json, prints a field diff and the
// discrimination gate over the measured candidates.
//   bun build-candidates.ts
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { discriminationGate } from "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts/packages/llm-provider/src/calibration-scoring.ts"

const D = import.meta.dir
const PROBE_FIELDS = ["probeVersion", "runsAveraged", "calibratedAt", "steeringCompliance", "parallelCallCapability", "observationHandling", "systemPromptAttention", "optimalToolResultChars", "toolCallDialect"] as const
const SHOWN = ["steeringCompliance", "parallelCallCapability", "observationHandling", "systemPromptAttention", "optimalToolResultChars", "toolCallDialect", "actOrAnswer"] as const

mkdirSync(join(D, "candidates"), { recursive: true })
const cands: Record<string, unknown>[] = []
for (const f of readdirSync(join(D, "committed")).filter((f) => f.endsWith(".json") && f !== "tokenizer-factors.json").sort()) {
  const id = f.replace(/\.json$/, "")
  const committed = JSON.parse(readFileSync(join(D, "committed", f), "utf8")) as Record<string, unknown>
  const rawPath = join(D, "raw", `${id}.txt`)
  if (!existsSync(rawPath)) {
    // Unmeasured (qwen3:14b timed out): the candidate keeps the committed file so the
    // candidate dir is complete and the loader never falls through to src.
    writeFileSync(join(D, "candidates", f), `${JSON.stringify(committed, null, 2)}\n`)
    console.log(`${id}: UNMEASURED (no v3 output), candidate = committed`)
    continue
  }
  const raw = readFileSync(rawPath, "utf8")
  const v3 = JSON.parse(raw.slice(raw.indexOf("{"))) as Record<string, unknown>
  const cand: Record<string, unknown> = { ...committed }
  for (const k of PROBE_FIELDS) cand[k] = v3[k]
  writeFileSync(join(D, "candidates", f), `${JSON.stringify(cand, null, 2)}\n`)
  cands.push(cand)
  const moved = SHOWN.filter((k) => committed[k] !== cand[k]).map((k) => `${k}: ${String(committed[k])} -> ${String(cand[k])}`)
  console.log(`${id} (${String(committed.modelId)}): ${moved.length ? moved.join("; ") : "no change"}`)
}
const gate = discriminationGate(cands as Parameters<typeof discriminationGate>[0])
console.log(`\ndiscriminationGate (measured candidates only): passes=${gate.passes} models=${gate.models}`)
for (const fd of gate.fields) console.log(`  ${fd.field}: ${fd.distinct.join(", ")} ${fd.passes ? "ok" : "STUCK"}`)
