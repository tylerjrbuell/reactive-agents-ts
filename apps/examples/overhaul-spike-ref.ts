/**
 * Overhaul spike — the reference-protocol discriminating test (advisor-mandated, #2).
 *
 * THE QUESTION: will a weak local model orchestrate over data it does NOT hold
 * inline — by emitting a clean structured reference to a prior result — instead of
 * transcribing it or pasting a [STORED:] marker?
 *
 * If YES → the system-owned-context architecture is viable (model references,
 * system materializes). If NO → the premise is wrong, rethink before building.
 *
 * Pure provider-level test (ollama client direct). No kernel. We hand the model:
 *   - a SYSTEM SUMMARY of the list_commits result (count + schema), NO full data,
 *     NO marker to copy, NO recall hint.
 *   - two tools: write_result_to_file(result_ref, path) [the reference path] and
 *     file_write(path, content) [the inline path].
 * We read which tool it calls and whether result_ref is the correct id.
 *
 * Usage: SPOT_MODEL=cogito:14b bun apps/examples/overhaul-spike-ref.ts
 */
import { Ollama } from 'ollama'

const MODEL = process.env.SPOT_MODEL ?? 'cogito:14b'
const HOST = process.env.OLLAMA_ENDPOINT ?? 'http://localhost:11434'
const client = new Ollama({ host: HOST })

const RESULT_ID = 'commits_1'

const system = `You are a GitHub agent. A tool result may be too large to repeat. When a tool result exists in the system store, you DO NOT retype its data. To write a stored result to a file, call write_result_to_file with the result's reference id. Never invent or transcribe the data yourself.`

const messages = [
    { role: 'system', content: system },
    {
        role: 'user',
        content:
            'Fetch the last 20 commits to tylerjrbuell/reactive-agents-ts then write them to ./out.md as a bullet list of commit messages.',
    },
    {
        role: 'assistant',
        content: 'Fetching the commits.',
        tool_calls: [
            {
                function: {
                    name: 'list_commits',
                    arguments: { owner: 'tylerjrbuell', repo: 'reactive-agents-ts', perPage: 20 },
                },
            },
        ],
    },
    {
        // SYSTEM SUMMARY — no full data, no marker, no recall hint. The data lives
        // in the system store under result id `commits_1`.
        role: 'tool',
        content: `[stored as result_ref="${RESULT_ID}"] list_commits succeeded: Array(20) of {sha, message, author, date}. The full data is held in the system store; reference it by id "${RESULT_ID}".`,
    },
]

const tools = [
    {
        type: 'function',
        function: {
            name: 'write_result_to_file',
            description:
                'Write a stored tool result to a file by reference. The system materializes the full data — you only name the result_ref and path.',
            parameters: {
                type: 'object',
                properties: {
                    result_ref: { type: 'string', description: 'The result reference id, e.g. "commits_1".' },
                    path: { type: 'string', description: 'Destination file path.' },
                    format: { type: 'string', description: 'Optional: "bullets" | "json" | "table".' },
                },
                required: ['result_ref', 'path'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'file_write',
            description: 'Write literal content you provide to a file.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string' },
                    content: { type: 'string', description: 'The literal bytes to write.' },
                },
                required: ['path', 'content'],
            },
        },
    },
]

const res = await client.chat({
    model: MODEL,
    messages: messages as never,
    tools: tools as never,
    stream: false,
    options: { num_ctx: 15360, temperature: 0 },
})

const calls = res.message.tool_calls ?? []
console.log(`\n=== ${MODEL} ===`)
console.log(`content: ${JSON.stringify(res.message.content ?? '')}`)
console.log(`tool_calls: ${calls.length}`)
for (const c of calls) {
    console.log(`  -> ${c.function.name}(${JSON.stringify(c.function.arguments)})`)
}

// Verdict
let verdict = 'AMBIGUOUS'
const fn = calls[0]?.function
if (fn?.name === 'write_result_to_file') {
    const ref = (fn.arguments as Record<string, unknown>)?.result_ref
    verdict = ref === RESULT_ID ? 'PASS (clean reference)' : `PARTIAL (ref="${ref}" wrong id)`
} else if (fn?.name === 'file_write') {
    const content = String((fn.arguments as Record<string, unknown>)?.content ?? '')
    verdict = `FAIL (inline path; content_len=${content.length}, has_marker=${/stored|result_ref|\[/.test(content)})`
} else if (calls.length === 0) {
    verdict = 'FAIL (no tool call)'
}
console.log(`VERDICT: ${verdict}`)
