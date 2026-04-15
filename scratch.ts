/**
 * Pinpoint probe: cogito convergence failure
 *
 * Test "Converge: no-tool task with tools enabled" — 16 iters / 13,402 tok
 * for a simple knowledge question that should answer in 1-2 iterations.
 */
import { ReactiveAgents } from 'reactive-agents'

const agent = await ReactiveAgents.create()
    .withProvider('ollama')
    .withModel({ model: 'cogito', temperature: 0.2, maxTokens: 8000 })
    .withReasoning({ defaultStrategy: 'reactive' })
    .withTools()
    .withObservability({ verbosity: 'debug', live: true })
    .build()

const result = await agent.run(
    'What is the speed of light in meters per second? Answer directly from your knowledge.',
)

console.log('\n--- Result ---')
console.log(result.output)
console.log(`\nIterations: ${result.metadata?.stepsCount ?? '?'}, Tokens: ${result.metadata?.tokensUsed ?? '?'}`)

await agent.dispose()
