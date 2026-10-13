/**
 * Probe 4 / T0 fixture generator: reproduce the success-shaped discover-tools
 * thrash on the default local-tier path (verified live 2026-10-12 in run
 * 01M4RS3NNJZQGKE8CF9PCV01R5, since rotated out). Task asks for a capability
 * the agent does not have (no tools registered) so the run can only thrash,
 * producing the canonical pre-fix evidence signature:
 *
 *   - assessment events: evidenceDelta 0 every iteration, band "green"
 *   - loop-detector: silent (varied args, success:true)
 *   - termination: dispatcher-early-stop at maxIterations while status acting
 *   - verdict: success with requirementsOutstanding > 0
 *
 * Captures its trace into the fixtures dir via REACTIVE_AGENTS_TRACE_DIR.
 * Post-fix (Waves 4-5), the SAME script must show pattern-(e) firing early,
 * a non-green band, and no false-success. This is the lift probe.
 *
 * Run: bun run scripts/probe-4-wander-repro.ts   (ollama running; ~1-2 min)
 */
import { ReactiveAgents } from "../../packages/runtime/src/index.js"

const MODEL = process.env.PROBE_MODEL ?? "qwen3.5:latest"

const agent = await ReactiveAgents.create()
  .withName("probe-4-wander-repro")
  .withProvider("ollama")
  .withModel(MODEL)
  .withoutMemory()
  .withReasoning({ strategies: { reactive: { maxIterations: 10 } } })
  .build()

const result = await agent.run(
  'Send a slack message to the #general channel saying "Hello, team! This is a test message from our Reactive Agent."',
)

console.log("=== result")
console.log("success:", result.success)
console.log("status:", (result as { status?: string }).status)
console.log("terminatedBy:", (result.metadata as Record<string, unknown>)?.terminatedBy)
console.log("tokens:", (result.metadata as Record<string, unknown>)?.totalTokens ?? (result.metadata as Record<string, unknown>)?.usage)
console.log("tracePath hint: see REACTIVE_AGENTS_TRACE_DIR output dir")
await agent.dispose()
