/**
 * Example 25: Hacker News gateway monitor
 *
 * Persistent gateway agent that pulls the HN front page on a schedule, synthesizes
 * a short digest, and writes timestamped Markdown reports under `./hn-gateway-reports/`.
 *
 * Architecture:
 * - Same agent ID across runs: episodic memory carries over between heartbeats and crons
 * - Crons (every 5min): full digest generation with tool calls
 * - Heartbeats (every 60s): lightweight health check, optional recall if needed
 * - Graceful shutdown: SIGINT/SIGTERM stop the gateway and save final state
 *
 * Test vs Production:
 * - Test: fast heartbeat (200ms), cron every 300ms, mock tool responses
 * - Production: 60s heartbeats, 5min crons, real HN API, cost tracking, health checks
 *
 * Usage (Production - from repo root with API keys):
 *   HN_GATEWAY_PROVIDER=anthropic bun run apps/examples/src/gateway/25-hn-gateway-monitor.ts
 *
 * Usage (Test - from suite):
 *   bun run apps/examples/index.ts --filter gateway   # includes this example as [25]
 */

import { Effect } from 'effect'
import { ReactiveAgents } from 'reactive-agents'

export interface ExampleResult {
    passed: boolean
    output: string
    steps: number
    tokens: number
    durationMs: number
}

const REPORT_DIR = './hn-gateway-reports'

const digestInstruction = `You are the scheduled HN digest job (cron).

Memory is ON: you may see prior gateway runs in context. Build on that only when it helps (e.g. avoid repeating the same failure).

1. Call tool get-hn-posts with count 25 (official Firebase API — do not invent URLs).
2. From the JSON array, write a Markdown report with:
   - Title line: "# Hacker News digest" and an ISO-8601 UTC timestamp for when you ran.
   - A bullet list of the top 15 stories: rank, title, score, and link (use the url field).
   - A short "Themes" paragraph (2–4 sentences) on what the front page is talking about.
   - A final one-line footer: DigestRun: ok | partial | failed — <optional short note> (for the next run).
3. Save the full report with file-write:
   - path: ${REPORT_DIR}/report-<YYYY-MM-DDTHH-mm-ss>Z.md (replace with the actual UTC time you ran; use only safe filename characters).
   - content: the complete Markdown (overwrite is fine).
4. End your reply with a single line: FINAL ANSWER: wrote <path>`

const heartbeatInstruction = `Gateway heartbeat — lightweight check.

Cron (every 5 minutes) handles the full HN fetch and report. You do NOT call get-hn-posts or file-write.

Prior digest runs may appear in memory context. Optional: one recall(...) call only if the user message references a stored key you must expand; otherwise no tools.

Single-line reply only, format: FINAL ANSWER: hb-ok`

const getHnPostsTool = {
    definition: {
        name: 'get-hn-posts',
        description:
            'Fetch current Hacker News front-page stories (title, score, url) via the official API.',
        parameters: [
            {
                name: 'count',
                type: 'number' as const,
                description: 'How many top stories to return (1–100)',
                required: true,
                default: 25,
            },
        ],
        riskLevel: 'low' as const,
        timeoutMs: 20_000,
        requiresApproval: false,
        source: 'function' as const,
    },
    handler: (args: Record<string, unknown>) =>
        Effect.tryPromise({
            try: async () => {
                const n = Math.min(100, Math.max(1, Number(args.count) || 25))
                const listRes = await fetch(
                    'https://hacker-news.firebaseio.com/v0/topstories.json'
                )
                if (!listRes.ok) {
                    throw new Error(`HN topstories HTTP ${listRes.status}`)
                }
                const ids = (await listRes.json()) as number[]
                const slice = ids.slice(0, n)
                const items = await Promise.all(
                    slice.map(async (id) => {
                        const r = await fetch(
                            `https://hacker-news.firebaseio.com/v0/item/${id}.json`
                        )
                        if (!r.ok) {
                            throw new Error(`HN item ${id} HTTP ${r.status}`)
                        }
                        return r.json() as Promise<{
                            title?: string
                            score?: number
                            url?: string
                        }>
                    })
                )
                return items.map((it, i) => ({
                    id: slice[i],
                    title: it.title ?? '(no title)',
                    score: it.score ?? 0,
                    url:
                        it.url ??
                        `https://news.ycombinator.com/item?id=${slice[i]}`,
                }))
            },
            catch: (e) => (e instanceof Error ? e : new Error(String(e))),
        }).pipe(
            Effect.map((data) => data as unknown),
            Effect.orDie
        ),
}

