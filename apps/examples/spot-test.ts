import { ReactiveAgents } from 'reactive-agents'

const agent = await ReactiveAgents.create()
    .withPersona({
        role: 'Github Agent',
        background: 'Expert in Github task execution',
        instructions: 'Use github provided tools to solve your task',
        tone: 'friendly, concise',
    })
    .withProvider('ollama')
    .withModel('qwen3.5:latest')
    .withCortex()
    .withMemory()
    .withReasoning({
        defaultStrategy: 'adaptive',
        enableStrategySwitching: false,
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
    .withObservability({ verbosity: 'debug', live: true, logModelIO: true })
    .build()

const result = await agent.run(
    'Fetch the last 10 commits to tylerjrbuell/reactive-agents-ts and create a markdown file (./commits.md) with commit categories (feat/fix/refactor/docs), a 1-sentence summary per category, and any breaking changes. Self-critique and improve the format.'
)
console.log(result.output)
await agent.dispose()
