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
    .withObservability({ verbosity: 'debug', live: true })
    .build()

const result = await agent.run(
    'Fetch the current USD price for each of these 4 cryptocurrencies: XRP, XLM, ETH, Bitcoin. ' +
        'Use http-get for each: https://api.coinbase.com/v2/prices/XRP-USD/spot, ' +
        'https://api.coinbase.com/v2/prices/XLM-USD/spot, ' +
        'https://api.coinbase.com/v2/prices/ETH-USD/spot, ' +
        'https://api.coinbase.com/v2/prices/BTC-USD/spot. ' +
        'Call all 4 in the same response since they are independent. ' +
        'Then render a markdown table with columns: Currency | Price.'
)

console.log('\n--- Result ---')
console.log(result.output)

await agent.dispose()
