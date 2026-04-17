/**
 * Diagnostic scratch — targeted harness gap tests
 *
 * Tests three suspected pre-release issues:
 *   D1: UNSATISFIED tokens leaking into plan-execute-reflect output
 *   D2: maxIterations hard cap respected under tool errors (Tavily quota = cheap failure source)
 *   D3: Loop detector behaviour when ICS nudges fire repeatedly
 */
import { ReactiveAgents } from 'reactive-agents'

function sep(label: string) {
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`  ${label}`)
    console.log('─'.repeat(60))
}

function diagnose(label: string, output: string, meta: Record<string, unknown>) {
    const unsatisfied = /UNSATISFIED/i.test(output)
    const satisfied = /SATISFIED/i.test(output)
    console.log(`\n[${label}]`)
    console.log(`  stepsCount   : ${meta.stepsCount}`)
    console.log(`  tokensUsed   : ${meta.tokensUsed}`)
    console.log(`  strategy     : ${(meta as any).selectedStrategy ?? meta.strategy ?? '?'}`)
    console.log(`  UNSATISFIED in output : ${unsatisfied ? '❌ YES — LEAK' : '✅ no'}`)
    console.log(`  SATISFIED in output   : ${satisfied ? '⚠️  yes (may be ok)' : '—'}`)
    console.log(`  Output preview (150c) : ${output.slice(0, 150).replace(/\n/g, '↵')}`)
    if (unsatisfied) {
        // Show the context around the leak
        const idx = output.search(/UNSATISFIED/i)
        console.log(`  Leak context          : ...${output.slice(Math.max(0, idx - 40), idx + 80)}...`)
    }
}

// ─────────────────────────────────────────────
// D1 — UNSATISFIED leak in plan-execute-reflect
//   Task requires web-search; Tavily quota fires → reflection marks UNSATISFIED
//   Bug: that token appears verbatim in the synthesised output
// ─────────────────────────────────────────────
sep('D1 — UNSATISFIED token leak (plan-execute-reflect + web-search)')

const d1Agent = await ReactiveAgents.create()
    .withProvider('ollama')
    .withModel({ model: 'cogito:14b' })
    .withReasoning({ defaultStrategy: 'plan-execute-reflect' })
    .withTools()
    .withObservability({ verbosity: 'minimal', live: true })
    .build()

const d1 = await d1Agent.run(
    'Search the web to find the three most recent AI model releases from Anthropic, OpenAI, and Google DeepMind respectively. ' +
    'For each: name, release date, and one key capability. Present as a markdown table.'
)
diagnose('D1', d1.output, d1.metadata)
await d1Agent.dispose()

// ─────────────────────────────────────────────
// D2 — maxIterations hard cap under tool failure pressure
//   Tavily quota errors force repeated retries. Does the loop stop at maxIterations?
//   Bug: ICS nudges may reset loop-detector counter, bypassing the cap
// ─────────────────────────────────────────────
sep('D2 — maxIterations hard cap (maxIterations:4, web-search Tavily quota)')

const d2Agent = await ReactiveAgents.create()
    .withProvider('ollama')
    .withModel({ model: 'cogito:14b' })
    .withReasoning({ defaultStrategy: 'reactive', maxIterations: 4 })
    .withTools()
    .withObservability({ verbosity: 'minimal', live: true })
    .build()

const d2 = await d2Agent.run(
    'Use web-search to find the current price of Bitcoin in USD. ' +
    'Try multiple times if needed. Report the price with the source URL.'
)
console.log(`\n[D2]`)
console.log(`  stepsCount : ${d2.metadata.stepsCount}  (total reasoning steps, not LLM calls)`)
console.log(`  llmCalls   : ${(d2.metadata as any).llmCalls ?? '?'}`)
console.log(`  Hard cap   : 4 LLM calls`)
const d2Calls = (d2.metadata as any).llmCalls as number ?? 999
console.log(`  Respected  : ${d2Calls <= 4 ? '✅ yes' : `❌ NO — made ${d2Calls} LLM calls`}`)
console.log(`  Output     : ${d2.output.slice(0, 150).replace(/\n/g, '↵')}`)
await d2Agent.dispose()

// ─────────────────────────────────────────────
// D3 — Loop detector: does it fire before or after maxIterations?
//   Same quota-hitting task but maxIterations:10 — watch stepsCount vs 10
//   If stepsCount >> 10, the loop detector is NOT the primary exit, or counter is wrong
// ─────────────────────────────────────────────
sep('D3 — Loop detector vs maxIterations (maxIterations:10, repeated tool failures)')

const d3Agent = await ReactiveAgents.create()
    .withProvider('ollama')
    .withModel({ model: 'cogito:14b' })
    .withReasoning({ defaultStrategy: 'reactive', maxIterations: 10 })
    .withTools()
    .withObservability({ verbosity: 'minimal', live: true })
    .build()

const d3 = await d3Agent.run(
    'Search for the latest news about the Rust programming language. ' +
    'Then search for the latest news about TypeScript. ' +
    'Summarise the top finding from each in 2 sentences.'
)
console.log(`\n[D3]`)
console.log(`  stepsCount  : ${d3.metadata.stepsCount}  (total reasoning steps, not LLM calls)`)
console.log(`  llmCalls    : ${(d3.metadata as any).llmCalls ?? '?'}`)
console.log(`  Hard cap    : 10 LLM calls`)
const d3Calls = (d3.metadata as any).llmCalls as number ?? 999
console.log(`  Exit reason : ${d3Calls <= 10 ? '✅ within cap' : `❌ exceeded — ${d3Calls} LLM calls`}`)
console.log(`  terminatedBy: ${(d3.metadata as any).terminatedBy ?? '?'}`)
console.log(`  Output      : ${d3.output.slice(0, 200).replace(/\n/g, '↵')}`)
await d3Agent.dispose()

console.log('\n\n=== Diagnostic complete ===\n')
