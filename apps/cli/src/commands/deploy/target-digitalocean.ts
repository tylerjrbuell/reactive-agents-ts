// apps/cli/src/commands/deploy/target-digitalocean.ts
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { doAppSpecTemplate, doGpuComposeTemplate } from "../../templates/digitalocean.js";
import type { DeployProvider, DeployContext, PreflightCheck, PreflightReport } from "./types.js";
import { scaffoldDocker } from "./scaffold.js";
import { hasCommand, execLive, exec } from "./exec.js";

/** Check if doctl is authenticated */
function isAuthenticated(): boolean {
  try {
    const out = exec("doctl account get --format Email --no-header 2>/dev/null");
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

export const digitaloceanProvider: DeployProvider = {
  name: "digitalocean",
  configFiles: [".do/app.yaml"],
  cliNames: ["doctl"],
  installHint: "https://docs.digitalocean.com/reference/doctl/how-to/install/",

  preflight(ctx) {
    const { cwd, opts, agentName } = ctx;
    const checks: PreflightCheck[] = [];
    const plan: string[] = [];
    const filesToCreate: string[] = [];

    // CLI check
    const hasCli = hasCommand("doctl");
    checks.push({
      label: "doctl CLI installed",
      status: hasCli ? "pass" : "fail",
      detail: hasCli ? undefined : `Install: ${this.installHint}`,
    });

    // Auth check
    if (hasCli) {
      const authed = isAuthenticated();
      checks.push({
        label: "doctl authenticated",
        status: authed ? "pass" : "fail",
        detail: authed ? undefined : "Run: doctl auth init",
      });
    }

    // Config files
    const hasDockerfile = existsSync(join(cwd, "Dockerfile"));
    const hasAppSpec = existsSync(join(cwd, ".do", "app.yaml"));
    checks.push({
      label: "Dockerfile exists",
      status: hasDockerfile ? "pass" : "warn",
      detail: hasDockerfile ? undefined : "Will be scaffolded",
    });
    checks.push({
      label: ".do/app.yaml exists",
      status: hasAppSpec ? "pass" : "warn",
      detail: hasAppSpec ? undefined : "Will be scaffolded",
    });

    if (!hasDockerfile) filesToCreate.push("Dockerfile");
    if (!hasAppSpec) filesToCreate.push(".do/app.yaml");

    if (opts.gpu) {
      const hasGpuCompose = existsSync(join(cwd, "docker-compose.gpu.yml"));
      checks.push({
        label: "docker-compose.gpu.yml exists",
        status: hasGpuCompose ? "pass" : "warn",
        detail: hasGpuCompose ? undefined : "Will be scaffolded (GPU Droplet + Ollama)",
      });
      if (!hasGpuCompose) filesToCreate.push("docker-compose.gpu.yml");
    }

    // Build plan
    if (!hasDockerfile) plan.push("scaffold Dockerfile");
    if (!hasAppSpec) plan.push("scaffold .do/app.yaml");
    if (opts.gpu && !existsSync(join(cwd, "docker-compose.gpu.yml"))) {
      plan.push("scaffold docker-compose.gpu.yml");
    }
    plan.push(`doctl apps create --spec .do/app.yaml`);

    return {
      provider: "digitalocean",
      checks,
      plan,
      filesToCreate,
      ok: checks.every((c) => c.status !== "fail"),
    };
  },

  scaffold(ctx) {
    const { cwd, agentName, opts } = ctx;

    // Dockerfile
    if (!existsSync(join(cwd, "Dockerfile"))) {
      scaffoldDocker(cwd, agentName, "digitalocean");
    }

    // App spec
    const doDir = join(cwd, ".do");
    const appSpecPath = join(doDir, "app.yaml");

    if (!existsSync(appSpecPath)) {
      mkdirSync(doDir, { recursive: true });
      writeFileSync(appSpecPath, doAppSpecTemplate(agentName), "utf-8");
      console.log("  create .do/app.yaml");
    } else {
      console.log("  skip .do/app.yaml (already exists)");
    }

    // GPU compose file (optional)
    if (opts.gpu) {
      const gpuComposePath = join(cwd, "docker-compose.gpu.yml");
      if (!existsSync(gpuComposePath)) {
        writeFileSync(gpuComposePath, doGpuComposeTemplate(agentName), "utf-8");
        console.log("  create docker-compose.gpu.yml (GPU Droplet + Ollama)");
      } else {
        console.log("  skip docker-compose.gpu.yml (already exists)");
      }
    }
  },

  up(ctx) {
    const { cwd, opts, agentName } = ctx;

    this.scaffold(ctx);

    if (opts.gpu) {
      printGpuInstructions(agentName);
    }

    if (opts.scaffoldOnly) {
      console.log("\n  ✅ DigitalOcean files scaffolded. Next steps:");
      console.log("     1. doctl auth init");
      console.log("     2. doctl apps create --spec .do/app.yaml");
      console.log("     3. Set secrets in the DigitalOcean dashboard\n");
      return;
    }

    if (!hasCommand("doctl")) {
      console.error("  ❌ doctl CLI not found. Install it:");
      console.error(`     ${this.installHint}\n`);
      console.error("  Or scaffold files only:");
      console.error("     rax deploy up --target digitalocean --scaffold-only");
      process.exit(1);
    }

    console.log("\n  🚀 Deploying to DigitalOcean App Platform...\n");

    const appSpecPath = join(cwd, ".do", "app.yaml");
    const createCode = execLive(
      `doctl apps create --spec ${appSpecPath} --format ID --no-header`,
      cwd,
    );

    if (createCode === 0) {
      console.log("\n  ✅ App created on DigitalOcean App Platform!");
      console.log("\n  ⚠️  Set your secrets in the DigitalOcean dashboard:");
      console.log("     ANTHROPIC_API_KEY, TAVILY_API_KEY\n");
      console.log("  Useful commands:");
      console.log("     doctl apps list");
      console.log("     doctl apps logs <app-id>");
      console.log("     doctl apps update <app-id> --spec .do/app.yaml");
      console.log("     doctl apps delete <app-id>\n");
    } else {
      console.error("\n  ❌ DigitalOcean deployment failed. Check the output above.");
      console.error("  Make sure you're authenticated: doctl auth init\n");
      process.exit(1);
    }
  },

  down(ctx) {
    if (!hasCommand("doctl")) {
      console.error(`  ❌ doctl CLI not found. Install: ${this.installHint}`);
      process.exit(1);
    }

    console.log("\n🛑 Tearing down DigitalOcean app...\n");
    console.log("  List your apps to find the app ID:");
    console.log("     doctl apps list\n");
    console.log("  Then delete:");
    console.log("     doctl apps delete <app-id>\n");

    // List apps for convenience
    execLive("doctl apps list --format ID,DefaultIngress,ActiveDeployment.Phase --no-header", ctx.cwd);
  },

  status(ctx) {
    if (!hasCommand("doctl")) {
      console.error(`  ❌ doctl CLI not found. Install: ${this.installHint}`);
      process.exit(1);
    }

    console.log("\n📊 DigitalOcean App Status\n");
    execLive("doctl apps list --format ID,Spec.Name,DefaultIngress,ActiveDeployment.Phase", ctx.cwd);
  },

  logs(ctx) {
    if (!hasCommand("doctl")) {
      console.error(`  ❌ doctl CLI not found. Install: ${this.installHint}`);
      process.exit(1);
    }

    console.log("\n  To view logs, you need the app ID:");
    console.log("     doctl apps list");
    console.log("     doctl apps logs <app-id>\n");
    execLive("doctl apps list --format ID,Spec.Name --no-header", ctx.cwd);
  },
};

/** Print GPU Droplet setup instructions */
function printGpuInstructions(agentName: string) {
  console.log("\n  🖥️  GPU Droplet Deployment (for local models)\n");
  console.log("  DigitalOcean GPU Droplets support NVIDIA H100, A100, and L40S GPUs.");
  console.log("  Combined with Ollama, your agent runs fully local — no API keys needed.\n");
  console.log("  Setup:");
  console.log("    1. Create a GPU Droplet: https://cloud.digitalocean.com/droplets/new");
  console.log("    2. SSH in: ssh root@<droplet-ip>");
  console.log("    3. Clone your repo and cd into it");
  console.log("    4. docker compose -f docker-compose.gpu.yml up -d");
  console.log("    5. Wait for model pull (~5min for qwen3:14b)\n");
  console.log("  The agent will connect to Ollama at http://ollama:11434");
  console.log(`  Edit docker-compose.gpu.yml to change the model (default: qwen3:14b)\n`);
}
