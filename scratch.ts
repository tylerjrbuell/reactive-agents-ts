/**
 * Context-handling stress suite — multiple scenarios, each A/B tested with the
 * curator's "Recent tool observations" section OFF vs ON.
 *
 * Goal: identify whether the context system is actually heading in the right
 * direction by stressing specific behaviors, not generic competency.
 *
 * Scenarios target distinct context-handling pressures:
 *   S1  hn-faithful-citation   tool-based   pure faithfulness — exact title cite
 *   S2  selective-filter       tool-based   filter 30 items → cite 3 by criteria
 *   S3  multi-tool-synthesis   tool-based   combine 2 tool outputs into one report
 *   S4  pure-synthesis         tool-less    data in prompt, structure the output
 *
 * Tool results are CACHED at suite start so both A and B see identical data
 * (eliminates network drift as a confound — only the prompt context differs).
 *
 * Run: bun scratch.ts
 */
import { ReactiveAgents } from '@reactive-agents/runtime'
import { Effect } from 'effect'

// ── Cached HN data (fetched once, served deterministically to both runs) ─────
type HnPost = { id: number; title: string; score: number; by?: string; descendants?: number }

const HN_CACHE: HnPost[] = await (async () => {
    const ids = ((await (await fetch(
        'https://hacker-news.firebaseio.com/v0/topstories.json'
    )).json()) as number[]).slice(0, 30)
    const items = await Promise.all(
        ids.map(async (id) => {
            const r = await (
                await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
            ).json()
            return r as { title?: string; score?: number; by?: string; descendants?: number }
        })
    )
    return items.map(
        (it, i): HnPost => ({
            id: ids[i] as number,
            title: it.title ?? '(no title)',
            score: it.score ?? 0,
            by: it.by,
            descendants: it.descendants ?? 0,
        })
    )
})()
console.log(`Pre-fetched ${HN_CACHE.length} HN posts; will serve both runs identically.`)

// ── Tool: cached HN posts ────────────────────────────────────────────────────
const hnTool = {
    definition: {
        name: 'get-hn-posts',
        description: 'Fetch top Hacker News posts (cached for this suite — deterministic).',
        parameters: [
            { name: 'count', type: 'number' as const, description: '1–30', required: true, default: 20 },
        ],
        riskLevel: 'low' as const,
        timeoutMs: 5_000,
        requiresApproval: false,
        source: 'function' as const,
    },
    handler: (args: Record<string, unknown>) =>
        Effect.succeed(
            HN_CACHE.slice(0, Math.min(30, Math.max(1, Number(args.count) || 20))) as unknown
        ),
}

// ── Tool: simple character-count over a string ───────────────────────────────
const countCharsTool = {
    definition: {
        name: 'count-chars',
        description: 'Count the number of characters in the given text.',
        parameters: [
            { name: 'text', type: 'string' as const, description: 'Text to measure', required: true },
        ],
        riskLevel: 'low' as const,
        timeoutMs: 1_000,
        requiresApproval: false,
        source: 'function' as const,
    },
    handler: (args: Record<string, unknown>) =>
        Effect.succeed({ length: String(args.text ?? '').length } as unknown),
}

// ── Scenario definition ──────────────────────────────────────────────────────
interface Scenario {
    id: string
    description: string
    toolBased: boolean
    tools?: typeof hnTool[]
    task: string
    /** Returns 0..1 fidelity score + named bullet checks for the report */
    score: (output: string) => { score: number; checks: Record<string, boolean> }
}

const top5ByScore = [...HN_CACHE].sort((a, b) => b.score - a.score).slice(0, 5)
const top3ByComments = [...HN_CACHE].sort(
    (a, b) => (b.descendants ?? 0) - (a.descendants ?? 0)
).slice(0, 3)
const titleSnippet = (t: string, n = 30) => t.slice(0, Math.min(n, t.length))

