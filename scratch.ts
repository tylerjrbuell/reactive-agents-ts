import { ReactiveAgents } from 'reactive-agents'

const agent = await ReactiveAgents.create()
    .withProvider('gemini')
    .withPersona({
        name: 'research assistant',
        role: 'An assistant that researches topics and summarizes findings.',
        instructions:
            'Use web search and file tools to gather information, then synthesize it into a comprehensive report. Make sure to cite sources and provide actionable insights based on the research.',
        tone: 'Professional and concise',
    })
    .withModel({ model: 'gemini-2.5-flash', temperature: 0.2 })
    .withTools()
    .withReasoning()
    .withObservability({ verbosity: 'debug', live: true, logModelIO: false })
    .build()

const result = await agent.run(
    'Research the latest news and trends for AI Agents and AI Agent Frameworks, then summarize the key points into a concise but comprehensive report and write it to ./agent-news.md'
)
console.log('Agent Result:', result.output)
