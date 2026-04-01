/**
 * Real-World Agent Quality & Efficiency Tests
 *
 * Tests agent behavior across multiple dimensions:
 * 1. Simple Q&A efficiency (iterations, tokens, cost)
 * 2. Reasoning quality (accuracy, tool use)
 * 3. Strategy effectiveness (ReAct, Plan-Execute, Adaptive)
 * 4. Reactive Intelligence impact (entropy sensing, early-stop)
 * 5. Memory and debrief quality
 * 6. Subagent orchestration
 * 7. Composition (agentFn, pipe, parallel)
 * 8. Tool use (staticAgentTools)
 * 9. Strategy effectiveness (ReAct, Plan-Execute, Adaptive)
 *
 * Run: bun run test.ts
 * Run with specific provider: PROVIDER=openai MODEL=gpt-4o VERBOSE=true bun run test.ts
 */

import type { ProviderName } from '@reactive-agents/runtime'
import { ReactiveAgents, agentFn, pipe, parallel } from 'reactive-agents'

// ─── Configuration ─────────────────────────────────────────────────────────

const PROVIDER = process.env.PROVIDER || ('ollama' as ProviderName)
const MODEL = process.env.MODEL || 'qwen3:14b'
const VERBOSE = process.env.VERBOSE === 'true'

// Provider-aware time budget multipliers.
// Cloud providers run at 1×; local inference gets extra headroom.
const TIME_MULTIPLIER: Record<string, number> = {
    anthropic: 1.0,
    openai: 1.0,
    gemini: 1.0,
    ollama: 3.0,
    litellm: 1.5,
}

// ─── Test Infrastructure ───────────────────────────────────────────────────

interface TestCase {
    name: string
    category:
        | 'efficiency'
        | 'accuracy'
        | 'reasoning'
        | 'tools'
        | 'intelligence'
        | 'robustness'
        | 'convergence'
        | 'strategy'
        | 'output'
        | 'subagent'
        | 'composition'
    input: string
    /** Max acceptable iterations for this task */
    maxExpectedIterations: number
    /** Max acceptable time in ms */
    maxExpectedMs: number
    /** Regex patterns that MUST appear in output for a pass */
    expectedPatterns?: RegExp[]
    /** Regex patterns that must NOT appear (hallucination check) */
    forbiddenPatterns?: RegExp[]
    /** Agent config overrides */
    config?: {
        reasoning?: boolean
        strategy?:
            | 'reactive'
            | 'plan-execute-reflect'
            | 'tree-of-thought'
            | 'adaptive'
        tools?: boolean
        memory?: boolean
        maxIterations?: number
        intelligence?: boolean
        subagents?: boolean
        staticAgentTools?: { name: string; instruction: string }[]
    }
}

interface TestResult {
    name: string
    category: string
    passed: boolean
    iterations: number
    tokens: number
    cost: number
    durationMs: number
    terminatedBy?: string
    debriefOutcome?: string
    debriefConfidence?: string
    outputSnippet: string
    issues: string[]
}

// ─── Test Cases ────────────────────────────────────────────────────────────

