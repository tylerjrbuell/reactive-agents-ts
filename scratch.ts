/**
 * Pinpoint probe: cogito static-subagent delegation
 *
 * Cogito previously called the agent-tool with `{"input":{"type":"object"}}`
 * (copying the schema metadata as the value). With input typed as a required
 * string, this should resolve to a real natural-language task.
 */
import { ReactiveAgents } from 'reactive-agents'

const agent = await ReactiveAgents.create()
    .withProvider('ollama')
    .withModel({ model: 'cogito', temperature: 0.2, maxTokens: 8000 })
    .withReasoning()
    .withTools()
    .withAgentTool('research-assistant', {
        name: 'research-assistant',
        systemPrompt: 'You are a research assistant. Answer the question clearly and concisely.',
        provider: 'ollama',
        model: 'cogito',
    })
    .withMaxIterations(15)
    .withObservability({ verbosity: 'debug', live: true })
    .build()

const result = await agent.run(
    'Use your research assistant to explain what a linked list is. Provide their answer.',
)

console.log('\n--- Result ---')
console.log(result.output)
console.log(`\nIterations: ${result.metadata?.stepsCount ?? '?'}, Tokens: ${result.metadata?.tokensUsed ?? '?'}`)

await agent.dispose()
