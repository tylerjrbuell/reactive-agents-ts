import type { ScaffoldOptions } from "../types.js";
import { providerDisplayName } from "../lib/provider-config.js";

/** Docs site root. Every URL in the generated AGENTS.md hangs off this. */
export const DOCS_URL = "https://docs.reactiveagents.dev";

/** Machine-readable docs index for coding agents (starlight-llms-txt). */
export const LLMS_TXT_URL = `${DOCS_URL}/llms.txt`;

/** One-line post-scaffold hint, shared by `create-reactive-agent` and `rax init`. */
export const AGENTS_MD_HINT =
  "Using a coding agent? AGENTS.md points it at the current docs and skills.";

/**
 * Renders the AGENTS.md written into every scaffolded project (one shared
 * template, not one per template). It points coding agents (Claude Code,
 * Cursor, Codex) at the current docs instead of training data, which knows
 * older builder APIs. No network call at scaffold time: skills install is a
 * printed command the user (or their agent) runs.
 *
 * `scripts` is the generated package.json `scripts` object, so the "Run"
 * section lists only commands the project really has.
 */
export function renderAgentsMd(
  opts: ScaffoldOptions,
  scripts: Readonly<Record<string, string>>,
): string {
  const isWorker = opts.template === "cloudflare-worker";
  // A Worker runs through wrangler (`dev`/`deploy`); its shared `start` script
  // is not the way to run it, so it is left out of the list.
  const runLines = Object.entries(scripts)
    .filter(([name]) => !(isWorker && name === "start"))
    .map(([name, cmd]) => `${opts.packageManager} run ${name}  # ${cmd}`)
    .join("\n");
  const secretsRule = isWorker
    ? "Keep API keys in `.dev.vars` locally and `wrangler secret put` in production. Never hardcode them."
    : "Keep API keys in `.env` (see `.env.example`). Never hardcode them.";
  // `.withTracing()` writes JSONL to the local filesystem, which the Workers
  // runtime does not have, so the Worker gets no trace-based debugging section.
  const failSection = isWorker
    ? ""
    : `
## When a run fails

Add \`.withTracing()\` to the builder, run again, then explain the run from its trace:

\`\`\`bash
npx rax diagnose cause latest
\`\`\`
`;

  return `# AGENTS.md

Instructions for coding agents (Claude Code, Cursor, Codex, Copilot) working in this project.

## What this is

\`${opts.projectName}\` is a [Reactive Agents](${DOCS_URL}) project scaffolded with \`create-reactive-agent\`
(template: \`${opts.template}\`, provider: ${providerDisplayName(opts.provider)}). The agent code is in \`src/index.ts\`.

## Read the docs first

Reactive Agents changes quickly. Your training data likely holds older APIs. Trust the docs over memory.

- Docs index for agents: ${LLMS_TXT_URL}
- Any docs page as markdown: append \`.md\` to the page URL.
- Install the framework's agent skills: \`npx skills add ${DOCS_URL}\`
  (start with the \`reactive-agents\` and \`builder-api-reference\` skills).

## Rules

1. Import from \`reactive-agents\` only. Do not add \`@reactive-agents/*\` packages unless the docs say to.
2. Build agents with \`ReactiveAgents.create()\`, chain \`.with*()\` methods, then \`await .build()\`.
   Before using a \`.with*()\` method, confirm it in the builder reference. Never invent one.
3. Run with \`await agent.run(input)\`. The answer is \`result.output\` (\`result.object\` with an output schema).
4. ${secretsRule}
5. Run the typecheck script after every change.

## Run

\`\`\`bash
${opts.packageManager} install
${runLines}
\`\`\`
${failSection}`;
}
