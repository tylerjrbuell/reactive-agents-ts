/**
 * Unified runner for all Reactive Agents examples.
 *
 * Usage:
 *   bun run index.ts              # all examples
 *   bun run index.ts --offline    # offline-only (no API key needed)
 *   bun run index.ts --filter foundations  # single category
 *   bun run index.ts 01 05 12     # specific examples by number
 */

export interface ExampleResult {
    passed: boolean
    output: string
    steps: number
    tokens: number
    durationMs: number
}

export interface RunConfig {
    provider?: string
    model?: string
}

// ─── Default LLM config for live examples ─────────────────────────────────────
// Set these to use a specific provider/model across all examples that support
// live mode. Leave undefined to auto-detect from environment variables.
//
// Examples:
//   DEFAULT_PROVIDER = "openai";  DEFAULT_MODEL = "gpt-4o";
//   DEFAULT_PROVIDER = "ollama";  DEFAULT_MODEL = "cogito:14b";
//   DEFAULT_PROVIDER = "anthropic"; DEFAULT_MODEL = "claude-opus-4-6";
const DEFAULT_PROVIDER: string | undefined = process.env.DEFAULT_PROVIDER || 'ollama'
const DEFAULT_MODEL: string | undefined = process.env.DEFAULT_MODEL || 'cogito:14b'

interface ExampleMeta {
    num: string
    label: string
    category: string
    requiresKey: boolean
    path: string
    /**
     * Aspirational failing-example flag. When true, this example documents a
     * capability gap or unimplemented surface — it is expected to fail (xfail)
     * under the current build. Runner inverts the verdict:
     *   - expectsFail && !passed  → counted as PASS (xfail OK)
     *   - expectsFail && passed   → counted as FAIL (unexpected pass — feature
     *     now exists; demote this flag and tighten witness).
     * When the targeted feature ships, remove the flag in the same commit so
     * regression is caught immediately.
     */
    expectsFail?: boolean
}

