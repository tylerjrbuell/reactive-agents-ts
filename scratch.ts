/**
 * Demo: CLI skills — git-cli and gh-cli
 *
 * Uses the reactive strategy with the new git-cli and gh-cli built-in tools.
 * gws-cli requires `gws` installed + auth so it's excluded from this demo.
 */
import { ReactiveAgents } from 'reactive-agents'

const agent = await ReactiveAgents.create()
    .withProvider('ollama')
    .withModel({ model: 'cogito:14b' })
    .withReasoning({
        defaultStrategy: 'reactive',
    })
    .withTools()
    .withObservability({ verbosity: 'minimal', live: false })
    .build()

const result = await agent.run(
    'You have a git-cli tool available. Use it (not code-execute) to: ' +
        '(1) run "log --oneline -5" to get the last 5 commits, ' +
        '(2) run "branch --show-current" to get the current branch, ' +
        '(3) run "status --short" to see modified/untracked files. ' +
        '**Then write a Haiku about what you found**.'
)

console.log('\n--- Result ---')
console.log(result.output)

await agent.dispose()
