import type { MCPServerConfig } from '@reactive-agents/runtime'
import { ReactiveAgents } from 'reactive-agents'

const mcpServers = [
    {
        name: 'signal',
        transport: 'stdio',
        command: 'docker',
        args: [
            'run',
            '-i',
            '--rm',
            '--cap-drop',
            'ALL',
            '--security-opt',
            'no-new-privileges',
            '--memory',
            '512m',
            '-v',
            './signal-data:/data:rw',
            '-e',
            `SIGNAL_USER_ID=${process.env.SIGNAL_PHONE_NUMBER}`,
            'signal-mcp:local',
        ],
    },
] as MCPServerConfig[]

const agent = await ReactiveAgents.create()
    .withProvider('ollama')
    .withModel({ model: 'cogito:14b', numCtx: 12000 })
    .withReasoning({ defaultStrategy: 'reactive' })
    .withTools()
    .withMCP(mcpServers)
    .withMemory({ tier: 'enhanced', dbPath: ':memory:' }) // in-memory SQLite for this example
    .withGateway({
        // With persistMemoryAcrossRuns, heartbeats and channel replies share the same
        // task ID so episodic memory accumulates across ticks and chat turns.
        persistMemoryAcrossRuns: true,
        timezone: 'America/New_York',

        // ── Channel access control + chat mode ──────────────────────────────────
        accessControl: {
            accessPolicy: 'allowlist',
            allowedSenders: [process.env.SIGNAL_PHONE_NUMBER ?? '+15551234567'],
            unknownSenderAction: 'skip',
            mode: 'chat', // "chat" (default) or "task" (stateless one-shot)
            sessionTtlDays: 30, // prune sessions inactive for 30+ days
        },

        // ── Optional: heartbeat and cron still work alongside chat mode ─────────
        // heartbeat: { intervalMs: 1_800_000, policy: "adaptive",
        //   instruction: "Check for any pending items." },

        policies: {
            dailyTokenBudget: 100_000,
            maxActionsPerHour: 50,
        },
    })
    .withObservability({ verbosity: 'debug', live: true })
    .build()

await agent.start()