const EXAMPLES: ExampleMeta[] = [
    // foundations — offline
    {
        num: '01',
        label: 'simple-agent',
        category: 'foundations',
        requiresKey: false,
        path: './src/foundations/01-simple-agent.ts',
    },
    {
        num: '02',
        label: 'lifecycle-hooks',
        category: 'foundations',
        requiresKey: false,
        path: './src/foundations/02-lifecycle-hooks.ts',
    },
    {
        num: '03',
        label: 'multi-turn-memory',
        category: 'foundations',
        requiresKey: false,
        path: './src/foundations/03-multi-turn-memory.ts',
    },
    {
        num: '04',
        label: 'agent-composition',
        category: 'foundations',
        requiresKey: false,
        path: './src/foundations/04-agent-composition.ts',
    },
    {
        num: 'F5',
        label: 'agent-config',
        category: 'foundations',
        requiresKey: false,
        path: './src/foundations/05-agent-config.ts',
    },
    {
        num: 'F6',
        label: 'composition',
        category: 'foundations',
        requiresKey: false,
        path: './src/foundations/06-composition.ts',
    },
    {
        num: 'F7',
        label: 'cross-session-skill-recall',
        category: 'foundations',
        requiresKey: false,
        path: './src/foundations/07-cross-session-skill-recall.ts',
    },
    // tools — 05 offline, 06-07 real
    {
        num: '05',
        label: 'builtin-tools',
        category: 'tools',
        requiresKey: false,
        path: './src/tools/05-builtin-tools.ts',
    },
    {
        num: '06',
        label: 'mcp-filesystem',
        category: 'tools',
        requiresKey: true,
        path: './src/tools/06-mcp-filesystem.ts',
    },
    {
        num: '07',
        label: 'mcp-github',
        category: 'tools',
        requiresKey: true,
        path: './src/tools/07-mcp-github.ts',
    },
    {
        num: 'T7',
        label: 'dynamic-registration',
        category: 'tools',
        requiresKey: false,
        path: './src/tools/dynamic-registration.ts',
    },
    {
        num: 'T8',
        label: 'healing-malformed-tool-call',
        category: 'tools',
        requiresKey: false,
        path: './src/tools/healing-malformed-tool-call.ts',
    },
    // multi-agent — real
    {
        num: '08',
        label: 'a2a-protocol',
        category: 'multi-agent',
        requiresKey: true,
        path: './src/multi-agent/08-a2a-protocol.ts',
    },
    {
        num: '09',
        label: 'orchestration',
        category: 'multi-agent',
        requiresKey: true,
        path: './src/multi-agent/09-orchestration.ts',
    },
    {
        num: '10',
        label: 'dynamic-spawning',
        category: 'multi-agent',
        requiresKey: true,
        path: './src/multi-agent/10-dynamic-spawning.ts',
    },
    // trust — real
    {
        num: '11',
        label: 'identity',
        category: 'trust',
        requiresKey: true,
        path: './src/trust/11-identity.ts',
    },
    {
        num: '12',
        label: 'guardrails',
        category: 'trust',
        requiresKey: true,
        path: './src/trust/12-guardrails.ts',
    },
    {
        num: '13',
        label: 'verification',
        category: 'trust',
        requiresKey: true,
        path: './src/trust/13-verification.ts',
    },
    // advanced — mostly real, 15 offline
    {
        num: '14',
        label: 'cost-tracking',
        category: 'advanced',
        requiresKey: true,
        path: './src/advanced/14-cost-tracking.ts',
    },
    {
        num: '15',
        label: 'prompt-experiments',
        category: 'advanced',
        requiresKey: false,
        path: './src/advanced/15-prompt-experiments.ts',
    },
    {
        num: '16',
        label: 'eval-framework',
        category: 'advanced',
        requiresKey: true,
        path: './src/advanced/16-eval-framework.ts',
    },
    {
        num: '17',
        label: 'observability',
        category: 'advanced',
        requiresKey: true,
        path: './src/advanced/17-observability.ts',
    },
    {
        num: '18',
        label: 'self-improvement',
        category: 'advanced',
        requiresKey: true,
        path: './src/advanced/18-self-improvement.ts',
    },
    {
        num: 'A20',
        label: 'compose-harness',
        category: 'advanced',
        requiresKey: false,
        path: './src/advanced/20-compose-harness.ts',
    },
    {
        num: 'A21',
        label: 'snapshot-replay-determinism',
        category: 'advanced',
        requiresKey: false,
        path: './src/advanced/snapshot-replay-determinism.ts',
    },
    {
        num: 'A22',
        label: 'with-lean-harness',
        category: 'advanced',
        requiresKey: false,
        path: './src/advanced/with-lean-harness.ts',
    },
    // reasoning — 20 offline
    {
        num: '19',
        label: 'reasoning-strategies',
        category: 'reasoning',
        requiresKey: true,
        path: './src/reasoning/19-reasoning-strategies.ts',
    },
    {
        num: '20',
        label: 'context-profiles',
        category: 'reasoning',
        requiresKey: false,
        path: './src/reasoning/20-context-profiles.ts',
    },
    {
        num: 'R21',
        label: 'strategy-switch-live',
        category: 'reasoning',
        requiresKey: false,
        path: './src/reasoning/21-strategy-switch-live.ts',
    },
    {
        num: 'R22',
        label: 'long-context-curation',
        category: 'reasoning',
        requiresKey: false,
        path: './src/reasoning/22-long-context-curation.ts',
    },
    // interaction — offline
    {
        num: '21',
        label: 'interaction-modes',
        category: 'interaction',
        requiresKey: false,
        path: './src/interaction/21-interaction-modes.ts',
    },
    // gateway — offline (fast heartbeat interval in test mode)
    {
        num: '22',
        label: 'persistent-gateway',
        category: 'gateway',
        requiresKey: false,
        path: './src/gateway/22-persistent-gateway.ts',
    },
    {
        num: '25',
        label: 'hn-gateway-monitor',
        category: 'gateway',
        requiresKey: false,
        path: './src/gateway/25-hn-gateway-monitor.ts',
    },
    {
        num: '26',
        label: 'gateway-chat-mode',
        category: 'gateway',
        requiresKey: false,
        path: './src/gateway/26-gateway-chat-mode.ts',
    },
    // streaming — offline
    {
        num: '23',
        label: 'token-streaming',
        category: 'streaming',
        requiresKey: false,
        path: './src/streaming/23-token-streaming.ts',
    },
    {
        num: '24',
        label: 'streaming-sse-server',
        category: 'streaming',
        requiresKey: false,
        path: './src/streaming/24-streaming-sse-server.ts',
    },
    {
        num: 'S25',
        label: 'run-handle-cancel',
        category: 'streaming',
        requiresKey: false,
        path: './src/streaming/run-handle-cancel.ts',
    },
    // messaging — requires Docker (Signal MCP) + Telegram session
    {
        num: 'M28',
        label: 'signal-telegram-hub',
        category: 'messaging',
        requiresKey: true,
        path: './src/messaging/signal-telegram-hub.ts',
    },
]

// ─── Argument parsing ─────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const offlineOnly = args.includes('--offline')
const strictMode = args.includes('--strict')

// --filter <category> or --filter=<category>
let filterCategory: string | null = null
const filterIdx = args.indexOf('--filter')
if (filterIdx !== -1 && args[filterIdx + 1]) {
    filterCategory = args[filterIdx + 1]
} else {
    const filterEq = args.find((a) => a.startsWith('--filter='))
    if (filterEq) filterCategory = filterEq.split('=')[1]
}

// numeric filters e.g. "01 05 12"
const numFilter = args.filter((a) => /^\d+$/.test(a))

const toRun = EXAMPLES.filter((e) => {
    if (offlineOnly && e.requiresKey) return false
    if (filterCategory && e.category !== filterCategory) return false
    if (numFilter.length > 0 && !numFilter.includes(e.num)) return false
    return true
})

