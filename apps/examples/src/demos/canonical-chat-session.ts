/**
 * Canonical multi-turn chat session example (Bun-native).
 *
 * Demonstrates the documented `agent.session()` / `session.chat()` pattern
 * (see README.md "Conversational Chat") end to end, including `history()`
 * and `end()`.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/demos/canonical-chat-session.ts
 *
 * Or with no key set, it falls back to the deterministic `test` provider so
 * the example runs offline.
 */
import { ReactiveAgents } from 'reactive-agents'

async function main() {
    type ProviderName = 'anthropic' | 'openai' | 'ollama' | 'gemini' | 'litellm' | 'test'
    const provider: ProviderName = process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'test'

    let builder = ReactiveAgents.create()
        .withName('canonical-chat-session')
        .withProvider(provider)
        .withTools({ builtins: true })

    if (provider === 'test') {
        builder = builder.withTestScenario([
            {
                match: 'tools',
                text: 'I have access to built-in tools such as web-search, file operations, and the current-time utility.',
            },
            {
                match: 'time',
                text: 'The current time is 2026-08-20T00:00:00Z (deterministic test-provider reply).',
            },
        ])
    }

    const agent = await builder.build()
    const session = agent.session()

    try {
        const first = await session.chat('What tools do you have available?')
        console.log('Agent:', first.message)

        const second = await session.chat('Use one of them to tell me the current time.')
        console.log('Agent:', second.message)

        console.log('Turn count:', session.history().length)
    } finally {
        await session.end()
        await agent.dispose()
    }
}

if (import.meta.main) {
    main().catch((error) => {
        console.error('Session failed:', error)
        process.exit(1)
    })
}
