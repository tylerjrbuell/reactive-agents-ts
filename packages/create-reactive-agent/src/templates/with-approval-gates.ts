import type { ScaffoldOptions, Template, TemplateFile } from "../types.js";
import { providerDefaultModel, providerRuntimeName } from "../lib/provider-config.js";
import { renderEnvGuard, renderFailHelper } from "./shared.js";

export const withApprovalGatesTemplate: Template = {
  name: "with-approval-gates",
  description: "Human-in-the-loop — pause on sensitive tool calls for approval.",
  render: (opts: ScaffoldOptions): readonly TemplateFile[] => {
    return [{ path: "src/index.ts", content: renderIndex(opts) }];
  },
};

function renderIndex(opts: ScaffoldOptions): string {
  const model = providerDefaultModel(opts.provider);

  return `import { createInterface } from "node:readline/promises";
import { ReactiveAgents } from "reactive-agents";

${renderEnvGuard(opts)}

// Approval gates pause the run before a sensitive tool executes so a human can
// approve or deny. .withDurableRuns() persists the paused run; the run()
// \`onApproval\` callback drives pause -> decide -> resume in a single call.
const agent = await ReactiveAgents.create()
  .withName("guarded-assistant")
  .withProvider("${providerRuntimeName(opts.provider)}")
  .withModel("${model}")
  .withTools({ builtins: true })
  .withReasoning({ defaultStrategy: "reactive" })
  .withDurableRuns()
  .withApprovalPolicy({
    // Any call to these tools pauses for approval. Add your own tool names.
    tools: ["file-write", "shell-execute"],
    mode: "detach",
  })
  .withMaxIterations(6)
  .build()
  .catch(fail);

const task = process.argv.slice(2).join(" ") ||
  "Write a haiku to a file called poem.txt in the current directory.";

console.log(\`> \${task}\\n\`);

// Ask the human at the terminal.
async function askHuman(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

// With no terminal (CI, a pipe) nobody can answer, so pass no callback. The
// run then stops at the first gated call (fails CLOSED: the tool never runs)
// and returns status "awaiting-approval" instead of asking again and again.
const interactive = process.stdin.isTTY === true;

const result = await agent
  .run(task, {
    // Called whenever a gated tool wants to run. Return true/false, or
    // { approve, reason }.
    onApproval: interactive
      ? async (pending) => {
          console.log(\`\\n[approval needed] tool="\${pending.toolName}" args=\${JSON.stringify(pending.args)}\`);
          const approve = await askHuman("Approve this call? [y/N] ");
          console.log(\`[decision] \${approve ? "APPROVED" : "DENIED"}\\n\`);
          return approve ? true : { approve: false, reason: "denied at the prompt" };
        }
      : undefined,
  })
  .catch(fail);

if (result.status === "awaiting-approval" && result.pendingApproval) {
  console.log(
    \`[paused] "\${result.pendingApproval.toolName}" needs approval, but there is no terminal to ask. \` +
      "The call did not run. Run this in a terminal to approve or deny it.",
  );
} else {
  console.log(result.output);
}
// outcome is set on a finished run; status says why a run is paused.
console.log(\`\\nOutcome: \${result.outcome ?? result.status} | Steps: \${result.metadata.stepsCount}\`);

${renderFailHelper()}
`;
}
