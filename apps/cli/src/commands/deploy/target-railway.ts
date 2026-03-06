// apps/cli/src/commands/deploy/target-railway.ts
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { railwayJsonTemplate } from "../../templates/railway.js";
import type { DeployProvider, DeployContext, PreflightCheck, PreflightReport } from "./types.js";
import { scaffoldDocker } from "./scaffold.js";
import { hasCommand, execLive, exec } from "./exec.js";

/** Check if railway CLI is authenticated */
function isAuthenticated(): boolean {
  try {
    const out = exec("railway whoami 2>/dev/null");
    return out.length > 0;
  } catch {
    return false;
  }
}

/** Check if a Railway project is linked in cwd */
function isProjectLinked(cwd: string): boolean {
  try {
    const code = execLive("railway status 2>/dev/null", cwd);
    return code === 0;
  } catch {
    return false;
  }
}

export const railwayProvider: DeployProvider = {
  name: "railway",
  configFiles: ["railway.json", "railway.toml"],
  cliNames: ["railway"],
  installHint: "npm install -g @railway/cli",

  preflight(ctx) {
    const { cwd, opts } = ctx;
    const checks: PreflightCheck[] = [];
    const plan: string[] = [];
    const filesToCreate: string[] = [];

    // CLI check
    const hasCli = hasCommand("railway");
    checks.push({
      label: "Railway CLI installed",
      status: hasCli ? "pass" : "fail",
      detail: hasCli ? undefined : `Install: ${this.installHint}`,
    });

    // Auth check
    if (hasCli) {
      const authed = isAuthenticated();
      checks.push({
        label: "Railway authenticated",
        status: authed ? "pass" : "fail",
        detail: authed ? undefined : "Run: railway login",
      });
    }

    // Config files
    const hasDockerfile = existsSync(join(cwd, "Dockerfile"));
    const hasRailwayJson = existsSync(join(cwd, "railway.json"));
    checks.push({
      label: "Dockerfile exists",
      status: hasDockerfile ? "pass" : "warn",
      detail: hasDockerfile ? undefined : "Will be scaffolded",
    });
    checks.push({
      label: "railway.json exists",
      status: hasRailwayJson ? "pass" : "warn",
      detail: hasRailwayJson ? undefined : "Will be scaffolded",
    });

    if (!hasDockerfile) filesToCreate.push("Dockerfile");
    if (!hasRailwayJson) filesToCreate.push("railway.json");

    // Build plan
    if (!hasDockerfile) plan.push("scaffold Dockerfile");
    if (!hasRailwayJson) plan.push("scaffold railway.json");
    plan.push("railway status (check project link)");
    plan.push("railway link (if not linked)");
    plan.push("railway up");

    return {
      provider: "railway",
      checks,
      plan,
      filesToCreate,
      ok: checks.every((c) => c.status !== "fail"),
    };
  },

  scaffold(ctx) {
    const { cwd, agentName } = ctx;

    // Dockerfile
    if (!existsSync(join(cwd, "Dockerfile"))) {
      scaffoldDocker(cwd, agentName, "railway");
    }

    // railway.json
    const railwayPath = join(cwd, "railway.json");
    if (existsSync(railwayPath)) {
      console.log("  skip railway.json (already exists)");
      return;
    }

    writeFileSync(railwayPath, railwayJsonTemplate(agentName), "utf-8");
    console.log("  create railway.json");
  },

  up(ctx) {
    const { cwd, opts, agentName } = ctx;

    this.scaffold(ctx);

    if (opts.scaffoldOnly) {
      console.log("\n  ✅ Railway files scaffolded. Next steps:");
      console.log("     1. railway login");
      console.log("     2. railway link (or create a new project)");
      console.log("     3. railway variables set ANTHROPIC_API_KEY=sk-ant-...");
      console.log("     4. railway up\n");
      return;
    }

    if (!hasCommand("railway")) {
      console.error("  ❌ Railway CLI not found. Install it:");
      console.error(`     ${this.installHint}\n`);
      console.error("  Or scaffold files only:");
      console.error("     rax deploy up --target railway --scaffold-only");
      process.exit(1);
    }

    // Check if project is linked
    console.log("\n  🔍 Checking Railway project status...\n");
    const statusCode = execLive("railway status 2>/dev/null", cwd);

    if (statusCode !== 0) {
      console.log("\n  📦 Linking Railway project...\n");
      const linkCode = execLive("railway link", cwd);
      if (linkCode !== 0) {
        console.error("\n  ❌ Failed to link Railway project.");
        console.error("  Make sure you're logged in: railway login\n");
        process.exit(1);
      }
    }

    console.log("\n  ⚠️  Set your environment variables:");
    console.log("     railway variables set ANTHROPIC_API_KEY=sk-ant-...");
    console.log("     railway variables set TAVILY_API_KEY=tvly-...\n");

    console.log("  🚀 Deploying to Railway...\n");
    const deployCode = execLive("railway up", cwd);

    if (deployCode === 0) {
      console.log("\n  ✅ Deployed to Railway!");
      console.log("\n  Useful commands:");
      console.log("     railway status     — deployment status");
      console.log("     railway logs       — tail logs");
      console.log("     railway open       — open in browser");
      console.log("     railway down       — tear down\n");
    } else {
      console.error("\n  ❌ Railway deployment failed. Check the output above.");
      process.exit(1);
    }
  },

  down(ctx) {
    const { cwd } = ctx;

    if (!hasCommand("railway")) {
      console.error(`  ❌ Railway CLI not found. Install: ${this.installHint}`);
      process.exit(1);
    }

    console.log("\n🛑 Tearing down Railway deployment...\n");
    const code = execLive("railway down --yes", cwd);
    if (code === 0) {
      console.log("\n  ✅ Railway deployment torn down.\n");
    } else {
      console.error("\n  ❌ Failed to tear down. Run manually:");
      console.error("     railway down\n");
    }
  },

  status(ctx) {
    const { cwd } = ctx;

    if (!hasCommand("railway")) {
      console.error(`  ❌ Railway CLI not found. Install: ${this.installHint}`);
      process.exit(1);
    }

    console.log("\n📊 Railway Deployment Status\n");
    execLive("railway status", cwd);
  },

  logs(ctx) {
    const { cwd } = ctx;

    if (!hasCommand("railway")) {
      console.error(`  ❌ Railway CLI not found. Install: ${this.installHint}`);
      process.exit(1);
    }

    execLive("railway logs", cwd);
  },
};
