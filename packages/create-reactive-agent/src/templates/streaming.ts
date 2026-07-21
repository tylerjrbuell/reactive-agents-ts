import type { ScaffoldOptions, Template, TemplateFile } from "../types.js";
import { providerDefaultModel, providerEnvVar, providerRuntimeName } from "../lib/provider-config.js";

export const streamingTemplate: Template = {
  name: "streaming",
  description: "Token-by-token streaming via agent.runStream().",
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

const agent = await ReactiveAgents.create()
  .withName("streaming-assistant")
  .withProvider("${providerRuntimeName(opts.provider)}")
  .withModel("${model}")
  .withMaxIterations(3)
  .build();

const task = process.argv.slice(2).join(" ") || "Write a haiku about token streaming.";

console.log(\`> \${task}\\n\`);

// runStream() yields AgentStreamEvents as the agent thinks + acts. The union
// is discriminated by \`_tag\`: "TextDelta" carries assistant token chunks,
// "IterationProgress" marks each reasoning iteration, and "StreamCompleted" /
// "StreamError" always end the stream. (Build with .withStreaming({ density:
// "full" }) to also receive phase/tool/thought events.)
for await (const event of agent.runStream(task)) {
  switch (event._tag) {
    case "TextDelta":
      process.stdout.write(event.text);
      break;
    case "IterationProgress":
      // one reasoning iteration finished (event.iteration / event.maxIterations)
      break;
    case "StreamCompleted":
      console.log(\`\\n\\n[done] steps=\${event.metadata.stepsCount} cost=$\${event.metadata.cost.toFixed(6)}\`);
      break;
    case "StreamError":
      console.error(\`\\n[error] \${event.cause}\`);
      break;
  }
}
`;
}
