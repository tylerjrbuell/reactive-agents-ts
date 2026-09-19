import type { ScaffoldOptions, Template, TemplateFile } from "../types.js";

// Cloudflare Workers run on the workerd edge runtime, not Node/Bun. Two facts
// shape this template (both confirmed by bundling the facade for workerd):
//   1. `nodejs_compat` is required — the framework transitively touches Node
//      built-ins; without the flag the Worker fails to bundle.
//   2. The agent is pinned to OpenAI: its adapter is fetch-based and edge-safe.
//      Other providers/SDKs are not verified on the edge. Persistent memory
//      (SQLite) and shell/filesystem tools degrade to no-ops on workerd, so
//      this template keeps the agent minimal (no `.withMemory()`, no builtins).
export const cloudflareWorkerTemplate: Template = {
  name: "cloudflare-worker",
  description: "Deployable Cloudflare Worker (edge) agent on OpenAI. Includes wrangler config + one-command deploy.",
  extraDevDependencies: { wrangler: "^3.90.0" },
  extraScripts: { dev: "wrangler dev", deploy: "wrangler deploy" },
  gitignoreLines: [".dev.vars", ".wrangler/"],
  render: (opts: ScaffoldOptions): readonly TemplateFile[] => {
    return [
      { path: "src/index.ts", content: renderWorker() },
      { path: "wrangler.toml", content: renderWrangler(opts) },
      { path: ".dev.vars", content: renderDevVars() },
      // Override the shared .env.example: Workers use .dev.vars, not .env.
      { path: ".env.example", content: renderEnvExample() },
      // Override the shared README with edge-specific dev/deploy steps.
      { path: "README.md", content: renderReadme(opts) },
    ];
  },
};

function renderWorker(): string {
  return `import { ReactiveAgents } from "reactive-agents";

// Secret binding — set in .dev.vars for \`wrangler dev\`, and in production via
// \`wrangler secret put OPENAI_API_KEY\`. The edge runtime has no ambient env.
export interface Env {
  readonly OPENAI_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const question =
      new URL(request.url).searchParams.get("q") ??
      "What is the capital of France?";

    // Pinned to OpenAI: its adapter is fetch-based and runs on workerd. The key
    // is injected from the Worker binding above.
    const agent = await ReactiveAgents.create()
      .withName("edge-assistant")
      .withProvider("openai", { apiKey: env.OPENAI_API_KEY })
      .withModel("gpt-4o-mini")
      .withMaxIterations(3)
      .build();

    const result = await agent.run(question);

    return Response.json({
      question,
      output: result.output,
      steps: result.metadata.stepsCount,
      cost: result.metadata.cost,
    });
  },
};
`;
}

function renderWrangler(opts: ScaffoldOptions): string {
  return `name = "${opts.projectName}"
main = "src/index.ts"
compatibility_date = "2024-09-23"

# reactive-agents transitively uses Node built-ins; the edge runtime needs this
# flag to provide them. Without it the Worker will not bundle.
compatibility_flags = ["nodejs_compat"]
`;
}

function renderDevVars(): string {
  return `# Local secrets for \`wrangler dev\` — git-ignored, never committed.
# Add the same key to production with:
#   wrangler secret put OPENAI_API_KEY
OPENAI_API_KEY=your-key-here
`;
}

function renderEnvExample(): string {
  return `# Cloudflare Workers load local secrets from .dev.vars, not .env.
# See .dev.vars (git-ignored) for OPENAI_API_KEY.
`;
}

function renderReadme(opts: ScaffoldOptions): string {
  const pm = opts.packageManager;
  const run = pm === "npm" ? "npm run" : pm;

  return `# ${opts.projectName}

A Reactive Agents agent deployed as a Cloudflare Worker, scaffolded with \`create-reactive-agent\`.

- **Template:** cloudflare-worker
- **Provider:** OpenAI (edge-compatible)
- **Runtime:** Cloudflare Workers (workerd)

## Setup

1. Install dependencies:

   \`\`\`bash
   ${pm} install
   \`\`\`

2. Add your OpenAI key to \`.dev.vars\` (already stubbed, git-ignored):

   \`\`\`
   OPENAI_API_KEY=sk-...
   \`\`\`

## Develop locally

\`\`\`bash
${run} dev
\`\`\`

Then open <http://localhost:8787/?q=Your+question+here>.

## Deploy

Authenticate once with \`wrangler login\`, push your production secret, then deploy:

\`\`\`bash
npx wrangler secret put OPENAI_API_KEY
${run} deploy
\`\`\`

## Notes

- \`compatibility_flags = ["nodejs_compat"]\` is required (see \`wrangler.toml\`) — the framework uses Node built-ins the edge runtime must polyfill.
- Persistent memory (SQLite) and shell/filesystem tools are **not** available on the edge; this template runs a minimal fetch-only agent.

## Learn more

- Docs: <https://docs.reactiveagents.dev>
- Cloudflare Workers: <https://developers.cloudflare.com/workers/>
`;
}
