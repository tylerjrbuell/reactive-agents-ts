import * as readline from 'node:readline'
import chalk from 'chalk'
import { Effect, Schema } from 'effect'
import { ReactiveAgents } from 'reactive-agents'
import { defineTool } from '@reactive-agents/tools'
import {
    banner,
    kv,
    muted,
    divider,
    agentResponse,
    metricsSummary,
} from '../ui.js'
import { demoResponses, DEMO_TASK } from './demo-responses.js'

// ── Hacker News tool — self-contained, no API key required ─────────────────
// Live demo proof: the agent fetches the current HN front page (live data,
// not training-data regurgitation) and summarizes it. Defined with the
// canonical `defineTool` factory + Effect Schema so it follows the same
// patterns the rest of the framework recommends.
const getHnPostsTool = defineTool({
    name: 'get-hn-posts',
    description:
        'Fetch current Hacker News front-page stories (title, score, url) via the official API.',
    input: Schema.Struct({
        count: Schema.Number,
    }),
    riskLevel: 'low',
    timeoutMs: 20_000,
    handler: ({ count }) =>
        Effect.tryPromise({
            try: async () => {
                const n = Math.min(10, Math.max(1, count || 5))
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
        }),
})

const VIOLET = '#8b5cf6'
const CYAN = '#06b6d4'

type ProviderInfo = { provider: string; model: string; label: string }

function renderModelColumns(models: string[]): void {
    const termWidth = process.stdout.columns ?? 80
    const idxWidth = String(models.length).length
    const longestName = models.reduce((n, m) => Math.max(n, m.length), 0)
    const cellWidth = idxWidth + 2 + longestName + 2 // "NN  name  "
    const cols = Math.max(1, Math.floor((termWidth - 2) / cellWidth))
    const rows = Math.ceil(models.length / cols)

    for (let r = 0; r < rows; r++) {
        const parts: string[] = []
        for (let c = 0; c < cols; c++) {
            const i = c * rows + r
            if (i >= models.length) continue
            const n = String(i + 1).padStart(idxWidth)
            const name = models[i]!.padEnd(longestName)
            parts.push(`${chalk.hex(CYAN)(n)}  ${name}`)
        }
        console.log(`  ${parts.join('  ')}`)
    }
}

async function pickOllamaModel(models: string[]): Promise<string | null> {
    if (models.length === 0) return null
    if (models.length === 1) return models[0]!
    if (!process.stdin.isTTY) return models[0]!

    console.log(
        chalk.hex(VIOLET).bold('🦙 Ollama models available ') +
            muted(`(${models.length})`)
    )
    renderModelColumns(models)
    console.log()

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    })

    return new Promise((resolve) => {
        const ask = (): void => {
            rl.question(
                chalk.dim(
                    `Select a model [1-${models.length}] or filter text (1): `
                ),
                (answer) => {
                    const trimmed = answer.trim()
                    if (trimmed === '') {
                        rl.close()
                        resolve(models[0]!)
                        return
                    }
                    const asNum = Number(trimmed)
                    if (
                        Number.isInteger(asNum) &&
                        asNum >= 1 &&
                        asNum <= models.length
                    ) {
                        rl.close()
                        resolve(models[asNum - 1]!)
                        return
                    }
                    const needle = trimmed.toLowerCase()
                    const matches = models.filter((m) =>
                        m.toLowerCase().includes(needle)
                    )
                    if (matches.length === 1) {
                        rl.close()
                        resolve(matches[0]!)
                        return
                    }
                    if (matches.length === 0) {
                        console.log(
                            muted(`  no match for "${trimmed}" — try again`)
                        )
                        ask()
                        return
                    }
                    console.log(
                        muted(
                            `  ${matches.length} matches for "${trimmed}":`
                        )
                    )
                    renderModelColumns(matches)
                    ask()
                }
            )
        }
        ask()
    })
}

async function detectOllama(): Promise<ProviderInfo | null> {
    const endpoint = process.env.OLLAMA_ENDPOINT ?? 'http://localhost:11434'
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2000)
    try {
        const response = await fetch(`${endpoint}/api/tags`, {
            signal: controller.signal,
        })
        if (!response.ok) return null

        const data = (await response.json()) as {
            models?: Array<{ name: string }>
        }
        const models: string[] = (data.models ?? []).map((m) => m.name)
        if (models.length === 0) return null

        const model = await pickOllamaModel(models)
        if (!model) return null

        return {
            provider: 'ollama',
            model,
            label: `Ollama · ${model}`,
        }
    } catch {
        return null
    } finally {
        clearTimeout(timer)
    }
}