const tests: TestCase[] = [
    // ═══════════════════════════════════════════════════════════════════════════
    // Category 1: EFFICIENCY — Simple tasks should be fast and cheap
    // ═══════════════════════════════════════════════════════════════════════════
    {
        name: 'Simple math: 2+2',
        category: 'efficiency',
        input: 'What is 2+2?',
        maxExpectedIterations: 3,
        maxExpectedMs: 15_000,
        expectedPatterns: [/4/],
        config: { reasoning: true, maxIterations: 10 },
    },
    {
        name: 'Simple factual: capital of France',
        category: 'efficiency',
        input: 'What is the capital of France?',
        maxExpectedIterations: 3,
        maxExpectedMs: 15_000,
        expectedPatterns: [/paris/i],
        config: { reasoning: true, maxIterations: 10 },
    },
    {
        name: 'Simple factual: no reasoning overhead',
        category: 'efficiency',
        input: 'Name three programming languages.',
        maxExpectedIterations: 3,
        maxExpectedMs: 10_000,
        expectedPatterns: [
            /python|javascript|typescript|java|rust|go|c\+\+|ruby/i,
        ],
        config: { reasoning: false },
    },
    {
        name: 'Direct answer: one-word response',
        category: 'efficiency',
        input: 'Is water wet? Answer yes or no.',
        maxExpectedIterations: 3,
        maxExpectedMs: 10_000,
        expectedPatterns: [/yes|no/i],
        config: { reasoning: true, maxIterations: 5 },
    },
    {
        name: 'Short explanation',
        category: 'efficiency',
        input: 'Explain what an API is in 2 sentences.',
        maxExpectedIterations: 3,
        maxExpectedMs: 15_000,
        expectedPatterns: [/api|interface|application/i],
        config: { reasoning: true, maxIterations: 10 },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // Category 2: ACCURACY — Correct answers with no hallucination
    // ═══════════════════════════════════════════════════════════════════════════
    {
        name: 'Math reasoning: word problem',
        category: 'accuracy',
        input: 'A train travels at 60 mph for 2.5 hours. How far does it go?',
        maxExpectedIterations: 5,
        maxExpectedMs: 20_000,
        expectedPatterns: [/150/],
        config: { reasoning: true, maxIterations: 10 },
    },
    {
        name: 'Logic: syllogism',
        category: 'accuracy',
        input: 'All roses are flowers. All flowers need water. Do roses need water? Answer with yes/no and explain briefly.',
        maxExpectedIterations: 5,
        maxExpectedMs: 20_000,
        expectedPatterns: [/yes/i],
        config: { reasoning: true, maxIterations: 10 },
    },
    {
        name: 'Code generation: fizzbuzz',
        category: 'accuracy',
        input: "Write a JavaScript function called fizzbuzz that takes a number n and returns 'Fizz' if divisible by 3, 'Buzz' if by 5, 'FizzBuzz' if both, or the number as a string. Include the complete function code in your answer.",
        maxExpectedIterations: 5,
        maxExpectedMs: 25_000,
        expectedPatterns: [/function|const|=>/i, /fizz/i, /buzz/i, /3/, /5/],
        config: { reasoning: true, maxIterations: 10 },
    },
    {
        name: 'Factual accuracy: no hallucination',
        category: 'accuracy',
        input: 'What year was TypeScript first released by Microsoft?',
        maxExpectedIterations: 5,
        maxExpectedMs: 15_000,
        expectedPatterns: [/2012/],
        forbiddenPatterns: [/2010|2015|2018/],
        config: { reasoning: true, maxIterations: 10 },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // Category 3: REASONING — Multi-step tasks requiring strategy
    // ═══════════════════════════════════════════════════════════════════════════
    {
        name: 'ReAct: multi-step analysis',
        category: 'reasoning',
        input: 'Compare the pros and cons of using TypeScript vs JavaScript for a large-scale application. Consider at least: type safety, tooling, learning curve, and ecosystem. Provide a structured comparison.',
        maxExpectedIterations: 8,
        maxExpectedMs: 45_000,
        expectedPatterns: [/type.?safe|typing/i, /ecosystem/i],
        config: { reasoning: true, strategy: 'reactive', maxIterations: 10 },
    },
    {
        name: 'Plan-Execute: structured task',
        category: 'reasoning',
        input: 'Design a REST API for a simple todo application. Include: resource paths, HTTP methods, request/response formats, and error handling. Return the design as a structured specification.',
        maxExpectedIterations: 8,
        maxExpectedMs: 120_000,
        expectedPatterns: [
            /GET|POST|PUT|DELETE/i,
            /todo/i,
            /endpoint|path|route/i,
        ],
        config: {
            reasoning: true,
            strategy: 'plan-execute-reflect',
            maxIterations: 10,
        },
    },
    {
        name: 'Adaptive: let framework choose',
        category: 'reasoning',
        input: 'Explain the difference between concurrency and parallelism with a real-world analogy.',
        maxExpectedIterations: 8,
        maxExpectedMs: 30_000,
        expectedPatterns: [/concurren/i, /parallel/i],
        config: { reasoning: true, strategy: 'adaptive', maxIterations: 10 },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // Category 4: TOOLS — Tool calling effectiveness
    // ═══════════════════════════════════════════════════════════════════════════
    {
        name: 'Recall tool usage',
        category: 'tools',
        input: "Use the recall tool to store a note with key 'answer' containing 'The capital of France is Paris', then retrieve it and include the EXACT retrieved text word-for-word in your final answer.",
        maxExpectedIterations: 10,
        maxExpectedMs: 60_000,
        expectedPatterns: [/paris/i, /capital/i],
        config: { reasoning: true, tools: true, maxIterations: 12 },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // Category 5: REACTIVE INTELLIGENCE — Entropy sensing impact
    // ═══════════════════════════════════════════════════════════════════════════
    {
        name: 'Intelligence: simple task early-stop',
        category: 'intelligence',
        input: 'What color is the sky on a clear day?',
        maxExpectedIterations: 3,
        maxExpectedMs: 15_000,
        expectedPatterns: [/blue/i],
        config: { reasoning: true, intelligence: true, maxIterations: 10 },
    },
    {
        name: 'Intelligence: moderate task',
        category: 'intelligence',
        input: 'Explain how a hash table works, including how collisions are handled.',
        maxExpectedIterations: 8,
        maxExpectedMs: 30_000,
        expectedPatterns: [/hash/i, /collision|conflict/i],
        config: { reasoning: true, intelligence: true, maxIterations: 10 },
    },
    {
        name: 'Intelligence: with memory + debrief',
        category: 'intelligence',
        input: 'Describe the observer design pattern. Include: intent, structure, when to use it, and a brief code example.',
        maxExpectedIterations: 8,
        maxExpectedMs: 45_000,
        expectedPatterns: [/observer/i, /subscribe|notify|publish|event/i],
        config: {
            reasoning: true,
            intelligence: true,
            memory: true,
            maxIterations: 10,
        },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // Category 6: ROBUSTNESS — Edge cases, error recovery, output quality
    // ═══════════════════════════════════════════════════════════════════════════
    {
        name: 'Empty-ish input handling',
        category: 'robustness',
        input: 'Hi',
        maxExpectedIterations: 3,
        maxExpectedMs: 10_000,
        expectedPatterns: [/./], // Any non-empty response
        config: { reasoning: true, maxIterations: 5 },
    },
    {
        name: 'Instruction following: format constraint',
        category: 'robustness',
        input: 'List exactly 3 benefits of exercise. Number them 1, 2, 3.',
        maxExpectedIterations: 3,
        maxExpectedMs: 15_000,
        expectedPatterns: [/1\.|1\)/i, /2\.|2\)/i, /3\.|3\)/i],
        forbiddenPatterns: [/4\.|4\)/], // Should not list more than 3
        config: { reasoning: true, maxIterations: 10 },
    },
    {
        name: 'Multi-part question',
        category: 'robustness',
        input: 'What is the largest ocean? What is the smallest continent? Answer both.',
        maxExpectedIterations: 4,
        maxExpectedMs: 15_000,
        expectedPatterns: [/pacific/i, /australia|oceania/i],
        config: { reasoning: true, maxIterations: 10 },
    },
    {
        name: 'Code with explanation',
        category: 'robustness',
        input: 'Write a function that reverses a string. Include the complete code and a one-line explanation of how it works.',
        maxExpectedIterations: 5,
        maxExpectedMs: 20_000,
        expectedPatterns: [
            /function|def |const |=>|lambda/i,
            /reverse|split|join|\[::\-1\]/i,
        ],
        config: { reasoning: true, maxIterations: 10 },
    },
    {
        name: 'Ambiguous request: graceful handling',
        category: 'robustness',
        input: 'Tell me about Mercury.',
        maxExpectedIterations: 4,
        maxExpectedMs: 15_000,
        expectedPatterns: [/mercury/i], // Should mention Mercury (planet or element)
        config: { reasoning: true, maxIterations: 10 },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // Category 7: CONVERGENCE — Tasks that previously caused loops or explosions
    // ═══════════════════════════════════════════════════════════════════════════
    {
        name: 'Converge: simple math should not loop',
        category: 'convergence',
        input: 'What is 15 * 7?',
        maxExpectedIterations: 3,
        maxExpectedMs: 10_000,
        expectedPatterns: [/105/],
        config: { reasoning: true, maxIterations: 10 },
    },
    {
        name: 'Converge: list task should terminate',
        category: 'convergence',
        input: 'List the 4 seasons of the year.',
        maxExpectedIterations: 3,
        maxExpectedMs: 10_000,
        expectedPatterns: [/spring|summer|fall|autumn|winter/i],
        config: { reasoning: true, maxIterations: 10 },
    },
    {
        name: 'Converge: opinion question',
        category: 'convergence',
        input: 'What is a good first programming language to learn and why? Keep it brief.',
        maxExpectedIterations: 4,
        maxExpectedMs: 15_000,
        expectedPatterns: [/python|javascript|typescript|scratch/i],
        config: { reasoning: true, maxIterations: 10 },
    },
    {
        name: 'Converge: no-tool task with tools enabled',
        category: 'convergence',
        input: 'What is the speed of light in meters per second? Answer directly from your knowledge.',
        maxExpectedIterations: 6,
        maxExpectedMs: 30_000,
        expectedPatterns: [/3.*10.*8|299.*792|300.*000/],
        config: { reasoning: true, tools: true, maxIterations: 10 },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // Category 8: STRATEGY QUALITY — Each strategy produces good output
    // ═══════════════════════════════════════════════════════════════════════════
    {
        name: 'ReAct: concise factual answer',
        category: 'strategy',
        input: 'What are the three states of matter? Give a one-sentence answer.',
        maxExpectedIterations: 3,
        maxExpectedMs: 15_000,
        expectedPatterns: [/solid/i, /liquid/i, /gas/i],
        config: { reasoning: true, strategy: 'reactive', maxIterations: 10 },
    },
    {
        name: 'Plan-Execute: multi-step synthesis',
        category: 'strategy',
        input: 'Create a simple database schema for a blog with users, posts, and comments. Show the tables with their columns and relationships.',
        maxExpectedIterations: 8,
        maxExpectedMs: 60_000,
        expectedPatterns: [/user/i, /post/i, /comment/i, /id|key/i],
        config: {
            reasoning: true,
            strategy: 'plan-execute-reflect',
            maxIterations: 10,
        },
    },
    {
        name: 'Adaptive: picks efficient path',
        category: 'strategy',
        input: 'Convert 72 degrees Fahrenheit to Celsius. Show the formula and result.',
        maxExpectedIterations: 4,
        maxExpectedMs: 15_000,
        expectedPatterns: [/22/], // 22.22°C
        config: { reasoning: true, strategy: 'adaptive', maxIterations: 10 },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // Category 9: OUTPUT QUALITY — Final answer completeness and formatting
    // ═══════════════════════════════════════════════════════════════════════════
    {
        name: 'Output: code must be complete (not truncated)',
        category: 'output',
        input: 'Write a complete TypeScript function called isPrime that checks if a number is prime. Include the full implementation.',
        maxExpectedIterations: 5,
        maxExpectedMs: 20_000,
        expectedPatterns: [/function|const/i, /isPrime/i, /return/i],
        forbiddenPatterns: [/see above|shown above|as above|as shown/i],
        config: { reasoning: true, maxIterations: 10 },
    },
    {
        name: 'Output: structured data must be complete',
        category: 'output',
        input: "Create a JSON object representing a person with name 'Alice', age 30, and hobbies ['reading', 'hiking']. Return the complete JSON.",
        maxExpectedIterations: 4,
        maxExpectedMs: 15_000,
        expectedPatterns: [/alice/i, /30/, /reading/i, /hiking/i],
        forbiddenPatterns: [/see above|shown above/i],
        config: { reasoning: true, maxIterations: 10 },
    },
    {
        name: 'Output: explanation with examples',
        category: 'output',
        input: 'Explain what a closure is in JavaScript with a short code example.',
        maxExpectedIterations: 5,
        maxExpectedMs: 20_000,
        expectedPatterns: [/closure/i, /function/i],
        forbiddenPatterns: [/see above|shown above/i],
        config: { reasoning: true, maxIterations: 10 },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // Category 10: SUBAGENT — Delegation and sub-agent orchestration
    // ═══════════════════════════════════════════════════════════════════════════
    {
        name: 'Static sub-agent: delegation',
        category: 'subagent',
        input: 'Use your research assistant to explain what a linked list is. Provide their answer.',
        maxExpectedIterations: 12,
        maxExpectedMs: 60_000,
        expectedPatterns: [/link|node|pointer|next/i],
        config: {
            reasoning: true,
            tools: true,
            maxIterations: 15,
            staticAgentTools: [
                {
                    name: 'research-assistant',
                    instruction:
                        'You are a research assistant. Answer the question clearly and concisely.',
                },
            ],
        },
    },
    {
        name: 'Dynamic sub-agent: spawn and use',
        category: 'subagent',
        input: 'Spawn a sub-agent to calculate the factorial of 5 and report back the result.',
        maxExpectedIterations: 12,
        maxExpectedMs: 60_000,
        expectedPatterns: [/120/],
        config: {
            reasoning: true,
            tools: true,
            subagents: true,
            maxIterations: 15,
        },
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // Category 11: COMPOSITION — agentFn, pipe, parallel
    // ═══════════════════════════════════════════════════════════════════════════
]

// ─── Test Runner ───────────────────────────────────────────────────────────

async function runTest(test: TestCase): Promise<TestResult> {
    const issues: string[] = []
    const cfg = test.config ?? {}

    // Build agent
    let builder = ReactiveAgents.create()
        .withName(`test-${test.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`)
        .withProvider(PROVIDER as ProviderName)

    if (MODEL) builder = builder.withModel(MODEL)

    if (cfg.maxIterations)
        builder = builder.withMaxIterations(cfg.maxIterations)

    if (cfg.reasoning) {
        const reasoningOpts: { defaultStrategy?: string } = {}
        if (cfg.strategy) reasoningOpts.defaultStrategy = cfg.strategy
        builder = builder.withReasoning(
            reasoningOpts as Parameters<typeof builder.withReasoning>[0]
        )
    }

    if (cfg.tools) builder = builder.withTools()
    if (cfg.memory) builder = builder.withMemory()
    if (cfg.intelligence) builder = builder.withReactiveIntelligence()
    if (cfg.subagents)
        builder = builder.withDynamicSubAgents({ maxIterations: 8 })
    if (cfg.staticAgentTools) {
        for (const sat of cfg.staticAgentTools) {
            builder = builder.withAgentTool(sat.name, {
                name: sat.name,
                systemPrompt: sat.instruction,
                provider: PROVIDER,
                model: MODEL,
            })
        }
    }

    // Only enable observability in verbose mode — the smoke test has its own reporting
    if (VERBOSE) {
        builder = builder.withObservability({ verbosity: 'debug', live: true })
    }

    // Suppress build-validation log (provider/model/key info) during smoke tests
    const _log = console.log
    if (!VERBOSE) console.log = () => {}
    const agent = await builder.build()
    console.log = _log

    const start = performance.now()
    let result
    try {
        result = await agent.run(test.input)
    } catch (e) {
        await agent.dispose()
        return {
            name: test.name,
            category: test.category,
            passed: false,
            iterations: 0,
            tokens: 0,
            cost: 0,
            durationMs: performance.now() - start,
            outputSnippet: `ERROR: ${
                e instanceof Error ? e.message : String(e)
            }`,
            issues: [
                `Execution crashed: ${
                    e instanceof Error ? e.message : String(e)
                }`,
            ],
        }
    }
    const durationMs = performance.now() - start
    await agent.dispose()

    // ─── Evaluate Results ──────────────────────────────────────────────────

    // Check iteration count
    if (result.metadata.stepsCount > test.maxExpectedIterations) {
        issues.push(
            `ITERATION EXPLOSION: ${result.metadata.stepsCount} iterations (max expected: ${test.maxExpectedIterations})`
        )
    }

    // Check duration (adjusted for provider speed)
    const timeMultiplier = TIME_MULTIPLIER[PROVIDER] ?? 1.0
    const adjustedMaxMs = test.maxExpectedMs * timeMultiplier
    if (durationMs > adjustedMaxMs) {
        issues.push(
            `SLOW: ${(durationMs / 1000).toFixed(1)}s (budget: ${(
                test.maxExpectedMs / 1000
            ).toFixed(1)}s × ${timeMultiplier} = ${(
                adjustedMaxMs / 1000
            ).toFixed(1)}s)`
        )
    }

    // Check expected patterns
    if (test.expectedPatterns) {
        for (const pattern of test.expectedPatterns) {
            if (!pattern.test(result.output)) {
                issues.push(
                    `MISSING EXPECTED: /${pattern.source}/ not found in output`
                )
            }
        }
    }

    // Check forbidden patterns (hallucination)
    if (test.forbiddenPatterns) {
        for (const pattern of test.forbiddenPatterns) {
            if (pattern.test(result.output)) {
                issues.push(
                    `HALLUCINATION: /${pattern.source}/ found in output (forbidden)`
                )
            }
        }
    }

    // Check termination quality
    if (result.terminatedBy === 'max_iterations') {
        issues.push(`HIT MAX ITERATIONS — agent didn't conclude naturally`)
    }

    // Check debrief quality (if memory enabled)
    if (cfg.memory && result.debrief) {
        if (result.debrief.outcome === 'failed') {
            issues.push(`DEBRIEF says FAILED: ${result.debrief.summary}`)
        }
        if (result.debrief.confidence === 'low' && issues.length === 0) {
            issues.push(
                `LOW CONFIDENCE in debrief despite seemingly correct output`
            )
        }
    }

    // Check success flag
    if (!result.success) {
        issues.push(`result.success is FALSE`)
    }

    return {
        name: test.name,
        category: test.category,
        passed: issues.length === 0,
        iterations: result.metadata.stepsCount,
        tokens: result.metadata.tokensUsed,
        cost: result.metadata.cost,
        durationMs,
        terminatedBy: result.terminatedBy,
        debriefOutcome: result.debrief?.outcome,
        debriefConfidence: result.debrief?.confidence,
        outputSnippet: result.output.slice(0, 200).replace(/\n/g, ' '),
        issues,
    }
}

// ─── Reporter ──────────────────────────────────────────────────────────────

function printReport(results: TestResult[]) {
    console.log('\n')
    console.log(
        '╔══════════════════════════════════════════════════════════════════════════════════╗'
    )
    console.log(
        '║                    REACTIVE AGENTS — QUALITY & EFFICIENCY REPORT                ║'
    )
    console.log(
        '╠══════════════════════════════════════════════════════════════════════════════════╣'
    )
    console.log(`║  Provider : ${PROVIDER.padEnd(66)}║`)
    console.log(`║  Model    : ${(MODEL ?? 'default').padEnd(66)}║`)
    console.log(`║  Tests    : ${String(results.length).padEnd(66)}║`)
    console.log(`║  Date     : ${new Date().toISOString().padEnd(66)}║`)
    console.log(
        '╚══════════════════════════════════════════════════════════════════════════════════╝'
    )

    // Group by category
    const categories = [...new Set(results.map((r) => r.category))]

    for (const cat of categories) {
        const catResults = results.filter((r) => r.category === cat)
        const catPassed = catResults.filter((r) => r.passed).length

        console.log(
            `\n┌── ${cat.toUpperCase()} (${catPassed}/${
                catResults.length
            } passed) ${'─'.repeat(60 - cat.length)}┐`
        )

        for (const r of catResults) {
            const icon = r.passed ? '✅' : '❌'
            const iters = `${r.iterations} iters`
            const tokens = `${r.tokens.toLocaleString()} tok`
            const time =
                r.durationMs >= 1000
                    ? `${(r.durationMs / 1000).toFixed(1)}s`
                    : `${r.durationMs.toFixed(0)}ms`
            const cost = `$${r.cost.toFixed(4)}`
            const term = r.terminatedBy ? ` [${r.terminatedBy}]` : ''

            console.log(
                `│ ${icon} ${r.name.padEnd(42)} ${iters.padStart(
                    8
                )} ${tokens.padStart(12)} ${time.padStart(8)} ${cost.padStart(
                    8
                )}${term}`
            )

            if (r.issues.length > 0) {
                for (const issue of r.issues) {
                    console.log(`│    ⚠  ${issue}`)
                }
            }
        }
        console.log(`└${'─'.repeat(79)}┘`)
    }

    // Summary
    const totalPassed = results.filter((r) => r.passed).length
    const totalIterations = results.reduce((sum, r) => sum + r.iterations, 0)
    const totalTokens = results.reduce((sum, r) => sum + r.tokens, 0)
    const totalCost = results.reduce((sum, r) => sum + r.cost, 0)
    const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0)

    const iterationExplosions = results.filter((r) =>
        r.issues.some((i) => i.includes('ITERATION EXPLOSION'))
    )
    const hallucinations = results.filter((r) =>
        r.issues.some((i) => i.includes('HALLUCINATION'))
    )
    const crashes = results.filter((r) =>
        r.issues.some((i) => i.includes('crashed'))
    )
    const maxIterationHits = results.filter(
        (r) => r.terminatedBy === 'max_iterations'
    )

    console.log(
        '\n╔══════════════════════════════════════════════════════════════════════════════════╗'
    )
    console.log(
        '║                                    SUMMARY                                     ║'
    )
    console.log(
        '╠══════════════════════════════════════════════════════════════════════════════════╣'
    )
    console.log(
        `║  Pass Rate         : ${(
            totalPassed +
            '/' +
            results.length +
            ' (' +
            Math.round((totalPassed / results.length) * 100) +
            '%)'
        ).padEnd(56)}║`
    )
    console.log(`║  Total Iterations  : ${String(totalIterations).padEnd(56)}║`)
    console.log(
        `║  Total Tokens      : ${totalTokens.toLocaleString().padEnd(56)}║`
    )
    console.log(`║  Total Cost        : $${totalCost.toFixed(4).padEnd(55)}║`)
    console.log(
        `║  Total Duration    : ${(totalDuration / 1000)
            .toFixed(1)
            .padEnd(55)}s║`
    )
    console.log(
        `║  Avg Iters/Task    : ${(totalIterations / results.length)
            .toFixed(1)
            .padEnd(56)}║`
    )
    console.log(
        `║  Avg Tokens/Task   : ${Math.round(totalTokens / results.length)
            .toLocaleString()
            .padEnd(56)}║`
    )
    console.log(
        `║  Avg Cost/Task     : $${(totalCost / results.length)
            .toFixed(4)
            .padEnd(55)}║`
    )
    console.log(
        '╠══════════════════════════════════════════════════════════════════════════════════╣'
    )
    console.log(
        '║  HEALTH SIGNALS                                                                ║'
    )
    console.log(
        '╠══════════════════════════════════════════════════════════════════════════════════╣'
    )
    console.log(
        `║  Iteration Explosions : ${String(iterationExplosions.length).padEnd(
            53
        )}║`
    )
    console.log(
        `║  Hallucinations       : ${String(hallucinations.length).padEnd(53)}║`
    )
    console.log(
        `║  Crashes              : ${String(crashes.length).padEnd(53)}║`
    )
    console.log(
        `║  Max Iteration Hits   : ${String(maxIterationHits.length).padEnd(
            53
        )}║`
    )
    console.log(
        '╚══════════════════════════════════════════════════════════════════════════════════╝'
    )

    // Efficiency grades per category
    console.log(
        '\n┌── EFFICIENCY GRADES ──────────────────────────────────────────────────────────┐'
    )
    for (const cat of categories) {
        const catResults = results.filter((r) => r.category === cat)
        const avgIters =
            catResults.reduce((s, r) => s + r.iterations, 0) / catResults.length
        const avgTokens =
            catResults.reduce((s, r) => s + r.tokens, 0) / catResults.length
        const passRate =
            catResults.filter((r) => r.passed).length / catResults.length

        let grade: string
        if (passRate === 1 && avgIters <= 3) grade = 'A+'
        else if (passRate >= 0.8 && avgIters <= 5) grade = 'A'
        else if (passRate >= 0.7 && avgIters <= 7) grade = 'B'
        else if (passRate >= 0.5) grade = 'C'
        else grade = 'D'

        console.log(
            `│  ${cat.padEnd(15)} : ${grade.padEnd(4)} (${Math.round(
                passRate * 100
            )}% pass, avg ${avgIters.toFixed(1)} iters, avg ${Math.round(
                avgTokens
            )} tokens)`
        )
    }
    console.log(
        '└───────────────────────────────────────────────────────────────────────────────┘'
    )

    // Actionable recommendations
    console.log(
        '\n┌── RECOMMENDATIONS ────────────────────────────────────────────────────────────┐'
    )

    if (iterationExplosions.length > 0) {
        console.log('│  🔴 ITERATION EXPLOSION detected on:')
        for (const r of iterationExplosions) {
            console.log(`│     - "${r.name}" (${r.iterations} iterations)`)
        }
        console.log(
            '│     → Check ReAct loop exit conditions and final-answer tool recognition'
        )
    }

    if (hallucinations.length > 0) {
        console.log('│  🔴 HALLUCINATION detected on:')
        for (const r of hallucinations) {
            console.log(`│     - "${r.name}"`)
        }
        console.log(
            '│     → Consider enabling verification (.withVerification())'
        )
    }

    if (maxIterationHits.length > 0) {
        console.log('│  🟡 MAX_ITERATIONS hit on:')
        for (const r of maxIterationHits) {
            console.log(`│     - "${r.name}" (${r.iterations} iterations)`)
        }
        console.log(
            "│     → Agent couldn't converge — check prompt clarity or increase max"
        )
    }

    if (crashes.length > 0) {
        console.log('│  🔴 CRASHES detected:')
        for (const r of crashes) {
            console.log(`│     - "${r.name}": ${r.outputSnippet.slice(0, 80)}`)
        }
    }

    const slowTests = results.filter((r) =>
        r.issues.some((i) => i.includes('SLOW'))
    )
    if (slowTests.length > 0) {
        console.log('│  🟡 SLOW tests:')
        for (const r of slowTests) {
            console.log(
                `│     - "${r.name}" (${(r.durationMs / 1000).toFixed(1)}s)`
            )
        }
    }

    if (
        iterationExplosions.length === 0 &&
        hallucinations.length === 0 &&
        crashes.length === 0 &&
        maxIterationHits.length === 0
    ) {
        console.log('│  ✅ All health signals clean — ready for benchmarks!')
    }

    console.log(
        '└───────────────────────────────────────────────────────────────────────────────┘\n'
    )
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
    console.log(`\n🧪 Reactive Agents Quality & Efficiency Test Suite`)
    console.log(`   Provider: ${PROVIDER} | Model: ${MODEL ?? 'default'}`)
    console.log(`   Running ${tests.length} tests...\n`)

    const results: TestResult[] = []

    for (const test of tests) {
        process.stdout.write(
            `  ⊙ [${test.category.padEnd(12)}] ${test.name.padEnd(45)} `
        )
        const result = await runTest(test)
        results.push(result)

        const icon = result.passed ? '✓' : '✗'
        const time =
            result.durationMs >= 1000
                ? `${(result.durationMs / 1000).toFixed(1)}s`
                : `${result.durationMs.toFixed(0)}ms`
        console.log(
            `${icon} ${time} (${result.iterations} iters, ${result.tokens} tok)`
        )

        if (!result.passed && result.issues.length > 0) {
            for (const issue of result.issues) {
                console.log(`    ⚠  ${issue}`)
            }
        }
    }

    // ─── Composition Smoke Tests (separate from main loop) ───────────────────
    console.log(
        '\n┌── COMPOSITION TESTS ──────────────────────────────────────────────────────┐'
    )

    // Test: pipe() — sequential pipeline
    try {
        process.stdout.write(
            '│  ⊙ pipe: sequential pipeline                      '
        )
        const start = performance.now()
        const pipeline = pipe(
            agentFn(
                {
                    name: 'summarizer',
                    provider: PROVIDER as ProviderName,
                    model: MODEL,
                },
                (b) => b.withReasoning()
            )
        )
        const pipeResult = await pipeline(
            'Summarize in one sentence: TypeScript adds static types to JavaScript.'
        )
        await pipeline.dispose()
        const elapsed = performance.now() - start
        const output = pipeResult.output ?? ''
        const passed = /type|static|javascript/i.test(output)
        results.push({
            name: 'pipe: sequential pipeline',
            category: 'composition',
            passed,
            iterations: pipeResult.metadata?.stepsCount ?? 0,
            tokens: pipeResult.metadata?.tokensUsed ?? 0,
            cost: pipeResult.metadata?.cost ?? 0,
            durationMs: elapsed,
            outputSnippet: output.slice(0, 200),
            issues: passed ? [] : ['Output missing expected content'],
        })
        console.log(`${passed ? '✓' : '✗'} ${(elapsed / 1000).toFixed(1)}s`)
    } catch (e: any) {
        console.log(`✗ ERROR: ${e.message.slice(0, 60)}`)
        results.push({
            name: 'pipe: sequential pipeline',
            category: 'composition',
            passed: false,
            iterations: 0,
            tokens: 0,
            cost: 0,
            durationMs: 0,
            outputSnippet: `ERROR: ${e.message}`,
            issues: [`Composition crash: ${e.message}`],
        })
    }

    // Test: parallel() — concurrent execution
    try {
        process.stdout.write(
            '│  ⊙ parallel: concurrent agents                    '
        )
        const start = performance.now()
        const concurrentAgents = parallel(
            agentFn(
                {
                    name: 'agent-a',
                    provider: PROVIDER as ProviderName,
                    model: MODEL,
                },
                (b) => b.withReasoning()
            ),
            agentFn(
                {
                    name: 'agent-b',
                    provider: PROVIDER as ProviderName,
                    model: MODEL,
                },
                (b) => b.withReasoning()
            )
        )
        const parallelResult = await concurrentAgents(
            'What is 2+2? Answer with just the number.'
        )
        await concurrentAgents.dispose()
        const elapsed = performance.now() - start
        const mergedOutput = parallelResult.output ?? ''
        const passed = /4/.test(mergedOutput)
        results.push({
            name: 'parallel: concurrent agents',
            category: 'composition',
            passed,
            iterations: parallelResult.metadata?.stepsCount ?? 0,
            tokens: parallelResult.metadata?.tokensUsed ?? 0,
            cost: parallelResult.metadata?.cost ?? 0,
            durationMs: elapsed,
            outputSnippet: mergedOutput.slice(0, 200),
            issues: passed ? [] : [`Output: "${mergedOutput.slice(0, 100)}"`],
        })
        console.log(`${passed ? '✓' : '✗'} ${(elapsed / 1000).toFixed(1)}s`)
    } catch (e: any) {
        console.log(`✗ ERROR: ${e.message.slice(0, 60)}`)
        results.push({
            name: 'parallel: concurrent agents',
            category: 'composition',
            passed: false,
            iterations: 0,
            tokens: 0,
            cost: 0,
            durationMs: 0,
            outputSnippet: `ERROR: ${e.message}`,
            issues: [`Composition crash: ${e.message}`],
        })
    }

    console.log(
        '└───────────────────────────────────────────────────────────────────────────┘'
    )

    printReport(results)

    // Save results as JSON for further analysis
    const reportPath = './quality-test-results.json'
    const { writeFileSync } = await import('node:fs')
    writeFileSync(
        reportPath,
        JSON.stringify(
            {
                timestamp: new Date().toISOString(),
                provider: PROVIDER,
                model: MODEL ?? 'default',
                results,
                summary: {
                    totalTests: results.length,
                    passed: results.filter((r) => r.passed).length,
                    failed: results.filter((r) => !r.passed).length,
                    totalIterations: results.reduce(
                        (s, r) => s + r.iterations,
                        0
                    ),
                    totalTokens: results.reduce((s, r) => s + r.tokens, 0),
                    totalCost: results.reduce((s, r) => s + r.cost, 0),
                    totalDurationMs: results.reduce(
                        (s, r) => s + r.durationMs,
                        0
                    ),
                },
            },
            null,
            2
        )
    )
    console.log(`📄 Full results saved to ${reportPath}`)

    // Exit with failure code if any tests failed
    const failCount = results.filter((r) => !r.passed).length
    if (failCount > 0) {
        process.exit(1)
    }
}

main().catch((err) => {
    console.error('Fatal error:', err)
    process.exit(2)
})
