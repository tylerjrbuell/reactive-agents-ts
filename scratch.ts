/**
 * Strategy-switch dispatcher test.
 *
 * Forces the strategy switch by giving qwen3:14b a tool that always returns
 * "service unavailable". The model loops trying the same tool repeatedly,
 * producing flat behavioral entropy and high loop score. Once 3 consecutive
 * flat iterations accumulate with behavioral > 0.45, the strategy-switch
 * evaluator fires through the dispatcher and kernel-runner hands off to
 * plan-execute-reflect.
 *
 * Run: bun scratch.ts
 */

import { Effect } from 'effect'
import { ReactiveAgents } from '@reactive-agents/runtime'

const agent = await ReactiveAgents.create()
    .withProvider('ollama')
    .withModel('cogito:latest')
    .withTools({
        tools: [
            {
                definition: {
                    name: 'lookup-salary-data',
                    description:
                        'Look up average developer salaries by programming language from our database. ' +
                        'Required for salary data — do not use web-search as a substitute.',
                    parameters: [
                        {
                            name: 'language',
                            type: 'string' as const,
                            required: true,
                            description:
                                "The programming language to look up (e.g. 'Python', 'JavaScript')",
                        },
                        {
                            name: 'region',
                            type: 'string' as const,
                            required: true,
                            description:
                                "Region for the salary data (e.g. 'US', 'EU', 'global')",
                        },
                    ],
                    riskLevel: 'low',
                    timeoutMs: 10_000,
                    requiresApproval: false,
                    source: 'function',
                },
                handler: (_input: Record<string, unknown>) =>
                    Effect.succeed({
                        error: 'Service temporarily unavailable — database is under maintenance. Please retry.',
                        status: 503,
                        retryAfter: 60,
                    }) as Effect.Effect<unknown, never>,
            },
        ],
    })
    .withReactiveIntelligence({
        onEntropyScored: (event: any, iteration: any) => {
            console.log(
                `[RI] iter=${iteration ?? '?'} ` +
                    `entropy=${event.composite?.toFixed(3)} ` +
                    `shape=${event.trajectory?.shape ?? '?'} ` +
                    `behavioral=${event.sources?.behavioral?.toFixed(3) ?? '?'}`
            )
        },
        onControllerDecision: (event: any, context: any) => {
            console.log(
                `[RI] ⚡ DECISION iter=${context.iteration} ` +
                    `type=${event.decision} ` +
                    `entropy=${context.entropyBefore?.toFixed(3)}`
            )
            if (event.reason) console.log(`[RI]    reason: ${event.reason}`)
            return 'accept'
        },
        // type="intervention", before={decisionType}, after={patchKind}
        onMidRunAdjustment: (_type: string, before: any, after: any) => {
            console.log(
                `[RI] 🔀 INTERVENTION decisionType=${
                    before?.decisionType ?? '?'
                } patchKind=${after?.patchKind ?? '?'}`
            )
        },
    })
    .withReasoning({
        defaultStrategy: 'reactive',
        maxIterations: 20,
        enableStrategySwitching: true,
        maxStrategySwitches: 1,
        fallbackStrategy: 'plan-execute-reflect',
    })
    .build()

console.log('━━━ Strategy-switch dispatcher test ━━━')
console.log('Model: qwen3:14b | lookup-salary-data always fails → forces loop')
console.log(
    'Watching for [RI] entropy → controller decision → dispatcher switch\n'
)

const result = await agent.run(
    'I need the Python developer salary for the US region from our database. ' +
        "Use the lookup-salary-data tool with language='Python' and region='US'. " +
        'The database is experiencing intermittent issues — keep retrying the exact ' +
        'same call until you get a successful result. Do not give up after one failure. ' +
        'Try at least 10 times before reporting that the data is unavailable.'
)

console.log('\n━━━ Result ━━━')
console.log('Success:   ', result.success)
console.log('Tokens:    ', result.metadata?.tokensUsed ?? '?')
console.log('Strategy:  ', result.metadata?.strategyUsed ?? 'unknown')
console.log('\nOutput (first 600 chars):')
console.log(result.output?.slice(0, 600) ?? '(none)')
