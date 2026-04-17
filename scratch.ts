/**
 * Demo: Claude-Code-style status renderer
 *
 * Runs with status mode auto-detected (isTTY=true in terminal).
 * Run with `| cat` to see stream mode fallback.
 */
import { ReactiveAgents } from 'reactive-agents'

const agent = await ReactiveAgents.create()
  .withProvider('ollama')
  .withModel({ model: 'gemma4:e4b' })
  .withReasoning({ defaultStrategy: 'reactive' })
  .withTools()
  .withObservability({ verbosity: 'silent', live: false })
  .build()

const result = await agent.run(
  'Fetch the current USD price for each of the following currencies: XRP, XLM, ETH, Bitcoin. ' +
  'Then render a markdown table with columns: Currency | Price | Source.'
)

console.log('\n--- Result ---')
console.log(result.output)

await agent.dispose()
