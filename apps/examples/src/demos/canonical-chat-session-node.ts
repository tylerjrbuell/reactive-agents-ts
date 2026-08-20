/**
 * Canonical multi-turn chat session example (Node-portable).
 *
 * Same `agent.session()` / `session.chat()` pattern as
 * `canonical-chat-session.ts`, but driven by an interactive
 * `node:readline/promises` REPL loop instead of scripted turns — the
 * portable pattern for consumers not on the Bun runtime.
 *
 * Build/run:
 *   npx tsc -p apps/examples/tsconfig.node.json
 *   ANTHROPIC_API_KEY=sk-ant-... node apps/examples/dist-node/demos/canonical-chat-session-node.js
 */
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { ReactiveAgents } from 'reactive-agents'

async function main() {
    type ProviderName = 'anthropic' | 'openai' | 'ollama' | 'gemini' | 'litellm' | 'test'
    const provider: ProviderName = process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'test'

    let builder = ReactiveAgents.create()
        .withName('canonical-chat-session-node')
        .withProvider(provider)
        .withTools({ builtins: true })

    if (provider === 'test') {
        builder = builder.withTestScenario([
            { match: '', text: 'This is a deterministic reply from the test provider — set ANTHROPIC_API_KEY for live answers.' },
        ])
    }

    const agent = await builder.build()
    const session = agent.session()
    const rl = createInterface({ input: stdin, output: stdout })

    console.log('Chat session started. Type "exit" to end.')

    try {
        for (;;) {
            const userInput = (await rl.question('You: ')).trim()
            if (!userInput) continue
            if (userInput.toLowerCase() === 'exit') break

            const reply = await session.chat(userInput)
            console.log('Agent:', reply.message)
        }
    } finally {
        rl.close()
        await session.end()
        await agent.dispose()
    }
}

main().catch((error) => {
    console.error('Session failed:', error)
    process.exit(1)
})
