import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type ProjectTemplate = "minimal" | "standard" | "full";

interface ProjectConfig {
  name: string;
  template: ProjectTemplate;
  targetDir: string;
}

const TEMPLATE_DEPS: Record<ProjectTemplate, string[]> = {
  minimal: ["@reactive-agents/core", "@reactive-agents/llm-provider", "@reactive-agents/runtime"],
  standard: [
    "@reactive-agents/core",
    "@reactive-agents/llm-provider",
    "@reactive-agents/memory",
    "@reactive-agents/reasoning",
    "@reactive-agents/tools",
    "@reactive-agents/runtime",
  ],
  full: [
    "@reactive-agents/core",
    "@reactive-agents/llm-provider",
    "@reactive-agents/memory",
    "@reactive-agents/reasoning",
    "@reactive-agents/tools",
    "@reactive-agents/verification",
    "@reactive-agents/cost",
    "@reactive-agents/identity",
    "@reactive-agents/orchestration",
    "@reactive-agents/observability",
    "@reactive-agents/interaction",
    "@reactive-agents/guardrails",
    "@reactive-agents/prompts",
    "@reactive-agents/runtime",
  ],
};

export function generateProject(config: ProjectConfig): { files: string[] } {
  const { name, template, targetDir } = config;
  const files: string[] = [];

  // Create directory structure
  const dirs = [targetDir, join(targetDir, "src"), join(targetDir, "src", "agents")];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // package.json
  const deps = Object.fromEntries(TEMPLATE_DEPS[template].map((d) => [d, "latest"]));
  const packageJson = {
    name,
    version: "0.1.3",
    type: "module",
    scripts: {
      dev: "bun run src/index.ts",
      build: "tsc --noEmit",
      test: "bun test",
    },
    dependencies: {
      effect: "^3.10.0",
      ...deps,
    },
    devDependencies: {
      typescript: "^5.7.0",
      "bun-types": "latest",
    },
  };
  const pkgPath = join(targetDir, "package.json");
  writeFileSync(pkgPath, JSON.stringify(packageJson, null, 2) + "\n");
  files.push(pkgPath);

  // tsconfig.json
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "ES2022",
      moduleResolution: "bundler",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      outDir: "dist",
      types: ["bun-types"],
    },
    include: ["src/**/*"],
  };
  const tscPath = join(targetDir, "tsconfig.json");
  writeFileSync(tscPath, JSON.stringify(tsconfig, null, 2) + "\n");
  files.push(tscPath);

  // Example agent
  const agentCode = generateAgentExample(template);
  const agentPath = join(targetDir, "src", "agents", "my-agent.ts");
  writeFileSync(agentPath, agentCode);
  files.push(agentPath);

  // Entry point
  const entryCode = `import { ReactiveAgents } from "@reactive-agents/runtime";

const agent = await ReactiveAgents.create()
  .withProvider("anthropic")
  .withName("my-agent")
  .build();

const result = await agent.run("Hello, what can you help me with?");
console.log(result);
`;
  const entryPath = join(targetDir, "src", "index.ts");
  writeFileSync(entryPath, entryCode);
  files.push(entryPath);

  // .env.example
  const envExample = `# LLM Provider
ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...

# Optional
LLM_DEFAULT_MODEL=claude-sonnet-4-20250514
`;
  const envPath = join(targetDir, ".env.example");
  writeFileSync(envPath, envExample);
  files.push(envPath);

  return { files };
}

function generateAgentExample(template: ProjectTemplate): string {
  switch (template) {
    case "minimal":
      return `import { ReactiveAgents } from "@reactive-agents/runtime";

export const createMyAgent = () =>
  ReactiveAgents.create()
    .withProvider("anthropic")
    .withName("my-agent")
    .build();
`;
    case "standard":
      return `import { ReactiveAgents } from "@reactive-agents/runtime";

export const createMyAgent = () =>
  ReactiveAgents.create()
    .withProvider("anthropic")
    .withName("my-agent")
    .withMemory(true)
    .withReasoning("reactive")
    .build();
`;
    case "full":
      return `import { ReactiveAgents } from "@reactive-agents/runtime";

export const createMyAgent = () =>
  ReactiveAgents.create()
    .withProvider("anthropic")
    .withName("my-agent")
    .withMemory(true)
    .withReasoning("reactive")
    .withVerification(true)
    .withGuardrails(true)
    .build();
`;
  }
}
