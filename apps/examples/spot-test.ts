import { ReactiveAgents } from 'reactive-agents'

const agent = await ReactiveAgents.create()
    .withPersona({
        role: 'Github Agent',
        background: 'Expert in Github task execution',
        instructions: 'Use github provided tools to solve your task',
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
    .withObservability({ verbosity: 'verbose', live: true, logModelIO: false })
    .build()

const result = await agent.run(
    'Fetch the last 5 commits to tylerjrbuell/reactive-agents-ts and list them.'
)
console.log(result.output)
console.log(result.debrief?.rationale)
await agent.dispose()
