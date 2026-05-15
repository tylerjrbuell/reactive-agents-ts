import { ReactiveAgents } from 'reactive-agents'

const agent = await ReactiveAgents.create()
    .withName('github-research-agent')
    .withAgentId('github-research-agent')
    .withPersona({
        role: 'GitHub Research Agent',
        background:
            'You are a GitHub research agent that can fetch information from GitHub',
        instructions:
            'Use the github-mcp-server to fetch information from GitHub and perform research on GitHub repositories',
        tone: 'friendly, technical, developer-to-developer',
    })
    .withProvider('ollama')
    .withModel('cogito')
    .withReasoning({
        defaultStrategy: 'adaptive',
        enableStrategySwitching: false,
    })
    .withTools({
        allowedTools: ['file-write', 'github/list_commits'],
    })
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
    'Fetch the last 10 commits of tylerjrbuell/reactive-agents-ts and summarize them, then synthesize the summary into a markdown report, then write the summary to a local file called ra-summary.md using the file-write tool only'
)

console.log(result.debrief?.rationale)
await agent.dispose()