export async function run(opts?: {
    provider?: string
    model?: string
}): Promise<ExampleResult> {
    void opts
    const start = Date.now()
    const provider = 'test' as const

    const mockHnPosts = [
        { id: 1, title: 'New AI breakthrough announced', score: 2500, url: 'https://example.com/ai' },
        { id: 2, title: 'TypeScript 5.5 released', score: 1800, url: 'https://example.com/ts' },
        { id: 3, title: 'React 19 performance improvements', score: 1600, url: 'https://example.com/react' },
    ]

    const mockGetHnPostsTool = {
        ...getHnPostsTool,
        handler: (args: Record<string, unknown>) =>
            Effect.succeed(
                mockHnPosts.slice(0, Math.max(1, Math.min(100, Number(args.count) || 25)))
            ),
    }

    const b = ReactiveAgents.create()
        .withName('hn-gateway-monitor')
        .withProvider(provider)

    const agent = await b
        .withReasoning({ defaultStrategy: 'reactive' })
        .withMaxIterations(8)
        .withTools({
            allowedTools: ['get-hn-posts', 'file-write', 'recall'],
            tools: [mockGetHnPostsTool],
        })
        .withGateway({
            timezone: 'UTC',
            persistMemoryAcrossRuns: true,
            heartbeat: {
                intervalMs: 200,
                policy: 'adaptive',
                instruction: heartbeatInstruction,
                maxConsecutiveSkips: 3,
            },
            crons: [
                {
                    schedule: '*/1 * * * *',
                    instruction: digestInstruction,
                    priority: 'normal' as const,
                    enabled: true,
                },
            ],
            policies: {
                dailyTokenBudget: 50_000,
                maxActionsPerHour: 100,
                heartbeatPolicy: 'adaptive',
            },
        })
        .withObservability({ verbosity: 'normal' })
        .withMemory({
            tier: 'enhanced',
            dbPath: `${REPORT_DIR}/.hn-monitor-test.sqlite`,
        })
        .build()

    let summary: { totalRuns: number; heartbeatsFired: number; cronChecks: number; error?: string }
    const handle = agent.start()

    try {
        // Run for enough time to fire ~2 heartbeats + catch a cron check
        await new Promise((r) => setTimeout(r, 800))
        summary = await handle.stop()
    } catch (e) {
        summary = {
            totalRuns: 0,
            heartbeatsFired: 0,
            cronChecks: 0,
            error: e instanceof Error ? e.message : String(e),
        }
    } finally {
        await agent.dispose()
    }

    const passed =
        summary.totalRuns >= 1 &&
        typeof summary.heartbeatsFired === 'number' &&
        !summary.error

    return {
        passed,
        output: `runs=${summary.totalRuns} hb=${summary.heartbeatsFired} cronChecks=${summary.cronChecks}`,
        steps: summary.totalRuns,
        tokens: 0,
        durationMs: Date.now() - start,
    }
}

async function main(): Promise<void> {
    type PN = 'anthropic' | 'openai' | 'ollama' | 'gemini' | 'litellm' | 'test'
    const envP = process.env.HN_GATEWAY_PROVIDER as PN | undefined
    const provider = (envP ??
        (process.env.ANTHROPIC_API_KEY
            ? 'anthropic'
            : process.env.OPENAI_API_KEY
            ? 'openai'
            : 'ollama')) as PN

    const model =
        process.env.HN_GATEWAY_MODEL ??
        (provider === 'ollama' ? 'cogito:14b' : undefined)

    const timezone = process.env.HN_GATEWAY_TZ ?? 'UTC'
    const memoryDb =
        process.env.HN_GATEWAY_MEMORY_DB ??
        `${REPORT_DIR}/.hn-monitor-memory.sqlite`

    let b = ReactiveAgents.create()
        .withName('hn-gateway-monitor')
        .withProvider(provider)
    if (model) b = b.withModel(model)

    const agent = await b
        .withReasoning({ defaultStrategy: 'reactive', maxIterations: 24 })
        .withMemory({
            tier: 'enhanced',
            dbPath: memoryDb,
        })
        .withMetaTools({ brief: true, find: true, pulse: true, recall: true })
        .withTools({
            allowedTools: ['get-hn-posts', 'file-write', 'recall'],
            tools: [getHnPostsTool],
        })
        .withGateway({
            timezone,
            persistMemoryAcrossRuns: true,
            heartbeat: {
                intervalMs: 60_000,
                policy: 'adaptive',
                instruction: heartbeatInstruction,
                maxConsecutiveSkips: 8,
            },
            crons: [
                {
                    schedule: '*/5 * * * *',
                    instruction: digestInstruction,
                    priority: 'normal',
                },
            ],
            policies: {
                dailyTokenBudget: 200_000,
                maxActionsPerHour: 60,
                heartbeatPolicy: 'adaptive',
            },
        })
        .withObservability({ verbosity: 'verbose', live: true })
        .withHealthCheck()
        .withCostTracking({ daily: 10.0 })
        .build()

    const handle = agent.start()
    console.log('\n╔═══════════════════════════════════════╗')
    console.log('║    HN Gateway Monitor Started        ║')
    console.log('╚═══════════════════════════════════════╝')
    console.log(`Provider:    ${provider}${model ? ` (${model})` : ''}`)
    console.log(`Timezone:    ${timezone}`)
    console.log(`Memory DB:   ${memoryDb}`)
    console.log(`Reports:     ${REPORT_DIR}/report-*.md`)
    console.log(`Cron:        */5 * * * * (every 5 minutes)`)
    console.log(`Heartbeat:   60s (adaptive policy)\n`)
    console.log('Listening for heartbeats and cron events...')
    console.log('Press Ctrl+C to gracefully shutdown.\n')

    let shuttingDown = false
    const shutdown = async () => {
        if (shuttingDown) return
        shuttingDown = true

        console.log('\n╔═══════════════════════════════════════╗')
        console.log('║    Shutting Down Gateway             ║')
        console.log('╚═══════════════════════════════════════╝')

        try {
            const summary = await handle.stop()
            console.log(
                `\nFinal Summary:\n  Runs:      ${summary.totalRuns}\n  Heartbeats: ${summary.heartbeatsFired}\n  Cron Checks: ${summary.cronChecks}`
            )
            if (summary.error) {
                console.log(`\nError: ${summary.error}`)
            }
        } catch (e) {
            console.log(`\nShutdown error: ${e instanceof Error ? e.message : String(e)}`)
        } finally {
            await agent.dispose()
            console.log('\nGateway disposed. Exiting.')
            process.exit(0)
        }
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)

    try {
        await handle.done
    } catch (e) {
        console.error(`\nGateway error: ${e instanceof Error ? e.message : String(e)}`)
        await shutdown()
    }
}

if (import.meta.main) {
    await main()
}
