import { ReactiveAgents } from 'reactive-agents'

const agent = await ReactiveAgents.create()
    .withName('local-researcher')
    .withProvider('ollama')
    .withModel('cogito:14b')
    .withReasoning({
        defaultStrategy: 'reflexion',
        enableStrategySwitching: true,
    })
    .withTools({ allowedTools: ['web-search', 'file-read', 'file-write'] })
    .withContextProfile({ tier: 'local' })
    .withMaxIterations(8)
    .withKillSwitch()
    .withMemory()
    .withObservability({ verbosity: 'normal', live: true })
    .build()

const result = await agent.run(
    'Read the CLAUDE.md file. Then explore the codebase and find the most relevant files to the project.'
)
console.log(result.output)

await agent.dispose()
