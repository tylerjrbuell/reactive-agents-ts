// apps/cli/src/commands/deploy/scaffold.ts
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { dockerfileTemplate, dockerfileMonorepoTemplate } from "../../templates/dockerfile.js";
import { composeSingleTemplate, composeMonorepoTemplate } from "../../templates/compose.js";
import { sdkServerTemplate, sdkDockerfileTemplate, sdkDockerfileMonorepoTemplate } from "../../templates/sdk-server.js";
import { raxdConfigTemplate } from "../../templates/raxd-config.js";
import type { DeployTarget, ScaffoldResult } from "./types.js";

/** Walk up from cwd looking for a workspace root (package.json with "workspaces") */
export function detectMonorepoRoot(from: string): string | null {
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

/** Auto-detect agent name from package.json or directory name */
export function detectAgentName(cwd: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf-8"));
    return pkg.name?.replace(/^@[^/]+\//, "") ?? "agent";
  } catch {
    return cwd.split("/").pop() ?? "agent";
  }
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

const MONOREPO_DOCKERIGNORE = [
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
].join("\n") + "\n";

const SINGLE_DOCKERIGNORE = [
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
].join("\n") + "\n";

/** Scaffold Docker deployment files. Returns what was created/skipped. */
export function scaffoldDocker(
  cwd: string,
  name: string,
  _target: DeployTarget,
): ScaffoldResult {
  const monorepoRoot = detectMonorepoRoot(cwd);
  const isMonorepo = monorepoRoot !== null;

  let files: Array<{ path: string; content: string }>;
  let appPath: string | null = null;

  if (isMonorepo) {
    appPath = relative(monorepoRoot, cwd).replace(/\\/g, "/");
    const contextPath = relative(cwd, monorepoRoot).replace(/\\/g, "/");

    console.log(`  monorepo detected (root: ${monorepoRoot})`);
    console.log(`  app path: ${appPath}`);

    files = [
      { path: "Dockerfile", content: dockerfileMonorepoTemplate(name, appPath) },
      { path: "docker-compose.yml", content: composeMonorepoTemplate(name, appPath, contextPath) },
      { path: "raxd.config.ts", content: raxdConfigTemplate() },
      { path: ".env.production.example", content: envProductionTemplate() },
    ];

    // .dockerignore must live at the build context root (workspace root)
    const rootDockerIgnore = join(monorepoRoot, ".dockerignore");
    if (!existsSync(rootDockerIgnore)) {
      writeFileSync(rootDockerIgnore, MONOREPO_DOCKERIGNORE, "utf-8");
      console.log(`  create ${contextPath}/.dockerignore (build context root)`);
    } else {
      console.log(`  skip ${contextPath}/.dockerignore (already exists)`);
    }
  } else {
    files = [
      { path: "Dockerfile", content: dockerfileTemplate(name) },
      { path: "docker-compose.yml", content: composeSingleTemplate(name) },
      { path: "raxd.config.ts", content: raxdConfigTemplate() },
      { path: ".dockerignore", content: SINGLE_DOCKERIGNORE },
      { path: ".env.production.example", content: envProductionTemplate() },
    ];
  }

  let created = 0;
  let skipped = 0;
  const createdFiles: string[] = [];

  for (const file of files) {
    const fullPath = join(cwd, file.path);
    if (existsSync(fullPath)) {
      console.log(`  skip ${file.path} (already exists)`);
      skipped++;
    } else {
      writeFileSync(fullPath, file.content, "utf-8");
      console.log(`  create ${file.path}`);
      created++;
      createdFiles.push(file.path);
    }
  }

  return {
    created,
    skipped,
    files: createdFiles,
    monorepo: isMonorepo,
    monorepoRoot,
    appPath,
  };
}

/** Check if .env.production exists, warn if not */
export function checkEnvFile(cwd: string): boolean {
  const envPath = join(cwd, ".env.production");
  if (existsSync(envPath)) return true;

  console.log("\n  ⚠️  No .env.production found.");
  console.log("  Copy .env.production.example → .env.production and add your API keys.\n");
  return false;
}

/** Scaffold SDK server mode — generates server.ts + SDK Dockerfile */
export function scaffoldSdkServer(
  cwd: string,
  name: string,
): ScaffoldResult {
  const monorepoRoot = detectMonorepoRoot(cwd);
  const isMonorepo = monorepoRoot !== null;
  let appPath: string | null = null;

  const files: Array<{ path: string; content: string }> = [
    { path: "server.ts", content: sdkServerTemplate(name) },
  ];

  if (isMonorepo) {
    appPath = relative(monorepoRoot, cwd).replace(/\\/g, "/");
    files.push({
      path: "Dockerfile.sdk",
      content: sdkDockerfileMonorepoTemplate(name, appPath),
    });
  } else {
    files.push({
      path: "Dockerfile.sdk",
      content: sdkDockerfileTemplate(name),
    });
  }

  // Also create .env.production.example if missing
  const envExamplePath = join(cwd, ".env.production.example");
  if (!existsSync(envExamplePath)) {
    files.push({
      path: ".env.production.example",
      content: envProductionTemplate(),
    });
  }

  let created = 0;
  let skipped = 0;
  const createdFiles: string[] = [];

  for (const file of files) {
    const fullPath = join(cwd, file.path);
    if (existsSync(fullPath)) {
      console.log(`  skip ${file.path} (already exists)`);
      skipped++;
    } else {
      writeFileSync(fullPath, file.content, "utf-8");
      console.log(`  create ${file.path}`);
      created++;
      createdFiles.push(file.path);
    }
  }

  return {
    created,
    skipped,
    files: createdFiles,
    monorepo: isMonorepo,
    monorepoRoot,
    appPath,
  };
}
