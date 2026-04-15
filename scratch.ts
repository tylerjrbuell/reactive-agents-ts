/**
 * Pass 2 probe: cogito Dynamic subagent (spawn-agent)
 *
 * Previously: 16 iters / 11,171 tok / didn't compute 120 (factorial of 5).
 * Likely: cogito doesn't invoke spawn-agent at all and thrashes without tools.
 */
import { ReactiveAgents } from 'reactive-agents'

const agent = await ReactiveAgents.create()
    .withProvider('ollama')
    .withModel({ model: 'cogito', temperature: 0.2, maxTokens: 8000 })
    .withReasoning()
    .withTools()
    .withDynamicSubAgents({ maxIterations: 8 })
    .withMaxIterations(15)
    .withObservability({ verbosity: 'debug', live: true })
    .build()

const result = await agent.run(
    'Spawn a sub-agent to calculate the factorial of 5 and report back the result.',
)

console.log('\n--- Result ---')
console.log(result.output?.slice(0, 400))
console.log(`\nIterations: ${result.metadata?.stepsCount ?? '?'}, Tokens: ${result.metadata?.tokensUsed ?? '?'}`)

await agent.dispose()
