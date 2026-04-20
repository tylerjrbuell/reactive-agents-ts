/**
 * Diagnostic: does the reactive intelligence dispatcher actually fire?
 *
 * Instruments the agent with:
 *  - withReactiveIntelligence() + all _riHooks callbacks
 *  - withTracing() to persist JSONL for post-run analysis
 *
 * After the run, parses the trace and prints a dispatch summary.
 * Compare interventionsDispatched vs interventionsSuppressed to see
 * whether the 4-gate chain is blocking dispatch.
 */
import { ReactiveAgents } from 'reactive-agents'
import { loadTrace, traceStats } from '@reactive-agents/trace'
import { Effect } from 'effect'
import { mkdirSync } from 'fs'

const TRACE_DIR = '.reactive-agents/traces/scratch'
mkdirSync(TRACE_DIR, { recursive: true })

const agent = await ReactiveAgents.create()
    .withProvider('ollama')
    .withModel({ model: 'qwen3:14b' })
    .withReasoning({
        defaultStrategy: 'reactive',
        maxIterations: 8,
    })
    .withReactiveIntelligence({
        autonomy: 'full',
        onEntropyScored: (event, iteration) => {
            console.log(
                `[RI] iter=${iteration} entropy=${(event as { composite: number }).composite?.toFixed(3) ?? '?'}`
            )
        },
        onControllerDecision: (event, context) => {
            const e = event as { decisionType?: string }
            const c = context as { iteration?: number; entropyBefore?: number }
            console.log(
                `[RI] DECISION iter=${c.iteration} type=${e.decisionType} entropyBefore=${c.entropyBefore?.toFixed(3) ?? '?'}`
            )
            return 'accept'
        },
        onMidRunAdjustment: (type, before, after) => {
            console.log(
                `[RI] INTERVENTION type=${type} before=${JSON.stringify(before)} after=${JSON.stringify(after)}`
            )
        },
    })
    .withObservability({ verbosity: 'verbose', live: true })
    .withTracing({ dir: TRACE_DIR })
    .withTools({
        tools: [
            {
                definition: {
                    name: 'get-hn-posts',
                    description:
                        'Get current top Hacker News front-page stories (official API). Call this tool to get the top N posts.',
                    parameters: [
                        {
                            name: 'count',
                            type: 'number',
                            description: 'The number of posts to return',
                            required: true,
                            default: 10,
                        },
                    ],
                    riskLevel: 'low',
                    timeoutMs: 10000,
                    requiresApproval: false,
                    source: 'function',
                },
                handler: (args) =>
                    Effect.tryPromise({
                        try: async () => {
                            const n = Math.min(
                                100,
                                Math.max(1, Number(args.count) || 10)
                            )
                            const listRes = await fetch(
                                'https://hacker-news.firebaseio.com/v0/topstories.json'
                            )
                            if (!listRes.ok)
                                throw new Error(
                                    `HN topstories HTTP ${listRes.status}`
                                )
                            const ids = (await listRes.json()) as number[]
                            const items = await Promise.all(
                                ids.slice(0, n).map(async (id) => {
                                    const r = await fetch(
                                        `https://hacker-news.firebaseio.com/v0/item/${id}.json`
                                    )
                                    if (!r.ok)
                                        throw new Error(
                                            `HN item ${id} HTTP ${r.status}`
                                        )
                                    return r.json() as Promise<{
                                        title?: string
                                        score?: number
                                        url?: string
                                    }>
                                })
                            )
                            return ids
                                .slice(0, n)
                                .map((id, i) => ({
                                    id,
                                    title: items[i]?.title ?? '(no title)',
                                    score: items[i]?.score ?? 0,
                                    url:
                                        items[i]?.url ??
                                        `https://news.ycombinator.com/item?id=${id}`,
                                }))
                        },
                        catch: (e) =>
                            e instanceof Error ? e : new Error(String(e)),
                    }).pipe(Effect.map((d) => d as unknown), Effect.orDie),
            },
        ],
    })
    .build()

// Multi-step task requiring distinct tool calls + reasoning to force 4+ iterations.
const result = await agent.run(
    `Research task — complete each step before moving to the next:
Step 1: Fetch the top 5 HN posts and list them with scores.
Step 2: For each post, write one sentence explaining why it likely trended.
Step 3: Identify which single topic dominates HN today and write a 2-sentence argument for that claim.
Step 4: Predict whether this topic will still dominate tomorrow. Justify with evidence from the scores.

Do not combine steps. Complete and state each step result explicitly before starting the next.`
)

console.log('\n--- Result ---')
console.log(result.output)

await agent.dispose()

// --- Post-run trace analysis ---
console.log('\n--- Trace Analysis ---')
try {
    const tracePath = `${TRACE_DIR}/${result.taskId}.jsonl`
    const trace = await loadTrace(tracePath)
    const stats = traceStats(trace)

    console.log(`Trace file: ${tracePath}`)
    console.log(`Iterations: ${stats.iterations}`)
    console.log(`Interventions dispatched: ${stats.interventionsDispatched}`)
    console.log(`Interventions suppressed: ${stats.interventionsSuppressed}`)
    console.log(
        `Max entropy: ${stats.maxEntropy != null ? stats.maxEntropy.toFixed(3) : 'n/a'}`
    )
    console.log(
        `Avg entropy: ${stats.avgEntropy != null ? stats.avgEntropy.toFixed(3) : 'n/a'}`
    )

    if (stats.interventionsSuppressed > 0) {
        console.log(
            '\n⚠️  Interventions were suppressed — check thresholds in reactive-intelligence config'
        )
    }
    if (stats.iterations === 0 && stats.maxEntropy === 0) {
        console.log(
            '\n❌ No entropy-scored events in trace — RI layer may not be active'
        )
    } else if (
        stats.interventionsDispatched === 0 &&
        stats.interventionsSuppressed === 0
    ) {
        console.log(
            `\nRI active — entropy scored ${stats.iterations} time(s), max=${stats.maxEntropy.toFixed(3)}, 0 dispatched/suppressed (evaluators returned no decisions)`
        )
    }
} catch (e) {
    console.error('Failed to load trace:', e)
}
