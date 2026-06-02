/**
 * perf-bottleneck-isolation.ts — performance + bottleneck isolation harness.
 * (Renamed from scratch-perf.ts; cited as scratch-perf in pre-2026-06-01 wiki reports.)
 *
 * Runs controlled variants to separate framework cost from model/warm-up:
 *   V0  warm-up   — tiny no-tool task, memory OFF (warms ollama; discarded)
 *   V1  baseline  — tiny no-tool task, memory OFF (pure framework overhead, warm)
 *   V2  +memory   — same task, memory ON (isolates memory-flush cost)
 *   V3  +tools    — small deterministic 2-tool task, memory OFF (tool-path cost)
 *
 * Usage: DEFAULT_MODEL=qwen3.5:latest bun run apps/examples/src/research/perf-bottleneck-isolation.ts
 */
import { ReactiveAgents } from 'reactive-agents'
import type { AgentEvent } from '@reactive-agents/core'

const PROVIDER = process.env.DEFAULT_PROVIDER || 'ollama'
const MODEL = process.env.DEFAULT_MODEL || 'qwen3.5:latest'

interface Agg { count: number; totalMs: number }

interface Probe {
    phases: Map<string, Agg>
    tools: Map<string, Agg>
    phaseEntered: number
    toolCalls: number
}

function newProbe(): Probe {
    return { phases: new Map(), tools: new Map(), phaseEntered: 0, toolCalls: 0 }
}
function bump(m: Map<string, Agg>, k: string, ms: number): void {
    const a = m.get(k) ?? { count: 0, totalMs: 0 }
    a.count += 1; a.totalMs += ms; m.set(k, a)
}
function handler(p: Probe) {
    return (ev: AgentEvent): void => {
        if (ev._tag === 'ExecutionPhaseEntered') p.phaseEntered += 1
        else if (ev._tag === 'ExecutionPhaseCompleted') bump(p.phases, ev.phase, ev.durationMs)
        else if (ev._tag === 'ToolCallCompleted') { p.toolCalls += 1; bump(p.tools, ev.toolName ?? 'unknown', ev.durationMs) }
    }
}
const fmt = (ms: number) => `${ms.toFixed(0)}ms`

interface VariantResult {
    label: string
    buildMs: number
    runMs: number
    probe: Probe
    steps: number
    tokens: number
    inTok: number
    outTok: number
    terminatedBy: string | undefined
    success: boolean
}

async function runVariant(
    label: string,
    opts: { memory: boolean; tools: boolean; task: string },
): Promise<VariantResult> {
    const buildStart = performance.now()
    let b = ReactiveAgents.create()
        .withName(`perf-${label}`)
        .withProvider(PROVIDER)
        .withModel(MODEL)
        .withReasoning({ defaultStrategy: 'reactive', enableStrategySwitching: false })
    if (opts.tools) b = b.withTools()
    b = opts.memory ? b.withMemory() : b.withoutMemory()
    const agent = await b.build()
    const buildMs = performance.now() - buildStart

    const probe = newProbe()
    const unsub = await agent.subscribe(handler(probe))
    const runStart = performance.now()
    const result = await agent.run(opts.task)
    const runMs = performance.now() - runStart
    await unsub()
    await agent.dispose()

    return {
        label, buildMs, runMs, probe,
        steps: result.metadata.stepsCount,
        tokens: result.metadata.tokensUsed,
        inTok: result.metadata.inputTokens ?? 0,
        outTok: result.metadata.outputTokens ?? 0,
        terminatedBy: result.terminatedBy,
        success: result.success,
    }
}

function report(v: VariantResult): void {
    const phaseTotal = [...v.probe.phases.values()].reduce((s, a) => s + a.totalMs, 0)
    const toolTotal = [...v.probe.tools.values()].reduce((s, a) => s + a.totalMs, 0)
    const think = v.probe.phases.get('think')?.totalMs ?? 0
    const memFlush = v.probe.phases.get('memory-flush')?.totalMs ?? 0
    const framework = phaseTotal - think - toolTotal
    const unaccounted = v.runMs - phaseTotal
    console.log(`\n━━━ ${v.label} ━━━ build=${fmt(v.buildMs)} run=${fmt(v.runMs)} steps=${v.steps} tok=${v.tokens}(in=${v.inTok}/out=${v.outTok}) term=${v.terminatedBy} ok=${v.success}`)
    console.log(`  think(LLM)=${fmt(think)} memFlush=${fmt(memFlush)} tools=${fmt(toolTotal)} otherFw=${fmt(framework - memFlush)} unaccounted=${fmt(unaccounted)} (${((unaccounted / v.runMs) * 100).toFixed(0)}%)`)
    const top = [...v.probe.phases.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs).slice(0, 5)
    console.log(`  top phases: ${top.map(([k, a]) => `${k}=${fmt(a.totalMs)}`).join('  ')}`)
}

async function main(): Promise<void> {
    console.log(`\n=== scratch-perf controlled variants — ${PROVIDER}/${MODEL} ===`)
    const TINY = 'Reply with exactly the word: DONE. No tools, no explanation.'
    const TOOLS = 'Write the word "ok" to ./perf-x.txt then read it back. One-line final answer.'

    // V0 warm-up (discard)
    console.log('\n[warming model...]')
    await runVariant('V0-warmup', { memory: false, tools: false, task: TINY })

    const v1 = await runVariant('V1-baseline-nomem-notools', { memory: false, tools: false, task: TINY })
    const v2 = await runVariant('V2-memory-on', { memory: true, tools: false, task: TINY })
    const v3 = await runVariant('V3-tools-nomem', { memory: false, tools: true, task: TOOLS })

    report(v1)
    report(v2)
    report(v3)

    console.log(`\n─── DELTAS ───`)
    const memFlush1 = v1.probe.phases.get('memory-flush')?.totalMs ?? 0
    const memFlush2 = v2.probe.phases.get('memory-flush')?.totalMs ?? 0
    console.log(`  memory-flush cost (V2 - V1): ${fmt(memFlush2 - memFlush1)}  [isolated memory subsystem overhead]`)
    console.log(`  build delta (V2 - V1):       ${fmt(v2.buildMs - v1.buildMs)}  [memory layer construction]`)
    const u1 = v1.runMs - [...v1.probe.phases.values()].reduce((s, a) => s + a.totalMs, 0)
    console.log(`  baseline unaccounted (warm): ${fmt(u1)} (${((u1 / v1.runMs) * 100).toFixed(0)}%)  [Effect runtime/fiber scheduling on simplest path]`)
    console.log()
}

main().catch((e) => { console.error('scratch-perf FAILED:', e); process.exit(1) })