const scenarios: Scenario[] = [
    // ─── S1 — pure faithfulness, single tool, multi-item citation ────────────
    {
        id: 'S1-hn-faithful-citation',
        description: 'Fetch 20 HN posts; cite top 5 by score with EXACT titles.',
        toolBased: true,
        tools: [hnTool],
        task: `Fetch the top 20 Hacker News posts via get-hn-posts. Then write a markdown section "## Top 5 by Score" listing exactly the 5 highest-scored posts in descending order. Each line: "1. EXACT_TITLE — score: SCORE". Use exact titles from the tool result. No paraphrasing.`,
        score: (output) => {
            const checks: Record<string, boolean> = {}
            for (const [i, p] of top5ByScore.entries()) {
                const titlePresent = output.includes(titleSnippet(p.title))
                const scorePresent = output.includes(String(p.score))
                checks[`top${i + 1}_title`] = titlePresent
                checks[`top${i + 1}_score`] = scorePresent
            }
            const passed = Object.values(checks).filter(Boolean).length
            return { score: passed / Object.keys(checks).length, checks }
        },
    },

    // ─── S2 — selective filter from a larger set ─────────────────────────────
    {
        id: 'S2-selective-filter',
        description: 'Fetch 25 HN posts; pick 3 with most COMMENTS (not score).',
        toolBased: true,
        tools: [hnTool],
        task: `Fetch the top 25 Hacker News posts via get-hn-posts. Each post has a "descendants" field which is the comment count. Write a markdown section "## Top 3 by Comments" with the 3 posts that have the MOST comments (not the most score). Each line: "1. EXACT_TITLE — comments: COUNT". Sort descending by comment count.`,
        score: (output) => {
            const checks: Record<string, boolean> = {}
            for (const [i, p] of top3ByComments.entries()) {
                const titlePresent = output.includes(titleSnippet(p.title))
                const commentsPresent = output.includes(String(p.descendants ?? 0))
                checks[`pick${i + 1}_title`] = titlePresent
                checks[`pick${i + 1}_comments`] = commentsPresent
            }
            // Bonus: did the agent NOT cite top-by-score posts that aren't in top-by-comments?
            const wrongPicks = top5ByScore
                .filter((p) => !top3ByComments.some((c) => c.id === p.id))
                .filter((p) => output.includes(titleSnippet(p.title)))
            checks['no_score_confusion'] = wrongPicks.length === 0
            const passed = Object.values(checks).filter(Boolean).length
            return { score: passed / Object.keys(checks).length, checks }
        },
    },

    // ─── S3 — multi-tool synthesis (combine outputs from 2 tools) ────────────
    {
        id: 'S3-multi-tool-synthesis',
        description: 'Fetch 10 HN posts; for the top 1 by score, use count-chars on its title; report both.',
        toolBased: true,
        tools: [hnTool, countCharsTool],
        task: `Fetch the top 10 Hacker News posts via get-hn-posts. Find the post with the highest score. Then call count-chars passing that post's exact title to count its characters. Write: "Top post: EXACT_TITLE (SCORE points, TITLE_LENGTH chars)".`,
        score: (output) => {
            const top = [...HN_CACHE].sort((a, b) => b.score - a.score)[0]!
            const checks = {
                title_cited: output.includes(titleSnippet(top.title)),
                score_cited: output.includes(String(top.score)),
                char_count_cited: output.includes(String(top.title.length)),
            }
            const passed = Object.values(checks).filter(Boolean).length
            return { score: passed / Object.keys(checks).length, checks }
        },
    },

    // ─── S4 — pure synthesis (no tools), data in the task itself ─────────────
    {
        id: 'S4-pure-synthesis',
        description: 'No tools. Data inline. Test if curator section helps when nothing was fetched.',
        toolBased: false,
        task: `Below is sales data. Find the salesperson with the highest total and the one with the lowest. Write: "Top: NAME (TOTAL); Bottom: NAME (TOTAL)".

Sales data:
- Alice: 1240
- Bob: 980
- Charlie: 1675
- Diana: 720
- Evan: 1100
- Fiona: 1850
- George: 540
`,
        score: (output) => {
            const checks = {
                top_name: output.includes('Fiona'),
                top_value: output.includes('1850'),
                bottom_name: output.includes('George'),
                bottom_value: output.includes('540'),
            }
            const passed = Object.values(checks).filter(Boolean).length
            return { score: passed / Object.keys(checks).length, checks }
        },
    },
]

