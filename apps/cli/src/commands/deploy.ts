// apps/cli/src/commands/deploy.ts
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dockerfileTemplate } from "../templates/dockerfile.js";
import { composeSingleTemplate } from "../templates/compose.js";
import { raxdConfigTemplate } from "../templates/raxd-config.js";

const HELP = `
  Usage: rax deploy init [options]

  Scaffold Docker deployment files for a reactive agent.

  Options:
    --topology <type>   Deployment topology: single (default)
    --name <name>       Agent name (default: directory name)
    --help, -h          Show this help

  Examples:
    rax deploy init                          # single topology, auto-detect name
    rax deploy init --topology single        # explicit single
    rax deploy init --name my-agent          # custom agent name
`.trimEnd();

export function runDeploy(argv: string[]) {
  const subcommand = argv[0];

  if (subcommand === "init") {
    runDeployInit(argv.slice(1));
  } else if (subcommand === "--help" || subcommand === "-h" || !subcommand) {
    console.log(HELP);
  } else {
    console.error(`Unknown deploy subcommand: ${subcommand}`);
    console.log(HELP);
    process.exit(1);
  }
}

function runDeployInit(argv: string[]) {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(HELP);
    return;
  }

  let topology = "single";
  let name = "";

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--topology":
        topology = argv[++i];
        break;
      case "--name":
        name = argv[++i];
        break;
    }
  }

  // Auto-detect name from package.json or directory
  if (!name) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(process.cwd(), "package.json"), "utf-8"),
      );
      name = pkg.name?.replace(/^@[^/]+\//, "") ?? "agent";
    } catch {
      name = process.cwd().split("/").pop() ?? "agent";
    }
  }

  if (topology !== "single") {
    console.error(
      `Topology "${topology}" is not yet supported. Available: single`,
    );
    console.log(
      "Centralized and decentralized topologies coming in Phase 2+3.",
    );
    process.exit(1);
  }

  const cwd = process.cwd();

  const files: Array<{ path: string; content: string }> = [
    { path: "Dockerfile", content: dockerfileTemplate(name) },
    { path: "docker-compose.yml", content: composeSingleTemplate(name) },
    { path: "raxd.config.ts", content: raxdConfigTemplate() },
    {
      path: ".dockerignore",
      content:
        [
          "node_modules",
          "dist",
          ".git",
          ".env",
          ".env.production",
          "*.md",
          "tests",
          ".claude",
          ".vscode",
          "drafts",
        ].join("\n") + "\n",
    },
    {
      path: ".env.production.example",
      content: [
        "# raxd production environment",
        "# Copy to .env.production and fill in values",
        "",
        "# LLM Provider (required)",
        "ANTHROPIC_API_KEY=sk-ant-...",
        "",
        "# Web search (required for web-search tool)",
        "TAVILY_API_KEY=tvly-...",
        "",
        "# Health endpoint port (default: 3000)",
        "# HEALTH_PORT=3000",
        "",
        "# Production database (uncomment postgres in docker-compose.yml)",
        "# DATABASE_URL=postgres://raxd:password@postgres:5432/raxd",
        "# POSTGRES_PASSWORD=change-me-in-production",
        "",
        "# OpenTelemetry (optional)",
        "# OTEL_ENDPOINT=http://otel-collector:4318",
        "",
      ].join("\n"),
    },
  ];

  let created = 0;
  let skipped = 0;

  for (const file of files) {
    const fullPath = join(cwd, file.path);
    if (existsSync(fullPath)) {
      console.log(`  skip ${file.path} (already exists)`);
      skipped++;
    } else {
      writeFileSync(fullPath, file.content, "utf-8");
      console.log(`  create ${file.path}`);
      created++;
    }
  }

  console.log(`
rax deploy init complete (${created} created, ${skipped} skipped)

Next steps:
  1. cp .env.production.example .env.production
  2. Edit .env.production with your API keys
  3. docker compose up -d
  4. curl http://localhost:3000/health
`);
}
