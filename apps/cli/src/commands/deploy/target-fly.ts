// apps/cli/src/commands/deploy/target-fly.ts
import { existsSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { flyTomlTemplate } from "../../templates/fly-toml.js";
import type { DeployProvider, DeployContext, PreflightCheck, PreflightReport } from "./types.js";
import { scaffoldDocker } from "./scaffold.js";
import { hasCommand, execLive, exec } from "./exec.js";
import { DEPLOY_DEFAULTS } from "./manifest.js";

/** Resolve the flyctl binary name (flyctl or fly) */
function flyCmd(): string {
  if (hasCommand("flyctl")) return "flyctl";
  if (hasCommand("fly")) return "fly";
  return "flyctl";
}

/** Check if flyctl is authenticated */
function isAuthenticated(): boolean {
  try {
    const out = exec(`${flyCmd()} auth whoami 2>/dev/null`);
    return out.length > 0;
  } catch {
    return false;
  }
}

export const flyProvider: DeployProvider = {
  name: "fly",
  configFiles: ["fly.toml"],
  cliNames: ["flyctl", "fly"],
  installHint: "curl -L https://fly.io/install.sh | sh",

  preflight(ctx) {
    const { cwd, opts } = ctx;
    const checks: PreflightCheck[] = [];
    const plan: string[] = [];
    const filesToCreate: string[] = [];

    // CLI check
    const hasCli = hasCommand("flyctl") || hasCommand("fly");
    checks.push({
      label: "flyctl CLI installed",
      status: hasCli ? "pass" : "fail",
      detail: hasCli ? `Binary: ${flyCmd()}` : `Install: ${this.installHint}`,
    });

    // Auth check
    if (hasCli) {
      const authed = isAuthenticated();
      checks.push({
        label: "flyctl authenticated",
        status: authed ? "pass" : "fail",
        detail: authed ? undefined : `Run: ${flyCmd()} auth login`,
      });
    }

    // Config files
    const hasDockerfile = existsSync(join(cwd, "Dockerfile"));
    const hasFlyToml = existsSync(join(cwd, "fly.toml"));
    checks.push({
      label: "Dockerfile exists",
      status: hasDockerfile ? "pass" : "warn",
      detail: hasDockerfile ? undefined : "Will be scaffolded",
    });
    checks.push({
      label: "fly.toml exists",
      status: hasFlyToml ? "pass" : "warn",
      detail: hasFlyToml ? undefined : "Will be scaffolded",
    });

    if (!hasDockerfile) filesToCreate.push("Dockerfile");
    if (!hasFlyToml) filesToCreate.push("fly.toml");

    // Build plan
    if (!hasDockerfile) plan.push("scaffold Dockerfile");
    if (!hasFlyToml) plan.push("scaffold fly.toml");
    plan.push(`${flyCmd()} status (check existing app)`);
    plan.push(`${flyCmd()} launch --copy-config --name raxd-${ctx.agentName} --no-deploy (if new)`);
    plan.push(`${flyCmd()} deploy`);

    return {
      provider: "fly",
      checks,
      plan,
      filesToCreate,
      ok: checks.every((c) => c.status !== "fail"),
    };
  },

  scaffold(ctx) {
    const { cwd, agentName, monorepoRoot } = ctx;

    // Dockerfile
    if (!existsSync(join(cwd, "Dockerfile"))) {
      scaffoldDocker(cwd, agentName, "fly");
    }

    // fly.toml
    const flyTomlPath = join(cwd, "fly.toml");
    if (existsSync(flyTomlPath)) {
      console.log("  skip fly.toml (already exists)");
      return;
    }

    const isMonorepo = monorepoRoot !== null;
    const appPath = isMonorepo
      ? relative(monorepoRoot, cwd).replace(/\\/g, "/")
      : undefined;

    writeFileSync(flyTomlPath, flyTomlTemplate(agentName, isMonorepo, appPath), "utf-8");
    console.log("  create fly.toml");
  },

  up(ctx) {
    const { cwd, opts, agentName } = ctx;
    const cmd = flyCmd();

    this.scaffold(ctx);

    if (opts.scaffoldOnly) {
      console.log("\n  ✅ Fly.io files scaffolded. Next steps:");
      console.log(`     1. Review fly.toml and adjust region/VM size`);
      console.log(`     2. ${cmd} auth login`);
      console.log(`     3. ${cmd} launch --copy-config`);
      console.log(`     4. ${cmd} secrets set ANTHROPIC_API_KEY=sk-ant-...`);
      console.log(`     5. ${cmd} deploy\n`);
      return;
    }

    if (!hasCommand("flyctl") && !hasCommand("fly")) {
      console.error(`  ❌ flyctl not found. Install the Fly.io CLI:`);
      console.error(`     ${this.installHint}\n`);
      console.error("  Or scaffold files only:");
      console.error("     rax deploy up --target fly --scaffold-only");
      process.exit(1);
    }

    // Check if app already exists (launched)
    console.log("\n  🔍 Checking Fly.io app status...\n");
    const statusCode = execLive(`${cmd} status 2>/dev/null`, cwd);

    if (statusCode !== 0) {
      console.log("\n  🚀 Launching new Fly.io app...\n");
      const launchCode = execLive(
        `${cmd} launch --copy-config --name raxd-${agentName} --no-deploy`,
        cwd,
      );
      if (launchCode !== 0) {
        console.error("\n  ❌ Failed to launch Fly.io app.");
        console.error(`  Make sure you're logged in: ${cmd} auth login\n`);
        process.exit(1);
      }

      console.log("\n  ⚠️  Set your secrets before deploying:");
      console.log(`     ${cmd} secrets set ANTHROPIC_API_KEY=sk-ant-...`);
      console.log(`     ${cmd} secrets set TAVILY_API_KEY=tvly-...\n`);
    }

    console.log("  🚀 Deploying to Fly.io...\n");
    const deployCode = execLive(`${cmd} deploy`, cwd);

    if (deployCode === 0) {
      console.log("\n  ✅ Deployed to Fly.io!");
      console.log(`\n  Useful commands:`);
      console.log(`     ${cmd} status        — app status`);
      console.log(`     ${cmd} logs          — tail logs`);
      console.log(`     ${cmd} ssh console   — SSH into container`);
      console.log(`     ${cmd} open /health  — open health endpoint`);
      console.log(`     ${cmd} destroy       — tear down app\n`);
    } else {
      console.error("\n  ❌ Fly.io deployment failed. Check the output above.");
      process.exit(1);
    }
  },

  down(ctx) {
    const { cwd } = ctx;
    const cmd = flyCmd();

    if (!hasCommand("flyctl") && !hasCommand("fly")) {
      console.error(`  ❌ flyctl not found. Install: ${this.installHint}`);
      process.exit(1);
    }

    console.log("\n🛑 Destroying Fly.io app...\n");
    console.log("  ⚠️  This will permanently delete the app and all its data.\n");
    const code = execLive(`${cmd} apps destroy --yes`, cwd);
    if (code === 0) {
      console.log("\n  ✅ Fly.io app destroyed.\n");
    } else {
      console.error("\n  ❌ Failed to destroy app. Run manually:");
      console.error(`     ${cmd} apps destroy\n`);
    }
  },

  status(ctx) {
    const { cwd } = ctx;
    const cmd = flyCmd();

    if (!hasCommand("flyctl") && !hasCommand("fly")) {
      console.error(`  ❌ flyctl not found. Install: ${this.installHint}`);
      process.exit(1);
    }

    console.log("\n📊 Fly.io App Status\n");
    execLive(`${cmd} status`, cwd);
  },

  logs(ctx) {
    const { cwd } = ctx;
    const cmd = flyCmd();

    if (!hasCommand("flyctl") && !hasCommand("fly")) {
      console.error(`  ❌ flyctl not found. Install: ${this.installHint}`);
      process.exit(1);
    }

    execLive(`${cmd} logs`, cwd);
  },
};
