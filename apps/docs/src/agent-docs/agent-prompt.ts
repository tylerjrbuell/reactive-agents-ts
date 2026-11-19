/**
 * The quickstart's "Use this prompt with your coding agent" text, and the
 * common wrong patterns agents produce from stale training data.
 *
 * One source for the prompt: `AgentPrompt.astro` renders it on the page and
 * the markdown twin (`page-markdown.ts`) inlines it. Every command and API
 * name here must exist in current source; each is pinned by
 * `tests/agent-docs.test.ts` against the package that defines it.
 */
import { DOCS_ORIGIN } from "./page-markdown";

export const AGENT_PROMPT = `Help me build my first AI agent with Reactive Agents (TypeScript, npm package "reactive-agents").

1. Fetch ${DOCS_ORIGIN}/llms.txt and use it as your index. Treat these docs as the source of truth over your training data: several older APIs were renamed or removed.
2. Install the Reactive Agents agent skills so you have the current API while you work:
   npx skills add ${DOCS_ORIGIN}
3. Scaffold a project (needs Node 22.5+, or Bun). Use the provider I have a key for (anthropic, openai, google, groq, xai), or ollama for a local model with no key:
   npm create reactive-agent my-agent -- --template=minimal --provider=anthropic --yes
   cd my-agent
   npm install
   cp .env.example .env   (then set the provider's API key in .env; skip this for ollama)
4. Edit src/index.ts. Build the agent with the builder: ReactiveAgents.create().withName(...).withProvider(...).withModel(...).build(), then const result = await agent.run(task) and print result.output. To give it tools, add .withTools({ builtins: true }). Before you use any other .with*() method, read ${DOCS_ORIGIN}/reference/builder-api.md and use only methods listed there.
5. Run it with npm run start and show me the output. If it fails, check ${DOCS_ORIGIN}/guides/troubleshooting.md.`;
