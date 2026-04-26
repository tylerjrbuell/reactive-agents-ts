import { ReactiveAgents } from '@reactive-agents/runtime'
import { defineTool } from '@reactive-agents/tools'
import { Effect, Schema } from 'effect'

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

const agent = await ReactiveAgents.create()
    .withName('my-agent')
    .withProvider('ollama')
    .withModel('cogito')
    .withMemory()
    .withReasoning()
    // S2.5 Slice C: turn the curator's trust-aware "Recent tool observations:"
    // section ON for this agent. With this set, every system prompt after the
    // first observation step will show the last 5 observations — untrusted
    // (HN response) wrapped in <tool_output> blocks, trusted (recall) plain.
    // Off by default; opting in is per-agent.
    .withContextProfile({ recentObservationsLimit: 5 })
    .withTools({
        // allowedTools: ['get-hn-posts', 'recall'],
        tools: [getHnPostsTool],
    })
    .build()

const result = await agent.run(
    'Fetch and summarize the top 15 posts on Hacker News in a numbered list markdown report for each posts'
)

console.log(result.output)
