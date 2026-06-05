import { ReactiveAgents } from 'reactive-agents'

// Env-parametrized so spot-test variants run without re-editing.
const PROVIDER = process.env.SPOT_PROVIDER ?? 'ollama'
const MODEL = process.env.SPOT_MODEL ?? 'gemma4:e4b'
const TASK =
    process.env.SPOT_TASK ??
    'Fetch the last 10 commits to tylerjrbuell/reactive-agents-ts then write a local markdown file (./commits.md) with all 10 commit messages.'
const TOOLS = (
    process.env.SPOT_TOOLS ?? 'file-write,github/list_commits'
).split(',')
// Pin the strategy so the RA_ASSEMBLY A/B isolates context-assembly on a single
// think path. adaptive may pick plan-execute/ToT (separate assembly) → the seam
// wouldn't fire on both arms. 'reactive' routes through kernel think.ts where the
// seam lives. Default reactive for the grid; override via SPOT_STRATEGY.
const STRATEGY = (process.env.SPOT_STRATEGY ?? 'reactive') as
    | 'reactive'
    | 'adaptive'
    | 'reflexion'
    | 'plan-execute-reflect'
    | 'tree-of-thought'

let builder = ReactiveAgents.create()
    .withPersona({
        role: 'Github Agent',
        background: 'Expert in Github task execution',
        instructions: 'Use github provided tools to solve your task',
        tone: 'friendly, concise',
    })
    .withProvider(
        PROVIDER as 'ollama' | 'openai' | 'anthropic' | 'gemini' | 'litellm'
    )
    .withModel({ model: MODEL, numCtx: 12000 })
    .withReasoning({
        defaultStrategy: STRATEGY,
        enableStrategySwitching: false,
        auditRationale: process.env.SPOT_AUDIT === '1',
        // SPOT_OBS_SUMMARY=off → disable per-tool-result LLM fact-extraction
        // (extractObservationFacts, default-on local+mid). A/B lever for the
        // local-tier token-economy measurement.
        ...(process.env.SPOT_OBS_SUMMARY === 'off'
            ? { observationSummary: false as const }
            : process.env.SPOT_OBS_SUMMARY === 'on'
            ? { observationSummary: true as const }
            : {}),
        // SPOT_AUDIT=1 → opt into rationale auditing via config (validates the
        // reasoningOptions.auditRationale → KernelInput config path end-to-end).
        ...(process.env.SPOT_AUDIT === '1' ? { auditRationale: true } : {}),
    })
    // SPOT_NO_ALLOWED=1 → omit allowedTools so the full MCP toolset (30+ tools)
    // reaches the harness and the classifier + lazy-prune floor must select the
    // task tool with no allowlist safety net (the common real-world default).
    .withTools({
        ...(process.env.SPOT_NO_ALLOWED === '1' ? {} : { allowedTools: TOOLS }),
        // SPOT_NO_META=1 → drop the always-on meta tools (brief/pulse/recall/
        // find/discover-tools) so their FC schemas don't ship each turn. Lever
        // for the local-tier speed/token measurement (decode-bound vs prefill).
        ...(process.env.SPOT_NO_META === '1' ? { metaTools: false } : {}),
    })

// Memory ON by default; SPOT_NO_MEMORY=1 disables cortex+memory so ablations
// (e.g. rationale-gate) aren't contaminated by cross-run memory carryover.
if (process.env.SPOT_NO_MEMORY !== '1') {
    builder = builder.withCortex().withMemory()
}

// Window A/B knob (#5 MEASURED gate): SPOT_MAXTOKENS forces an explicit
// contextProfile.maxTokens (caller-provided → defeats model-window resolution,
// reproducing the pre-#5 32768 tier-placeholder window). Unset → the builder
// resolves the model's real window (e.g. haiku 200k).
if (process.env.SPOT_MAXTOKENS) {
    builder = builder.withContextProfile({
        maxTokens: Number(process.env.SPOT_MAXTOKENS),
    })
}

// Only wire the github MCP (docker) when a github/* tool is actually requested —
// the file-summary A/B uses local file tools and must not depend on docker.
if (TOOLS.some((t) => t.startsWith('github/'))) {
    builder = builder.withMCP({
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
}

const agent = await builder
    .withObservability({
        verbosity: 'debug',
        live: true,
        logModelIO: process.env.SPOT_LOG_IO === '1',
    })
    .build()

const result = await agent.run(TASK)
console.log(result.output)
console.log(
    'DEBRIEF_RATIONALE_JSON=' +
        JSON.stringify(result.debrief?.rationale ?? null)
)
// Structured metrics line for the baseline/grid runner (single greppable line).
console.log(
    'SPOT_RESULT_JSON=' +
        JSON.stringify({
            provider: PROVIDER,
            model: MODEL,
            // taskId == the trace runId (~/.reactive-agents/traces/<taskId>.jsonl).
            // The grid records this per cell so the comparator can group cohorts
            // by arm without fragile timestamp correlation.
            taskId: result.taskId,
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
        })
)
await agent.dispose()
