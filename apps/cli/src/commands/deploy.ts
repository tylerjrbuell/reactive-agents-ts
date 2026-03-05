// apps/cli/src/commands/deploy.ts
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { dockerfileTemplate, dockerfileMonorepoTemplate } from "../templates/dockerfile.js";
import { composeSingleTemplate, composeMonorepoTemplate } from "../templates/compose.js";
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

  // Detect monorepo: walk up looking for a parent package.json with "workspaces"
  const monorepo = detectMonorepoRoot(cwd);
  const isMonorepo = monorepo !== null;

  let files: Array<{ path: string; content: string }>;

  if (isMonorepo) {
    const appPath = relative(monorepo, cwd).replace(/\\/g, "/");
    const contextPath = relative(cwd, monorepo).replace(/\\/g, "/");

    console.log(`  monorepo detected (root: ${monorepo})`);
    console.log(`  app path: ${appPath}`);

    files = [
      { path: "Dockerfile", content: dockerfileMonorepoTemplate(name, appPath) },
      { path: "docker-compose.yml", content: composeMonorepoTemplate(name, appPath, contextPath) },
      { path: "raxd.config.ts", content: raxdConfigTemplate() },
      {
        path: ".env.production.example",
        content: envProductionTemplate(),
      },
    ];

    // .dockerignore must live at the build context root (workspace root)
    const rootDockerIgnore = join(monorepo, ".dockerignore");
    if (!existsSync(rootDockerIgnore)) {
      writeFileSync(
        rootDockerIgnore,
        [
          "node_modules",
          "**/node_modules",
          "**/dist",
          ".git",
          "**/.env",
          "**/.env.production",
          "**/*.md",
          "**/tests",
          ".claude",
          ".vscode",
          "signal-data",
          "docker",
          "docs",
          "scripts",
          "assets",
          "apps/cli",
          "apps/docs",
          "apps/examples",
        ].join("\n") + "\n",
        "utf-8",
      );
      console.log(`  create ${contextPath}/.dockerignore (build context root)`);
    } else {
      console.log(`  skip ${contextPath}/.dockerignore (already exists)`);
    }
  } else {
    files = [
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
        content: envProductionTemplate(),
      },
    ];
  }

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

function envProductionTemplate(): string {
  return [
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
  ].join("\n");
}

/** Walk up from cwd looking for a workspace root (package.json with "workspaces") */
function detectMonorepoRoot(from: string): string | null {
  let dir = resolve(from);
  const root = resolve("/");

  // Start from parent — we want the workspace root, not the current package
  dir = resolve(dir, "..");

  while (dir !== root) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (Array.isArray(pkg.workspaces)) {
          return dir;
        }
      } catch {
        // ignore parse errors
      }
    }
    dir = resolve(dir, "..");
  }

  return null;
}
