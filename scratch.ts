/**
 * Test: context7 MCP via docker — pure stdio
 *
 * mcp/context7 is a stdio MCP server. `docker run -i --rm` pipes
 * stdin/stdout directly to the container; no port mapping needed.
 * The HTTP server it starts on :8080 is for Docker Gateway multi-client
 * scenarios only — direct clients use stdio.
 */
import { ReactiveAgents } from 'reactive-agents'

const agent = await ReactiveAgents.create()
    .withProvider('ollama')
    .withModel({ model: 'gemma4:e4b', temperature: 0.2, maxTokens: 10000 })
    .withCortex()
    // .withMCP({
    //     name: 'context7',
    //     transport: 'stdio',
    //     command: 'docker',
    //     args: ['run', '-i', '--rm', 'mcp/context7:latest'],
    // })
    // .withMCP({
    //     name: 'github',
    //     transport: 'stdio',
    //     command: 'docker',
    //     args: [
    //         'run',
    //         '-i',
    //         '--rm',
    //         '-e',
    //         'GITHUB_PERSONAL_ACCESS_TOKEN',
    //         'ghcr.io/github/github-mcp-server',
    //     ],
    //     env: {
    //         GITHUB_PERSONAL_ACCESS_TOKEN:
    //             process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? '',
    //     },
    // })
    .withReasoning({ defaultStrategy: 'reactive' })
    .withTools({
        terminal: {
            additionalCommands: ['gh', 'rax'],
        },
    })
    // .withDynamicSubAgents()
    .withMemory()
    .withObservability({ verbosity: 'debug', live: true })
    .withVerification()
    .build()

const result = await agent.run(
    'What is the Reactive Agents TypeScript framework?'
)

console.log('\n--- Result ---')
console.log(result.output)

await agent.dispose()
