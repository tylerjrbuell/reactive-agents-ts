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

// ── Per-provider defaults ────────────────────────────────────────────────
//
// FIX-13 / W16 — when scaffolding, the chosen provider drives:
//   1. the model passed to `.withModel(...)` in the entry file,
//   2. which env var is the *active* line in `.env.example` (others are
//      commented as alternatives, not suppressed entirely),
//   3. README setup notes.
//
// SHAs match the cost router's W10 refresh (claude-sonnet-4-6, claude-opus-4-7).
// Haiku stays at the dated SHA per Anthropic's own recommendation.
interface ProviderProfile {
  /** Default model id for this provider. */
  readonly model: string;
  /** Required env var (or null for ollama which uses a local server). */
  readonly envVar: string | null;
  /** Example placeholder shown in .env.example. */
  readonly envPlaceholder: string;
  /** Short setup blurb for the README. */
  readonly setupNote: string;
}

const PROVIDER_PROFILES: Record<string, ProviderProfile> = {
  ollama: {
    model: "qwen3.5",
    envVar: null,
    envPlaceholder: "# OLLAMA_HOST=http://localhost:11434  (default — only set if your Ollama is elsewhere)",
    setupNote:
      "This project uses Ollama (local). Make sure `ollama serve` is running and the model is pulled:\n\n```sh\nollama pull qwen3.5\n```",
  },
  anthropic: {
    model: "claude-haiku-4-5-20251001",
    envVar: "ANTHROPIC_API_KEY",
    envPlaceholder: "sk-ant-...",
    setupNote:
      "This project uses Anthropic Claude. Get an API key at https://console.anthropic.com/ and set `ANTHROPIC_API_KEY` in `.env`.",
  },
  openai: {
    model: "gpt-4o-mini",
    envVar: "OPENAI_API_KEY",
    envPlaceholder: "sk-...",
    setupNote:
      "This project uses OpenAI. Get an API key at https://platform.openai.com/api-keys and set `OPENAI_API_KEY` in `.env`.",
  },
  gemini: {
    model: "gemini-2.0-flash",
    envVar: "GOOGLE_API_KEY",
    envPlaceholder: "AIza...",
    setupNote:
      "This project uses Google Gemini. Get an API key at https://aistudio.google.com/apikey and set `GOOGLE_API_KEY` in `.env`.",
  },
};

function resolveProfile(provider: string): ProviderProfile {
  return PROVIDER_PROFILES[provider] ?? PROVIDER_PROFILES.ollama!;
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

  const profile = resolveProfile(provider);

  const entryPath = join(targetDir, "src", "index.ts");
  writeFileSync(entryPath, generateEntryPoint(template, provider, profile));
  files.push(entryPath);

  const envPath = join(targetDir, ".env.example");
  writeFileSync(envPath, generateEnvExample(provider, profile));
  files.push(envPath);

  const gitignorePath = join(targetDir, ".gitignore");
  writeFileSync(gitignorePath, ".env\nnode_modules/\ndist/\n*.log\n");
  files.push(gitignorePath);

  const readmePath = join(targetDir, "README.md");
  writeFileSync(readmePath, generateReadme(name, template, provider, profile));
  files.push(readmePath);

  return { files };
}

function generateEnvExample(provider: string, profile: ProviderProfile): string {
  const lines: string[] = ["# Environment variables for this project."];
  lines.push("");

  if (profile.envVar) {
    lines.push(`# ${provider} is the detected provider — fill in the key below.`);
    lines.push(`${profile.envVar}=${profile.envPlaceholder}`);
  } else {
    // ollama — no API key needed
    lines.push("# ollama is the detected provider — no API key required.");
    lines.push(profile.envPlaceholder);
  }
  lines.push("");

  // List the alternative providers as commented hints so users can swap
  // without re-running `rax init`.
  lines.push("# Alternative providers (uncomment + change .withProvider/.withModel in src/index.ts to use):");
  for (const [name, p] of Object.entries(PROVIDER_PROFILES)) {
    if (name === provider || !p.envVar) continue;
    lines.push(`# ${p.envVar}=${p.envPlaceholder}`);
  }
  lines.push("");
  return lines.join("\n");
}

function generateReadme(
  name: string,
  template: ProjectTemplate,
  provider: string,
  profile: ProviderProfile,
): string {
  return `# ${name}

A reactive-agents project scaffolded with \`rax init --template ${template}\`.

## Setup

${profile.setupNote}

\`\`\`sh
bun install
${profile.envVar ? "cp .env.example .env  # then fill in your key\n" : ""}bun run dev
\`\`\`

## Stack

- **Provider:** \`${provider}\`
- **Default model:** \`${profile.model}\`
- **Template:** \`${template}\`

The entry point is at \`src/index.ts\`. The framework's full builder API is
documented at https://docs.reactiveagents.dev/.
`;
}

function generateEntryPoint(
  template: ProjectTemplate,
  provider: string,
  profile: ProviderProfile,
): string {
  const providerLine = `  .withProvider("${provider}")`;
  const modelLine = `  .withModel("${profile.model}")`;

  if (template === "minimal") {
    return [
      'import { ReactiveAgents } from "reactive-agents";',
      "",
      "const agent = await ReactiveAgents.create()",
      providerLine,
      modelLine,
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
      modelLine,
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
    modelLine,
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