// ── Runner ───────────────────────────────────────────────────────────────────
interface RunResult {
    scenarioId: string
    config: 'A-OFF' | 'B-ON'
    wallMs: number
    tokensUsed: number
    stepsCount: number
    output: string
    fidelity: number
    checks: Record<string, boolean>
}

async function runScenario(scn: Scenario, recentObservationsLimit: number): Promise<RunResult> {
    const builder = ReactiveAgents.create()
        .withName(`${scn.id}-${recentObservationsLimit}`)
        .withProvider('ollama')
        .withModel('gemma4:e4b')
        .withMemory()
        .withReasoning()

    if (scn.tools && scn.tools.length > 0) {
        builder.withTools({ tools: scn.tools })
    }
    if (recentObservationsLimit > 0) {
        builder.withContextProfile({ recentObservationsLimit })
    }

    const agent = await builder.build()
    const start = performance.now()
    const result = await agent.run(scn.task)
    const wallMs = performance.now() - start
    const output = String(result.output ?? '')
    const { score, checks } = scn.score(output)

    return {
        scenarioId: scn.id,
        config: recentObservationsLimit > 0 ? 'B-ON' : 'A-OFF',
        wallMs,
        tokensUsed: (result.metadata?.tokensUsed as number | undefined) ?? 0,
        stepsCount: (result.metadata?.stepsCount as number | undefined) ?? 0,
        output,
        fidelity: score,
        checks,
    }
}

// ── Run all scenarios ────────────────────────────────────────────────────────
const results: RunResult[] = []
for (const scn of scenarios) {
    console.log(`\n━━━ ${scn.id} ${scn.toolBased ? '(tool-based)' : '(tool-less)'} ━━━`)
    console.log(`    ${scn.description}`)
    const a = await runScenario(scn, 0)
    console.log(`  A-OFF  fidelity=${(a.fidelity * 100).toFixed(0)}%  tokens=${a.tokensUsed}  steps=${a.stepsCount}  ${(a.wallMs / 1000).toFixed(1)}s`)
    const b = await runScenario(scn, 8)
    console.log(`  B-ON   fidelity=${(b.fidelity * 100).toFixed(0)}%  tokens=${b.tokensUsed}  steps=${b.stepsCount}  ${(b.wallMs / 1000).toFixed(1)}s`)
    results.push(a, b)
}

// ── Aggregate report ─────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════════════════')
console.log('   CONTEXT-HANDLING SUITE — A (section OFF) vs B (section ON, limit=8)')
console.log('══════════════════════════════════════════════════════════════════════════════')
console.log('Model: gemma4:e4b via Ollama. Tool data cached so both runs see identical inputs.\n')

const fmt = (n: number, w = 9) => String(n).padStart(w)
const pct = (delta: number) => (delta > 0 ? `+${delta.toFixed(0)}%` : `${delta.toFixed(0)}%`)

console.log('Scenario                         A fid   B fid   ΔTok   ΔSteps   Verdict')
console.log('─────────────────────────────────────────────────────────────────────────────')
let aTotalFid = 0, bTotalFid = 0
let aTotalTok = 0, bTotalTok = 0
let aTotalSteps = 0, bTotalSteps = 0
let wins = 0, losses = 0, ties = 0

