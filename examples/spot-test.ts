import { ReactiveAgents } from 'reactive-agents'

const agent = await ReactiveAgents.create()
    .withProvider('ollama')
    .withModel('cogito:14b')
    .withReasoning({
        defaultStrategy: 'adaptive',
        enableStrategySwitching: true,
    })
    .withTools()
    .withMCP({
        name: 'github',
        transport: 'stdio',
        command: 'docker',
        args: [
            'run',
            '-i',
            '--rm',
            '-e',
            'GITHUB_PERSONAL_ACCESS_TOKEN',
            'ghcr.io/github/github-mcp-server',
        ],
        env: {
            GITHUB_PERSONAL_ACCESS_TOKEN:
                process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? '',
        },
    })
    .withMemory()
    .withObservability({ verbosity: 'debug', live: true })
    .build()

const result = await agent.run(
    'Fetch the last 10 commits of tylerjrbuell/reactive-agents-ts and summarize them, then synthesize the summary into a single paragraph'
)

console.log(result)
await agent.dispose()
