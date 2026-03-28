import { ReactiveAgents } from 'reactive-agents'

const agent = await ReactiveAgents.create()
    .withProvider('openai')
    .withPersona({
        name: 'research assistant',
        role: 'An assistant that researches topics and summarizes findings.',
        instructions:
            'Use web-search once or twice if needed, then you MUST call file-write to save the report to the exact path the user names. Do not finish with only search results — the deliverable is the markdown file on disk.',
        tone: 'Professional and concise',
    })
    // .withModel({ model: 'cogito', temperature: 0.2 })
    .withTools()
    // synthesis: "auto" — ICS escalates to a short LLM progress brief on mid+ tiers when
    // required tools are still missing (e.g. after web-search) so the next tool (file-write) is explicit.
    .withReasoning({ defaultStrategy: 'reactive', synthesis: 'auto' })
    .withObservability({ verbosity: 'debug', live: true, logModelIO: true })
    .build()

const result = await agent.run(
    'Research the latest news and trends for AI Agents and AI Agent Frameworks, then summarize the key points into a concise but comprehensive report and write it to ./agent-news.md'
)
console.log('Agent Result:', result)