for (const scn of scenarios) {
    const a = results.find((r) => r.scenarioId === scn.id && r.config === 'A-OFF')!
    const b = results.find((r) => r.scenarioId === scn.id && r.config === 'B-ON')!
    aTotalFid += a.fidelity
    bTotalFid += b.fidelity
    aTotalTok += a.tokensUsed
    bTotalTok += b.tokensUsed
    aTotalSteps += a.stepsCount
    bTotalSteps += b.stepsCount

    const fidDelta = b.fidelity - a.fidelity
    const tokDelta = a.tokensUsed === 0 ? 0 : ((b.tokensUsed - a.tokensUsed) / a.tokensUsed) * 100
    const stepDelta = a.stepsCount === 0 ? 0 : ((b.stepsCount - a.stepsCount) / a.stepsCount) * 100

    // Verdict logic:
    //   - fidelity LOSS (B<A) → ✗ regardless of efficiency
    //   - fidelity WIN (B>A)  → ✓
    //   - fidelity TIE + B more efficient (fewer steps OR fewer tokens) → ✓ EFFICIENCY WIN
    //   - fidelity TIE + B less efficient → ≈ TIE (with note)
    let verdict = '≈ tie'
    if (fidDelta < -0.001) {
        verdict = '✗ fid loss'
        losses++
    } else if (fidDelta > 0.001) {
        verdict = '✓ fid win'
        wins++
    } else {
        if (b.stepsCount < a.stepsCount || b.tokensUsed < a.tokensUsed * 0.95) {
            verdict = '✓ eff win'
            wins++
        } else if (b.stepsCount > a.stepsCount && b.tokensUsed > a.tokensUsed * 1.05) {
            verdict = '≈ costlier tie'
            ties++
        } else {
            verdict = '≈ tie'
            ties++
        }
    }

    const idCol = scn.id.padEnd(30)
    console.log(
        `${idCol}  ${fmt((a.fidelity * 100).toFixed(0) + '%', 5)}  ${fmt((b.fidelity * 100).toFixed(0) + '%', 5)}  ${fmt(pct(tokDelta), 6)}  ${fmt(pct(stepDelta), 7)}  ${verdict}`
    )
}

console.log('─────────────────────────────────────────────────────────────────────────────')
console.log(
    `AGGREGATE                       ${fmt(((aTotalFid / scenarios.length) * 100).toFixed(0) + '%', 5)}  ${fmt(((bTotalFid / scenarios.length) * 100).toFixed(0) + '%', 5)}  ${fmt(pct(((bTotalTok - aTotalTok) / aTotalTok) * 100), 6)}  ${fmt(pct(((bTotalSteps - aTotalSteps) / aTotalSteps) * 100), 7)}  ${wins}W ${ties}T ${losses}L`
)

console.log('\n──────────────────  Per-scenario check breakdown  ──────────────────')
for (const scn of scenarios) {
    const a = results.find((r) => r.scenarioId === scn.id && r.config === 'A-OFF')!
    const b = results.find((r) => r.scenarioId === scn.id && r.config === 'B-ON')!
    console.log(`\n${scn.id}:`)
    const allKeys = Object.keys(a.checks)
    for (const k of allKeys) {
        const ax = a.checks[k] ? '✓' : '✗'
        const bx = b.checks[k] ? '✓' : '✗'
        console.log(`  ${k.padEnd(26)} A:${ax}  B:${bx}`)
    }
}

console.log('\n──────────────────────────  Verdict for the suite  ──────────────────────────')
if (wins > losses) {
    console.log(`✓ Context system is heading in the right direction: ${wins}W ${ties}T ${losses}L`)
    console.log(`  The curator section helps on ${wins} scenarios and hurts on ${losses}.`)
} else if (wins === losses) {
    console.log(`≈ Context system is neutral overall: ${wins}W ${ties}T ${losses}L`)
    console.log(`  Wins and losses balance — section is workload-dependent, not strictly better.`)
} else {
    console.log(`✗ Context system needs investigation: ${wins}W ${ties}T ${losses}L`)
    console.log(`  More losses than wins — the section may be overwhelming gemma4:e4b at limit=8.`)
}
console.log('')
