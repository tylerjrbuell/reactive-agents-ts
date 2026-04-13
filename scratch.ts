/**
 * Test: plan-execute-reflect strategy with crypto pricing task
 *
 * This tests the fixes to:
 * 1. Planner decomposition (separate tool_call steps per entity)
 * 2. requiredToolQuantities enforcement (web-search×4)
 * 3. Reflection augmentation (UNSATISFIED + all completed → generate supplementary steps)
 */
import { ReactiveAgents } from 'reactive-agents'

const agent = await ReactiveAgents.create()
    .withProvider('ollama')
    .withModel({ model: 'gemma4:e4b', temperature: 0.2, maxTokens: 8000 })
    .withReasoning({
        defaultStrategy: 'plan-execute-reflect',
    })
    .withTools()
    .withObservability({ verbosity: 'debug', live: true })
    .build()

const result = await agent.run(
    'Fetch the current USD price for each currency: XRP, XLM, ETH, Bitcoin. Then render a markdown table with columns: Currency | Price | Source.'
)

console.log('\n--- Result ---')
console.log(result.output)

await agent.dispose()
