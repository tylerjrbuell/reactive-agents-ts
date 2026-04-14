/**
 * Test: parallel tool call batching in the ReAct kernel
 *
 * Gives the agent 4 independent HTTP price lookups. With parallel batching
 * enabled by default (nextMovesPlanning.enabled=true), the LLM should return
 * all 4 http-get calls in a single response, and act.ts executes them with
 * Effect.all({ concurrency: N }).
 *
 * What to look for in output (parallel batch working):
 *   [action] http-get(url: "https://...xrp...")
 *   [action] http-get(url: "https://...xlm...")
 *   [action] http-get(url: "https://...eth...")
 *   [action] http-get(url: "https://...btc...")
 *   [observation] {...}
 *   [observation] {...}
 *   ...
 *
 * If you see action→observation→action→observation, the LLM is only returning
 * one tool call per response (batching not firing at the model level).
 */
import { ReactiveAgents } from 'reactive-agents'

const agent = await ReactiveAgents.create()
    .withProvider('ollama')
    .withModel({ model: 'gemma4:e4b', temperature: 0.2, maxTokens: 8000 })
    .withReasoning({ defaultStrategy: 'reactive' })
    .withTools()
    // Keep this probe focused on model-side parallel tool behavior.
    // Adaptive required-tool classification can infer web-search×4 for this task,
    // which now conflicts with the default search budget cap (3).
    .withRequiredTools({ adaptive: false })
    .withObservability({ verbosity: 'debug', live: true })
    .build()

const result = await agent.run(
    'Fetch the current USD price for: XRP, XLM, ETH, Bitcoin. ' +
        'Then render a markdown table with columns: Currency | Price | Source.'
)
















































































console.log('\n--- Result ---')
console.log(result.output)

await agent.dispose()
