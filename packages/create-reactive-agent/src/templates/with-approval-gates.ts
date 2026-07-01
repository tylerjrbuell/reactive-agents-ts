import type { ScaffoldOptions, Template, TemplateFile } from "../types.js";
import { providerDefaultModel, providerEnvVar } from "../lib/provider-config.js";

export const withApprovalGatesTemplate: Template = {
  name: "with-approval-gates",
  description: "Human-in-the-loop — pause on sensitive tool calls for approval.",
  render: (opts: ScaffoldOptions): readonly TemplateFile[] => {
    return [{ path: "src/index.ts", content: renderIndex(opts) }];
  },
};

function renderIndex(opts: ScaffoldOptions): string {
  const model = providerDefaultModel(opts.provider);
  const envVar = providerEnvVar(opts.provider);
  const envCheck = envVar
    ? `if (!process.env.${envVar}) {
  console.error("Missing ${envVar} in environment. See .env.example.");
  process.exit(1);
}`
    : `// Ollama is local — no API key required.`;

  return `import { ReactiveAgents } from "reactive-agents";

${envCheck}

// Approval gates pause the run before a sensitive tool executes so a human can
// approve or deny. .withDurableRuns() persists the paused run; the run()
// \`onApproval\` callback drives pause -> decide -> resume in a single call.
const agent = await ReactiveAgents.create()
  .withName("guarded-assistant")
  .withProvider("${opts.provider}")
  .withModel("${model}")
  .withTools()
  .withReasoning({ defaultStrategy: "reactive" })
  .withDurableRuns()
  .withApprovalPolicy({
    // Any call to these tools pauses for approval. Add your own tool names.
    tools: ["file-write", "shell-execute"],
    mode: "detach",
  })
  .withMaxIterations(6)
  .build();

const task = process.argv.slice(2).join(" ") ||
  "Write a haiku to a file called poem.txt in the current directory.";

console.log(\`> \${task}\\n\`);

const result = await agent.run(task, {
  // Called whenever a gated tool wants to run. Return true/false, or
  // { approve, reason }. Here we auto-approve and log — swap in a real prompt.
  onApproval: (pending) => {
    console.log(\`\\n[approval needed] tool="\${pending.toolName}" args=\${JSON.stringify(pending.args)}\`);
    const approve = true; // TODO: prompt the user (e.g. readline) and return their choice.
    console.log(\`[decision] \${approve ? "APPROVED" : "DENIED"}\\n\`);
    return approve;
  },
});

console.log(result.output);
console.log(\`\\nStatus: \${result.status} | Steps: \${result.metadata.stepsCount}\`);
`;
}
