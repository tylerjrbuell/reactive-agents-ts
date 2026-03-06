// apps/cli/src/commands/deploy/target-render.ts
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderYamlTemplate, renderYamlSdkTemplate } from "../../templates/render.js";
import type { DeployProvider, DeployContext, PreflightCheck, PreflightReport } from "./types.js";
import { scaffoldDocker } from "./scaffold.js";
import { hasCommand, execLive, exec } from "./exec.js";

export const renderProvider: DeployProvider = {
  name: "render",
  configFiles: ["render.yaml"],
  cliNames: ["render"],
  installHint: "https://render.com/docs/cli",

  preflight(ctx) {
    const { cwd, opts } = ctx;
    const checks: PreflightCheck[] = [];
    const plan: string[] = [];
    const filesToCreate: string[] = [];

    // CLI check (optional — Render primarily deploys via Git push or dashboard)
    const hasCli = hasCommand("render");
    checks.push({
      label: "Render CLI installed",
      status: hasCli ? "pass" : "warn",
      detail: hasCli ? undefined : "Optional — deploy via Git push or dashboard instead",
    });

    // Git check (primary deploy mechanism)
    const hasGit = hasCommand("git");
    checks.push({
      label: "Git available",
      status: hasGit ? "pass" : "warn",
      detail: hasGit ? undefined : "Render deploys via Git push",
    });

    // Config files
    const hasDockerfile = existsSync(join(cwd, "Dockerfile"));
    const hasRenderYaml = existsSync(join(cwd, "render.yaml"));
    checks.push({
      label: "Dockerfile exists",
      status: hasDockerfile ? "pass" : "warn",
      detail: hasDockerfile ? undefined : "Will be scaffolded",
    });
    checks.push({
      label: "render.yaml exists",
      status: hasRenderYaml ? "pass" : "warn",
      detail: hasRenderYaml ? undefined : "Will be scaffolded",
    });

    if (!hasDockerfile) filesToCreate.push("Dockerfile");
    if (!hasRenderYaml) filesToCreate.push("render.yaml");

    // Build plan
    if (!hasDockerfile) plan.push("scaffold Dockerfile");
    if (!hasRenderYaml) plan.push(`scaffold render.yaml (mode: ${opts.mode})`);
    if (hasCli) {
      plan.push("render blueprint launch");
    } else {
      plan.push("git push (or connect via Render dashboard)");
    }

    return {
      provider: "render",
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
      scaffoldDocker(cwd, agentName, "render");
    }

    // render.yaml
    const renderPath = join(cwd, "render.yaml");
    if (existsSync(renderPath)) {
      console.log("  skip render.yaml (already exists)");
      return;
    }

    const template = opts.mode === "sdk"
      ? renderYamlSdkTemplate(agentName)
      : renderYamlTemplate(agentName);

    writeFileSync(renderPath, template, "utf-8");
    console.log("  create render.yaml");
  },

  up(ctx) {
    const { cwd, opts, agentName } = ctx;

    this.scaffold(ctx);

    if (opts.scaffoldOnly) {
      console.log("\n  ✅ Render files scaffolded. Next steps:");
      console.log("     1. Connect your Git repo at https://dashboard.render.com/new/blueprint");
      console.log("     2. Render will auto-detect render.yaml");
      console.log("     3. Set secrets: ANTHROPIC_API_KEY, TAVILY_API_KEY\n");
      return;
    }

    console.log("\n  🚀 Deploying to Render...\n");

    // Try Render CLI first if available
    if (hasCommand("render")) {
      console.log("  Using Render CLI...\n");
      const code = execLive("render blueprint launch", cwd);
      if (code === 0) {
        console.log("\n  ✅ Deployed to Render!");
        console.log("\n  ⚠️  Set your environment secrets in the Render dashboard:");
        console.log("     ANTHROPIC_API_KEY, TAVILY_API_KEY\n");
        return;
      }
      console.log("\n  ⚠️  Render CLI deploy failed, showing manual steps...\n");
    }

    // Fallback to instructions
    console.log("  Render deploys via Git push or dashboard. Options:\n");
    console.log("  Option 1 — Dashboard (recommended):");
    console.log("    1. Go to https://dashboard.render.com/new/blueprint");
    console.log("    2. Connect your Git repo");
    console.log("    3. Render will auto-detect render.yaml\n");
    console.log("  Option 2 — Render CLI:");
    console.log("    render blueprint launch\n");
    console.log("  Option 3 — Git push (if repo is connected):");
    console.log("    git push render main\n");

    console.log("  ⚠️  Set your environment secrets in the Render dashboard:");
    console.log("     ANTHROPIC_API_KEY, TAVILY_API_KEY\n");
    console.log("  ✅ render.yaml is ready. Push to deploy.\n");
  },

  down(ctx) {
    const { cwd } = ctx;

    if (hasCommand("render")) {
      console.log("\n🛑 Tearing down Render service...\n");
      // Render CLI doesn't have a direct "down" — guide user
      console.log("  Use the Render dashboard to delete the service:");
      console.log("    https://dashboard.render.com\n");
      console.log("  Or via CLI:");
      console.log("    render services list");
      console.log("    render services delete <service-id>\n");
    } else {
      console.log("\n  Delete your service at: https://dashboard.render.com\n");
    }
  },

  status(ctx) {
    const { cwd } = ctx;

    if (hasCommand("render")) {
      console.log("\n📊 Render Service Status\n");
      execLive("render services list", cwd);
    } else {
      console.log("\n  View status at: https://dashboard.render.com\n");
      console.log("  Or install the Render CLI for local status checks.");
    }
  },

  logs(ctx) {
    const { cwd } = ctx;

    if (hasCommand("render")) {
      execLive("render logs", cwd);
    } else {
      console.log("\n  View logs at: https://dashboard.render.com\n");
      console.log("  Or install the Render CLI: render logs");
    }
  },
};
