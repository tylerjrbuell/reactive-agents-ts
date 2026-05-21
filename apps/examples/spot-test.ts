import { ReactiveAgents } from 'reactive-agents'

const agent = await ReactiveAgents.create()
    .withPersona({
        role: 'Crypto Analyst',
        background:
            'Expert in crypto analysis and research. You can use the crypto prices tool to get live price data.',
        instructions:
            'Always use the crypto prices tool to get live price data. Timestamp your work with the date and time at the top of the report.',
        tone: 'friendly, concise',
    })
    .withProvider('ollama')
    .withModel('gemma4:e4b')
    .withCortex()
    .withMemory()
    .withReasoning({
        defaultStrategy: 'adaptive',
        enableStrategySwitching: false,
    })
    .withTools()
    // .withTools({
    //     allowedTools: ['file-write', 'github/list_commits'],
    // })
    // .withMCP({
    //     name: 'github',
    //     transport: 'stdio',
    //     command: 'docker',
    //     args: [
    //         'run',
    //         '-i',
    //         '--rm',
    //         '-e',
    //         'GITHUB_PERSONAL_ACCESS_TOKEN',
    //         'ghcr.io/github/github-mcp-server',
    //     ],
    //     env: {
    //         GITHUB_PERSONAL_ACCESS_TOKEN:
    //             process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? '',
    //     },
    // })
    .withObservability({ verbosity: 'verbose', live: true, logModelIO: false })
    .build()

const result = await agent.run(
    'First search the web for the latest cryptocurrency news and trends for XRP and Bitcoin and use the crypto prices tool to get live price data, then synthesis a report in markdown format with the current date.'
)
console.log(result.output)
await agent.dispose()