// ─── Runner ───────────────────────────────────────────────────────────────────

const LINE = '─'.repeat(70)

console.log(`\n┌${LINE}┐`)
console.log(`│  Reactive Agents — Example Suite${' '.repeat(70 - 34 - 1)}│`)
console.log(
    `│  ${toRun.length} example(s) selected  [offline=${offlineOnly}${
        filterCategory ? ` filter=${filterCategory}` : ''
    }]${' '.repeat(
        Math.max(
            0,
            70 -
                3 -
                String(toRun.length).length -
                19 -
                (filterCategory ? filterCategory.length + 8 : 0) -
                1
        )
    )}│`
)
console.log(`└${LINE}┘\n`)

type RunRecord = {
    meta: ExampleMeta
    result: ExampleResult | null
    error: string | null
}
const results: RunRecord[] = []

for (const meta of toRun) {
    const xfailTag = meta.expectsFail ? ' [xfail]' : ''
    const label = `[${meta.num}] ${meta.category}/${meta.label}${xfailTag}`.padEnd(50)
    process.stdout.write(`${label} `)
    const wallStart = Date.now()
    try {
        const mod = (await import(meta.path)) as {
            run: (opts?: RunConfig) => Promise<ExampleResult>
        }
        console.log(DEFAULT_MODEL, DEFAULT_PROVIDER)
        const result = await mod.run({
            provider: DEFAULT_PROVIDER,
            model: DEFAULT_MODEL,
        })
        const elapsed = Date.now() - wallStart
        // xfail logic: when expectsFail is set, an example failing is the
        // expected outcome (counted as PASS). An example unexpectedly passing
        // is counted as FAIL — the targeted feature has shipped and the flag
        // must be removed to lock in the new behaviour as a regression gate.
        const xfailUnexpectedPass = meta.expectsFail === true && result.passed
        const xfailOk = meta.expectsFail === true && !result.passed
        const effectivePassed = xfailOk || (!meta.expectsFail && result.passed)
        const icon = xfailUnexpectedPass
            ? '⚠️ '
            : xfailOk
            ? '🟡'
            : result.passed
            ? '✅'
            : '❌'
        const tag = xfailUnexpectedPass
            ? '  UNEXPECTED PASS (drop expectsFail!)'
            : xfailOk
            ? '  xfail OK'
            : ''
        console.log(
            `${icon}  ${result.steps}st  ${result.tokens}tk  ${elapsed}ms${tag}`
        )
        results.push({ meta, result, error: null })
    } catch (err) {
        const elapsed = Date.now() - wallStart
        const msg = String(err).slice(0, 55)
        // Thrown error in an xfail example is also an expected outcome.
        const xfailOk = meta.expectsFail === true
        const icon = xfailOk ? '🟡' : '❌'
        const tag = xfailOk ? '  xfail OK (threw)' : ''
        console.log(`${icon}  ERROR: ${msg}  ${elapsed}ms${tag}`)
        results.push({ meta, result: null, error: String(err) })
    }
}

// Compute verdicts under xfail semantics.
// In --strict mode, xfail tolerance is disabled (every example must truly
// pass). Strict mode is intended as the final release-gate target once all
// failing-spec witnesses have been closed; until then it will surface those
// gaps as hard failures.
function effectivePassed(r: RunRecord): boolean {
    if (r.meta.expectsFail && !strictMode) {
        if (r.error !== null) return true
        return r.result !== null && r.result.passed === false
    }
    return r.result?.passed === true
}

function unexpectedPass(r: RunRecord): boolean {
    return r.meta.expectsFail === true && r.result?.passed === true
}

const passed = results.filter(effectivePassed).length
const failed = results.length - passed
const xfails = results.filter((r) => r.meta.expectsFail).length
const unexpectedPasses = results.filter(unexpectedPass).length

console.log(`\n${'━'.repeat(70)}`)
console.log(
    `Passed: ${passed}/${results.length}   Failed: ${failed}   xfail: ${xfails}   unexpected-pass: ${unexpectedPasses}`
)
if (failed > 0) {
    console.log('\nFailed examples:')
    for (const r of results.filter((r) => !effectivePassed(r))) {
        const reason = unexpectedPass(r)
            ? 'UNEXPECTED PASS — drop expectsFail flag and tighten witness'
            : r.error ?? r.result?.output.slice(0, 80) ?? 'unknown'
        console.log(`  [${r.meta.num}] ${r.meta.label}: ${reason}`)
    }
}
if (xfails > 0) {
    console.log(
        `\n${xfails} xfail example(s) — capability gap(s) documented as failing-spec witnesses.`
    )
}
console.log()

// Strict mode treats any failure (including unexpected xfail passes) as fatal.
// Default mode: fail iff there is at least one non-xfail failure.
process.exit(failed > 0 ? 1 : 0)
