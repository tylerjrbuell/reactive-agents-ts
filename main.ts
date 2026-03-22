import { ReactiveAgents } from 'reactive-agents'

// ─── Production-Grade Persistent Gateway Agent ─────────────────────────────
// Multi-purpose autonomous agent that delivers contextual Signal messages
// based on a sophisticated cron schedule throughout the workday and week.
//
// Cron Schedule:
//   - 09:00 on Mon-Fri: Good Morning Brief (commits + PR status)
//   - 11:30 on Mon-Fri: PR Review Reminder (active PRs needing review)
//   - 17:00 on Mon-Fri: Daily Wrap-up (commits summary + metrics)
//   - 10:00 on Saturday: Weekend Review (weekly stats)
//   - 09:30 on Monday: Weekly Metrics (cumulative progress)
//
// Environment Requirements:
//   - SIGNAL_PHONE_NUMBER: Your Signal phone number (e.g., +1234567890)
//   - GITHUB_PERSONAL_ACCESS_TOKEN: GitHub PAT with repo read access
//   - RECIPIENT_PHONE: Target recipient for Signal messages (e.g., +1234567890)
// ─────────────────────────────────────────────────────────────────────────

const RECIPIENT = process.env.SIGNAL_PHONE_NUMBER

const agent = await ReactiveAgents.create()
    .withName('production-gateway-agent')
    .withProvider('ollama')
    .withModel({ model: 'cogito:14b', temperature: 0.7, maxTokens: 2048 })
    .withMCP([
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
        {
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
        },
    ])
    .withTools()
    .withReasoning({ defaultStrategy: 'adaptive' })
    .withObservability({ verbosity: 'debug', live: true, logModelIO: false })
    .withGateway({
        timezone: 'America/New_York',
        heartbeat: {
            intervalMs: 30_000, // 30 seconds
            policy: 'always',
            instruction: `Send a heartbeat message to ${RECIPIENT} every 30 seconds when the agent is idle. Use signal/send_message_to_user with recipient '${RECIPIENT}' with the following message content should be: "⏰ Heartbeat: Agent is alive and waiting for the next scheduled task." Suppress heartbeats when the agent is actively processing a task or has pending actions.`,
        },
        crons: [
            // ─── TEST CRON: Fires every minute for verification ───
            {
                schedule: '* * * * *', // Every minute
                instruction: `Test cron verification. Send a test message every minute to ${RECIPIENT} saying: "✅ Test cron fired at [current time]". Use signal/send_message_to_user with recipient '${RECIPIENT}'.`,
                enabled: false, // Set to true to enable testing
            },
        ],

        policies: {
            dailyTokenBudget: 100_000,
            maxActionsPerHour: 50,
        },

        channels: {
            accessPolicy: 'allowlist',
            allowedSenders: [RECIPIENT || ''],
            unknownSenderAction: 'skip',
        },
    })
    .build()

// ─── Startup & Lifecycle Management ───────────────────────────────────────

const handle = agent.start()

console.log('🚀 Production Gateway Agent Started')
console.log(`   Recipient: ${RECIPIENT}`)
console.log('   Timezone: America/New_York (EST/EDT)')
console.log('   Scheduled Runs:')
console.log('     • 09:00 AM Mon-Fri  → Morning Brief')
console.log('     • 11:30 AM Mon-Fri  → PR Review Reminder')
console.log('     • 5:00 PM Mon-Fri   → Daily Wrap-up')
console.log('     • 10:00 AM Saturday  → Weekend Review')
console.log('     • 9:30 AM Monday     → Weekly Metrics')
console.log('   Heartbeat: Every 2 minutes (adaptive)')
console.log('')
console.log('   Press Ctrl+C to gracefully shutdown.')
console.log('')

// Graceful shutdown on SIGINT/SIGTERM
let shuttingDown = false
const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true

    console.log('\n⏹️  Graceful shutdown initiated...')
    const summary = await handle.stop()

    console.log('📊 Gateway Statistics:')
    console.log(`   Total Runs: ${summary.totalRuns}`)
    console.log(`   Heartbeats Fired: ${summary.heartbeatsFired}`)
    console.log(`   Final Status: Stopped`)
    console.log('')

    await agent.dispose()
    console.log('✅ Gateway agent disposed. Goodbye!')
    process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// Keep alive until stopped
await handle.done
