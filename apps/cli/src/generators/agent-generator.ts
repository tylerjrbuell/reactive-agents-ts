import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

export type AgentRecipe = "basic" | "researcher" | "coder" | "orchestrator";

interface AgentConfig {
  name: string;
  recipe: AgentRecipe;
  targetDir: string;
  /** Detected from env vars at init time — defaults to "ollama". */
  provider?: string;
}

function makeRecipeTemplates(provider: string): Record<AgentRecipe, (name: string) => string> {
  return {
    basic: (name) => `import { ReactiveAgents } from "reactive-agents";

export const ${toCamelCase(name)} = () =>
  ReactiveAgents.create()
    .withProvider("${provider}")
    .withName("${name}")
    .build();
`,

    researcher: (name) => `import { ReactiveAgents } from "reactive-agents";

export const ${toCamelCase(name)} = () =>
  ReactiveAgents.create()
    .withProvider("${provider}")
    .withName("${name}")
    .withSystemPrompt("You are a research assistant. Gather information, synthesize findings, and provide well-sourced answers.")
    .withMemory()
    .withReasoning()
    .withTools()
    .build();
`,

    coder: (name) => `import { ReactiveAgents } from "reactive-agents";

export const ${toCamelCase(name)} = () =>
  ReactiveAgents.create()
    .withProvider("${provider}")
    .withName("${name}")
    .withSystemPrompt("You are a coding assistant. Write clean, well-tested code and explain your decisions.")
    .withReasoning()
    .withTools()
    .build();
`,

    orchestrator: (name) => `import { ReactiveAgents } from "reactive-agents";

export const ${toCamelCase(name)} = () =>
  ReactiveAgents.create()
    .withProvider("${provider}")
    .withName("${name}")
    .withSystemPrompt("You are an orchestrator agent. Decompose complex tasks and coordinate sub-agents.")
    .withMemory()
    .withReasoning()
    .withTools()
    .build();
`,
  };
}

export function generateAgent(config: AgentConfig): { filePath: string } {
  const { name, recipe, targetDir, provider = "ollama" } = config;
  const fileName = `${toKebabCase(name)}.ts`;
  const filePath = join(targetDir, "src", "agents", fileName);

  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const RECIPE_TEMPLATES = makeRecipeTemplates(provider);
  const template = RECIPE_TEMPLATES[recipe];
  writeFileSync(filePath, template(name));

  return { filePath };
}

function toCamelCase(str: string): string {
  return str
    .replace(/[-_]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^(.)/, (_, c) => c.toLowerCase());
}

function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}
