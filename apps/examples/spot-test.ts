import { ReactiveAgents } from 'reactive-agents'

// Env-parametrized so spot-test variants run without re-editing.
const PROVIDER = process.env.SPOT_PROVIDER ?? 'ollama'
const MODEL = process.env.SPOT_MODEL ?? 'gemma4:e4b'
const TASK =
    process.env.SPOT_TASK ??
    'Fetch the last 10 commits to tylerjrbuell/reactive-agents-ts then write a local markdown file (./commits.md) with all 10 commit messages.'
const TOOLS = (process.env.SPOT_TOOLS ?? 'file-write,github/list_commits').split(',')

const agent = await ReactiveAgents.create()
    .withPersona({
        role: 'Github Agent',
        background: 'Expert in Github task execution',
        instructions: 'Use github provided tools to solve your task',
        tone: 'friendly, concise',
    })
    .withProvider(PROVIDER as 'ollama' | 'openai' | 'anthropic' | 'gemini' | 'litellm')
    .withModel(MODEL)
    .withCortex()
    .withMemory()
    .withReasoning({
        defaultStrategy: 'adaptive',
        enableStrategySwitching: false,
    })
    .withTools({
        allowedTools: TOOLS,
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
    .withObservability({ verbosity: 'debug', live: true, logModelIO: process.env.SPOT_LOG_IO === '1' })
    .build()

const result = await agent.run(TASK)
console.log(result.output)
// Structured metrics line for the baseline/grid runner (single greppable line).
console.log(
    'SPOT_RESULT_JSON=' +
        JSON.stringify({
            provider: PROVIDER,
            model: MODEL,
            success: result.success,
            error: result.error ?? null,
            goalAchieved: result.goalAchieved ?? null,
            terminatedBy: result.terminatedBy ?? null,
            tokensUsed: result.metadata.tokensUsed,
            inputTokens: result.metadata.inputTokens ?? null,
            outputTokens: result.metadata.outputTokens ?? null,
            steps: result.metadata.stepsCount,
            durationMs: result.metadata.duration,
            outputLen: result.output.length,
            toolCalls: (result.metadata.toolCalls ?? []).map((t) => t.name),
        }),
)
await agent.dispose()
