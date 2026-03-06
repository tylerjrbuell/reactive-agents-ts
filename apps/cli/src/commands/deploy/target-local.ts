// apps/cli/src/commands/deploy/target-local.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DeployProvider, DeployContext, PreflightReport, PreflightCheck } from "./types.js";
import { scaffoldDocker, checkEnvFile } from "./scaffold.js";
import { hasCommand, isDockerRunning, execLive, waitForHealth } from "./exec.js";
import { DEPLOY_DEFAULTS } from "./manifest.js";

/** Read HEALTH_PORT from .env.production or default */
function readHealthPort(cwd: string): number {
  try {
    const envContent = readFileSync(join(cwd, ".env.production"), "utf-8");
    const match = envContent.match(/^HEALTH_PORT=(\d+)/m);
    if (match) return parseInt(match[1]);
  } catch {
    // ignore
  }
  return DEPLOY_DEFAULTS.port;
}

export const localProvider: DeployProvider = {
  name: "local",
  configFiles: ["docker-compose.yml"],
  cliNames: ["docker"],
  installHint: "https://docs.docker.com/get-docker/",

  preflight(ctx) {
    const { cwd, opts } = ctx;
    const checks: PreflightCheck[] = [];
    const plan: string[] = [];
    const filesToCreate: string[] = [];

    // CLI check
    const hasDocker = hasCommand("docker");
    checks.push({
      label: "Docker CLI installed",
      status: hasDocker ? "pass" : "fail",
      detail: hasDocker ? undefined : `Install: ${this.installHint}`,
    });

    // Daemon check
    if (hasDocker) {
      const running = isDockerRunning();
      checks.push({
        label: "Docker daemon running",
        status: running ? "pass" : "fail",
        detail: running ? undefined : "Start Docker Desktop or dockerd",
      });
    }

    // Config files
    const hasDockerfile = existsSync(join(cwd, "Dockerfile"));
    const hasCompose = existsSync(join(cwd, "docker-compose.yml"));
    checks.push({
      label: "Dockerfile exists",
      status: hasDockerfile ? "pass" : "warn",
      detail: hasDockerfile ? undefined : "Will be scaffolded",
    });
    checks.push({
      label: "docker-compose.yml exists",
      status: hasCompose ? "pass" : "warn",
      detail: hasCompose ? undefined : "Will be scaffolded",
    });

    if (!hasDockerfile) filesToCreate.push("Dockerfile");
    if (!hasCompose) filesToCreate.push("docker-compose.yml", "raxd.config.ts", ".env.production.example");

    // Env file
    const hasEnv = checkEnvFile(cwd);
    checks.push({
      label: ".env.production configured",
      status: hasEnv ? "pass" : (opts.scaffoldOnly ? "warn" : "fail"),
      detail: hasEnv ? undefined : "cp .env.production.example .env.production",
    });

    // SDK mode
    if (opts.mode === "sdk") {
      const hasServer = existsSync(join(cwd, "server.ts"));
      checks.push({
        label: "SDK server.ts exists",
        status: hasServer ? "pass" : "warn",
        detail: hasServer ? undefined : "Will be scaffolded",
      });
      if (!hasServer) filesToCreate.push("server.ts", "Dockerfile.sdk");
    }

    // Build plan
    if (!hasDockerfile || !hasCompose) plan.push("scaffold Docker files");
    if (opts.mode === "sdk" && !existsSync(join(cwd, "server.ts"))) plan.push("scaffold SDK server.ts");
    plan.push("docker compose build");
    plan.push("docker compose up -d");
    plan.push(`health check: http://localhost:${readHealthPort(cwd)}/health`);

    return {
      provider: "local",
      checks,
      plan,
      filesToCreate,
      ok: checks.every((c) => c.status !== "fail"),
    };
  },

  scaffold(ctx) {
    scaffoldDocker(ctx.cwd, ctx.agentName, "local");
  },

  async up(ctx) {
    const { cwd, opts, agentName } = ctx;

    // 1. Check Docker
    if (!hasCommand("docker")) {
      console.error("  ❌ Docker not found. Install Docker to deploy locally.");
      console.error(`     ${this.installHint}\n`);
      console.error("  Alternatively, deploy to a remote target:");
      console.error("     rax deploy up --target fly");
      console.error("     rax deploy up --target railway");
      process.exit(1);
    }

    if (!isDockerRunning()) {
      console.error("  ❌ Docker daemon is not running. Start Docker and try again.");
      process.exit(1);
    }

    console.log("  ✅ Docker available\n");

    // 2. Scaffold if missing
    const hasDockerfile = existsSync(join(cwd, "Dockerfile"));
    const hasCompose = existsSync(join(cwd, "docker-compose.yml"));

    if (!hasDockerfile || !hasCompose) {
      console.log("  Scaffolding deployment files...\n");
      this.scaffold(ctx);
    } else {
      console.log("  Deployment files already exist\n");
    }

    // 3. Check env
    const hasEnv = checkEnvFile(cwd);

    if (opts.scaffoldOnly) {
      console.log(`\n  ✅ Scaffold complete for target: local\n`);
      console.log("  Generated files:");
      console.log("    • Dockerfile");
      console.log("    • docker-compose.yml");
      console.log("    • raxd.config.ts");
      console.log("    • .env.production.example");
      if (!hasEnv) {
        console.log("\n  Next steps:");
        console.log("    1. cp .env.production.example .env.production");
        console.log("    2. Edit .env.production with your API keys");
        console.log("    3. rax deploy up\n");
      } else {
        console.log("\n  Ready to deploy:");
        console.log("    rax deploy up\n");
      }
      return;
    }

    if (!hasEnv) {
      console.error("  Cannot deploy without .env.production. Create it first:\n");
      console.error("    cp .env.production.example .env.production");
      console.error("    # Edit with your API keys\n");
      process.exit(1);
    }

    // 4. Build
    console.log("  🔨 Building Docker image...\n");
    const buildCode = execLive("docker compose build", cwd);
    if (buildCode !== 0) {
      console.error("\n  ❌ Docker build failed. Check the output above.");
      process.exit(1);
    }
    console.log("\n  ✅ Image built\n");

    // 5. Deploy
    console.log("  🚀 Starting container...\n");
    const upCode = execLive("docker compose up -d", cwd);
    if (upCode !== 0) {
      console.error("\n  ❌ Failed to start container.");
      process.exit(1);
    }

    // 6. Health check
    const healthPort = readHealthPort(cwd);
    const healthUrl = `http://localhost:${healthPort}/health`;
    console.log(`\n  ⏳ Waiting for health check (${healthUrl})...`);

    const healthy = await waitForHealth(healthUrl, 30_000, 2_000);
    if (healthy) {
      console.log("  ✅ Container is healthy\n");
    } else {
      console.log("  ⚠️  Health check timed out (container may still be starting)\n");
    }

    console.log("┌──────────────────────────────────────────────────┐");
    console.log("│  🟢 raxd agent deployed successfully             │");
    console.log("├──────────────────────────────────────────────────┤");
    console.log(`│  Agent:     ${agentName.padEnd(37)}│`);
    console.log(`│  Target:    local${" ".repeat(32)}│`);
    console.log(`│  Health:    ${healthUrl.padEnd(37)}│`);
    console.log("├──────────────────────────────────────────────────┤");
    console.log("│  Commands:                                       │");
    console.log("│    rax deploy status    — container status        │");
    console.log("│    rax deploy logs -f   — tail logs               │");
    console.log("│    rax deploy down      — stop containers         │");
    console.log("└──────────────────────────────────────────────────┘\n");
  },

  down(ctx) {
    const { cwd } = ctx;

    if (!existsSync(join(cwd, "docker-compose.yml"))) {
      console.error("  No docker-compose.yml found. Run 'rax deploy up' first.");
      process.exit(1);
    }

    if (!hasCommand("docker") || !isDockerRunning()) {
      console.error("  ❌ Docker is not available or not running.");
      process.exit(1);
    }

    console.log("\n🛑 Stopping containers...\n");
    const code = execLive("docker compose down", cwd);
    if (code === 0) {
      console.log("\n  ✅ Containers stopped and removed.\n");
    } else {
      console.error("\n  ❌ Failed to stop containers.");
      process.exit(1);
    }
  },

  async status(ctx) {
    const { cwd } = ctx;

    if (!existsSync(join(cwd, "docker-compose.yml"))) {
      console.error("  No docker-compose.yml found. Run 'rax deploy up' first.");
      process.exit(1);
    }

    if (!hasCommand("docker") || !isDockerRunning()) {
      console.error("  ❌ Docker is not available or not running.");
      process.exit(1);
    }

    console.log("\n📊 Container Status\n");
    execLive("docker compose ps", cwd);

    const healthPort = readHealthPort(cwd);
    const healthUrl = `http://localhost:${healthPort}/health`;
    console.log(`\n  Health endpoint: ${healthUrl}`);

    try {
      const res = await fetch(healthUrl);
      const data = await res.json();
      console.log(`  Status: ✅ ${JSON.stringify(data)}\n`);
    } catch {
      console.log("  Status: ❌ not responding\n");
    }
  },

  logs(ctx) {
    const { cwd, opts } = ctx;

    if (!existsSync(join(cwd, "docker-compose.yml"))) {
      console.error("  No docker-compose.yml found. Run 'rax deploy up' first.");
      process.exit(1);
    }

    if (!hasCommand("docker") || !isDockerRunning()) {
      console.error("  ❌ Docker is not available or not running.");
      process.exit(1);
    }

    const cmd = opts.follow ? "docker compose logs -f" : "docker compose logs --tail=100";
    execLive(cmd, cwd);
  },
};
