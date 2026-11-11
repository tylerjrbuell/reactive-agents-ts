// Zero-token arm check: prints what the patched loader resolves for each gate tier
// under the current RA_ABL_CAL_DIR (run under ./arm-plugin.ts). Proves the arms differ
// in the consumed values before any live cell runs.
//   RA_ABL_SNAPSHOT=<dir> RA_ABL_CAL_DIR=<dir> RA_ABL_ARM=<label> bun --preload ./arm-plugin.ts check-arm.ts
import { loadCalibration, selectAdapter } from "@reactive-agents/llm-provider"

for (const m of ["qwen3:4b", "cogito:8b"]) {
  const c = loadCalibration(m)
  const { profileOverrides } = selectAdapter({ supportsToolCalling: true }, "local", m)
  console.log(`${process.env.RA_ABL_ARM} ${m}: probeVersion=${c?.probeVersion} toolResultMaxChars=${profileOverrides?.toolResultMaxChars} attention=${c?.systemPromptAttention} steering=${c?.steeringCompliance} parallel=${c?.parallelCallCapability} observation=${c?.observationHandling} dialect=${c?.toolCallDialect} actOrAnswer=${c?.actOrAnswer}`)
}