async function detectProvider(): Promise<ProviderInfo | null> {
    // Check Ollama first
    const ollama = await detectOllama()
    if (ollama) return ollama

    if (process.env.ANTHROPIC_API_KEY) {
        return {
            provider: 'anthropic',
            model: 'claude-haiku-4-5-20251001',
            label: 'Anthropic · claude-haiku-4-5',
        }
    }
    if (process.env.OPENAI_API_KEY) {
        return {
            provider: 'openai',
            model: 'gpt-4o-mini',
            label: 'OpenAI · gpt-4o-mini',
        }
    }
    if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
        return {
            provider: 'google',
            model: 'gemini-2.0-flash',
            label: 'Google · gemini-2.0-flash',
        }
    }
    return null
}

async function runLiveDemo(detected: ProviderInfo): Promise<void> {
    console.log(chalk.hex(VIOLET).bold('🎯 Task'))
    console.log(kv('Prompt', DEMO_TASK))
    console.log(kv('Provider', chalk.hex(CYAN)(detected.label)))
    console.log(kv('Mode', chalk.green('live agent run')))
    console.log()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const agent = await (ReactiveAgents.create() as any)
        .withName('demo-agent')
        .withProvider(detected.provider)
        .withModel(detected.model)
        .withReasoning()
        .withObservability()
        .withTools({ tools: [getHnPostsTool] })
        .build()

    const startTime = Date.now()
    const result = await agent.run(DEMO_TASK)
    const duration = Date.now() - startTime

    console.log()
    agentResponse(result.output ? String(result.output) : '(no output)')
    console.log()

    // Read real metadata where available — fall back gracefully if a field
    // is missing. `toolsUsed` is set by the runtime debrief; for older
    // metadata shapes we count distinct names from toolCallHistory.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = (result.metadata ?? {}) as any
    const toolsUsedArr: unknown =
        meta.toolsUsed ??
        meta.debrief?.toolsUsed ??
        (Array.isArray(meta.toolCallHistory)
            ? Array.from(
                  new Set(
                      meta.toolCallHistory.map(
                          (t: { name?: string }) => t?.name ?? ''
                      )
                  )
              )
            : [])
    const toolsCount = Array.isArray(toolsUsedArr) ? toolsUsedArr.length : 0

    metricsSummary({
        duration: meta.duration ?? duration,
        steps: meta.stepsCount ?? 1,
        tokens: meta.tokensUsed ?? 0,
        tools: toolsCount,
        success: result.success,
    })
    console.log()
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function runReplayDemo(): Promise<void> {
    console.log(
        chalk.hex(VIOLET)('ℹ') +
            ' ' +
            chalk.dim(
                'No API key detected — showing recorded example output.'
            ) +
            ' ' +
            chalk.hex(CYAN)(
                'Set ANTHROPIC_API_KEY (or OPENAI_API_KEY) and re-run for a live agent.'
            )
    )
    console.log()

    console.log(chalk.hex(VIOLET).bold('🎯 Task'))
    console.log(kv('Prompt', DEMO_TASK))
    console.log(kv('Mode', muted('example output (recorded)')))
    console.log()

    for (const step of [
        'Calling get-hn-posts to fetch the current HN front page',
        'Tool returned 5 stories — formatting as numbered list',
        'Synthesizing one-paragraph summary of trending themes',
    ]) {
        console.log(`  ${chalk.hex(VIOLET)('💭')} ${chalk.dim(step)}`)
        await sleep(420)
    }
    console.log()

    agentResponse(demoResponses['fetch the top 5 stories on Hacker News'])
    console.log()

    metricsSummary({
        duration: 4200,
        steps: 3,
        tokens: 412,
        tools: 1,
        success: true,
    })
    console.log()
}

export async function runDemo(_argv: string[]): Promise<void> {
    banner(
        'Reactive Agents — Live Demo',
        'The open-source agent framework built for control, not magic.'
    )
    console.log()

    const detected = await detectProvider()
    if (detected) {
        await runLiveDemo(detected)
    } else {
        await runReplayDemo()
    }

    divider()
    console.log()
    console.log(chalk.hex(VIOLET).bold('🚀 Liked what you saw?'))
    console.log()
    console.log(kv('Install', chalk.hex(CYAN)('bun add reactive-agents')))
    console.log(kv('Scaffold', chalk.hex(CYAN)('rax init my-agent')))
    console.log(kv('Docs', muted('https://docs.reactiveagents.dev/')))
    console.log(
        kv(
            'GitHub',
            muted('https://github.com/tylerjrbuell/reactive-agents-ts')
        )
    )
    console.log()
}
