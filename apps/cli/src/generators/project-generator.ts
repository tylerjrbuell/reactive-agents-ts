import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type ProjectTemplate = "minimal" | "standard" | "full";

interface ProjectConfig {
  name: string;
  template: ProjectTemplate;
  targetDir: string;
  /** Detected from env vars at init time — defaults to "ollama" (no API key needed). */
  provider?: string;
}

export function generateProject(config: ProjectConfig): { files: string[] } {
  const { name, template, targetDir, provider = "ollama" } = config;
  const files: string[] = [];

  const dirs = [targetDir, join(targetDir, "src")];
  for (const dir of dirs) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  // package.json — single unified dependency, not 14 granular packages
  const packageJson = {
    name,
    version: "0.1.0",
    type: "module",
    scripts: {
      dev: "bun --watch run src/index.ts",
      start: "bun run src/index.ts",
      build: "tsc --noEmit",
      test: "bun test",
    },
    dependencies: { "reactive-agents": "latest" },
    devDependencies: { typescript: "^5.7.0", "bun-types": "latest" },
  };
  const pkgPath = join(targetDir, "package.json");
  writeFileSync(pkgPath, JSON.stringify(packageJson, null, 2) + "\n");
  files.push(pkgPath);

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

  const entryPath = join(targetDir, "src", "index.ts");
  writeFileSync(entryPath, generateEntryPoint(template, provider));
  files.push(entryPath);

  const envPath = join(targetDir, ".env.example");
  writeFileSync(envPath, [
    "# Add your LLM provider API key:",
    "ANTHROPIC_API_KEY=sk-ant-...",
    "# OPENAI_API_KEY=sk-...",
    "# GOOGLE_API_KEY=...",
    "",
    "# Optional — override default model",
    "# LLM_DEFAULT_MODEL=claude-sonnet-4-20250514",
    "",
  ].join("\n"));
  files.push(envPath);

  const gitignorePath = join(targetDir, ".gitignore");
  writeFileSync(gitignorePath, ".env\nnode_modules/\ndist/\n*.log\n");
  files.push(gitignorePath);

  return { files };
}

function generateEntryPoint(template: ProjectTemplate, provider: string): string {
  const providerLine = `  .withProvider("${provider}")`;

  if (template === "minimal") {
    return [
      'import { ReactiveAgents } from "reactive-agents";',
      "",
      "const agent = await ReactiveAgents.create()",
      providerLine,
      "  .build();",
      "",
      'const result = await agent.run("Explain the difference between TCP and UDP in one paragraph.");',
      "console.log(result.output);",
      "",
    ].join("\n");
  }

  if (template === "standard") {
    return [
      'import { ReactiveAgents } from "reactive-agents";',
      "",
      "const agent = await ReactiveAgents.create()",
      providerLine,
      '  .withReasoning({ defaultStrategy: "adaptive" })',
      "  .withTools()",
      '  .withObservability({ verbosity: "normal", live: true })',
      "  .build();",
      "",
      "const result = await agent.run(",
      '  "Search for the latest TypeScript 5.x release notes and summarize the key new features.",',
      ");",
      "",
      'console.log("\\n=== Result ===");',
      "console.log(result.output);",
      "console.log(`\\nCompleted in ${(result.metadata.duration / 1000).toFixed(1)}s | ${result.metadata.tokensUsed} tokens`);",
      "",
    ].join("\n");
  }

  // full
  return [
    'import { ReactiveAgents } from "reactive-agents";',
    "",
    "const agent = await ReactiveAgents.create()",
    providerLine,
    '  .withName("production-agent")',
    "  .withReasoning({",
    '    defaultStrategy: "adaptive",',
    "    enableStrategySwitching: true,",
    "    maxStrategySwitches: 1,",
    '    fallbackStrategy: "plan-execute-reflect",',
    "  })",
    "  .withTools()",
    '  .withMemory("production-agent")',
    "  .withGuardrails()",
    "  .withCostTracking({ budget: { maxTokens: 50_000 } })",
    '  .withObservability({ verbosity: "normal", live: true })',
    "  .withRetryPolicy({ maxRetries: 2, backoffMs: 1_000 })",
    "  .withHealthCheck()",
    "  .build();",
    "",
    "const health = await agent.health();",
    "console.log(`Agent health: ${health.status}`);",
    "",
    "const result = await agent.run(",
    '  "Research the top 3 open-source AI agent frameworks in 2026 and compare their key features.",',
    ");",
    "",
    'console.log("\\n=== Result ===");',
    "console.log(result.output);",
    "console.log(`\\nStrategy: ${result.metadata.strategyUsed} | Steps: ${result.metadata.stepsCount} | ${result.metadata.tokensUsed} tokens`);",
    "",
  ].join("\n");
}
