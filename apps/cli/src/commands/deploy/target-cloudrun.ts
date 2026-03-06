// apps/cli/src/commands/deploy/target-cloudrun.ts
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cloudRunYamlTemplate } from "../../templates/cloudrun.js";
import type { DeployProvider, DeployContext, PreflightCheck, PreflightReport } from "./types.js";
import { scaffoldDocker } from "./scaffold.js";
import { hasCommand, execLive, exec } from "./exec.js";
import { DEPLOY_DEFAULTS } from "./manifest.js";

/** Try to detect GCP project ID from gcloud config */
function detectProjectId(): string {
  try {
    if (hasCommand("gcloud")) {
      return exec("gcloud config get-value project 2>/dev/null").trim() || "YOUR_PROJECT_ID";
    }
  } catch {
    // ignore
  }
  return "YOUR_PROJECT_ID";
}

function getRegion(): string {
  return process.env.GCP_REGION ?? DEPLOY_DEFAULTS.regions.cloudrun;
}

/** Check if gcloud is authenticated */
function isAuthenticated(): boolean {
  try {
    const out = exec("gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null");
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

export const cloudrunProvider: DeployProvider = {
  name: "cloudrun",
  configFiles: ["cloudbuild.yaml"],
  cliNames: ["gcloud"],
  installHint: "https://cloud.google.com/sdk/docs/install",

  preflight(ctx) {
    const { cwd, opts, agentName } = ctx;
    const checks: PreflightCheck[] = [];
    const plan: string[] = [];
    const filesToCreate: string[] = [];
    const region = getRegion();
    const projectId = detectProjectId();

    // CLI check
    const hasCli = hasCommand("gcloud");
    checks.push({
      label: "gcloud CLI installed",
      status: hasCli ? "pass" : "fail",
      detail: hasCli ? undefined : `Install: ${this.installHint}`,
    });

    // Auth check
    if (hasCli) {
      const authed = isAuthenticated();
      checks.push({
        label: "gcloud authenticated",
        status: authed ? "pass" : "fail",
        detail: authed ? undefined : "Run: gcloud auth login",
      });

      // Project check
      const hasProject = projectId !== "YOUR_PROJECT_ID";
      checks.push({
        label: "GCP project configured",
        status: hasProject ? "pass" : "fail",
        detail: hasProject ? `Project: ${projectId}` : "Run: gcloud config set project <id>",
      });
    }

    // Config files
    const hasDockerfile = existsSync(join(cwd, "Dockerfile"));
    checks.push({
      label: "Dockerfile exists",
      status: hasDockerfile ? "pass" : "warn",
      detail: hasDockerfile ? undefined : "Will be scaffolded",
    });

    if (!hasDockerfile) filesToCreate.push("Dockerfile");

    const hasCloudBuild = existsSync(join(cwd, "cloudbuild.yaml"));
    if (!hasCloudBuild) filesToCreate.push("cloudbuild.yaml");
    checks.push({
      label: "cloudbuild.yaml exists",
      status: hasCloudBuild ? "pass" : "warn",
      detail: hasCloudBuild ? undefined : "Will be scaffolded (optional — gcloud can deploy from source)",
    });

    // Build plan
    if (!hasDockerfile) plan.push("scaffold Dockerfile");
    if (!hasCloudBuild) plan.push("scaffold cloudbuild.yaml");
    plan.push(`gcloud run deploy raxd-${agentName} --source . --region ${region} --port ${DEPLOY_DEFAULTS.port} --memory ${DEPLOY_DEFAULTS.resources.memory.replace("m", "Mi")} --timeout 300 --allow-unauthenticated`);

    return {
      provider: "cloudrun",
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
      scaffoldDocker(cwd, agentName, "cloudrun");
    }

    // cloudbuild.yaml
    const cloudBuildPath = join(cwd, "cloudbuild.yaml");
    if (existsSync(cloudBuildPath)) {
      console.log("  skip cloudbuild.yaml (already exists)");
      return;
    }

    const projectId = detectProjectId();
    const region = getRegion();

    writeFileSync(cloudBuildPath, cloudRunYamlTemplate(agentName, projectId, region), "utf-8");
    console.log("  create cloudbuild.yaml");
  },

  up(ctx) {
    const { cwd, opts, agentName } = ctx;
    const region = getRegion();

    this.scaffold(ctx);

    if (opts.scaffoldOnly) {
      console.log("\n  ✅ Cloud Run files scaffolded. Next steps:");
      console.log("     1. gcloud auth login");
      console.log("     2. gcloud config set project YOUR_PROJECT_ID");
      console.log(`     3. gcloud run deploy raxd-${agentName} --source . --region ${region}`);
      console.log("     4. gcloud run services update raxd-" + agentName + " --set-secrets ...\n");
      return;
    }

    if (!hasCommand("gcloud")) {
      console.error("  ❌ gcloud CLI not found. Install it:");
      console.error(`     ${this.installHint}\n`);
      console.error("  Or scaffold files only:");
      console.error("     rax deploy up --target cloudrun --scaffold-only");
      process.exit(1);
    }

    console.log("\n  🚀 Deploying to Google Cloud Run...\n");

    const deployCode = execLive(
      `gcloud run deploy raxd-${agentName} --source . --region ${region} --port ${DEPLOY_DEFAULTS.port} --memory ${DEPLOY_DEFAULTS.resources.memory.replace("m", "Mi")} --timeout 300 --allow-unauthenticated`,
      cwd,
    );

    if (deployCode === 0) {
      console.log("\n  ✅ Deployed to Cloud Run!");
      console.log("\n  Set secrets:");
      console.log(`     gcloud run services update raxd-${agentName} --region ${region} \\`);
      console.log("       --set-secrets ANTHROPIC_API_KEY=anthropic-key:latest\n");
      console.log("  Useful commands:");
      console.log(`     gcloud run services describe raxd-${agentName} --region ${region}`);
      console.log(`     gcloud run services logs read raxd-${agentName} --region ${region}`);
      console.log(`     gcloud run services delete raxd-${agentName} --region ${region}\n`);
    } else {
      console.error("\n  ❌ Cloud Run deployment failed. Check the output above.");
      console.error("  Make sure you're authenticated: gcloud auth login\n");
      process.exit(1);
    }
  },

  down(ctx) {
    const { agentName } = ctx;
    const region = getRegion();

    if (!hasCommand("gcloud")) {
      console.error(`  ❌ gcloud CLI not found. Install: ${this.installHint}`);
      process.exit(1);
    }

    console.log("\n🛑 Deleting Cloud Run service...\n");
    const code = execLive(
      `gcloud run services delete raxd-${agentName} --region ${region} --quiet`,
      ctx.cwd,
    );
    if (code === 0) {
      console.log("\n  ✅ Cloud Run service deleted.\n");
    } else {
      console.error("\n  ❌ Failed to delete. Run manually:");
      console.error(`     gcloud run services delete raxd-${agentName} --region ${region}\n`);
    }
  },

  status(ctx) {
    const { agentName, cwd } = ctx;
    const region = getRegion();

    if (!hasCommand("gcloud")) {
      console.error(`  ❌ gcloud CLI not found. Install: ${this.installHint}`);
      process.exit(1);
    }

    console.log("\n📊 Cloud Run Service Status\n");
    execLive(
      `gcloud run services describe raxd-${agentName} --region ${region}`,
      cwd,
    );
  },

  logs(ctx) {
    const { agentName, cwd } = ctx;
    const region = getRegion();

    if (!hasCommand("gcloud")) {
      console.error(`  ❌ gcloud CLI not found. Install: ${this.installHint}`);
      process.exit(1);
    }

    execLive(
      `gcloud run services logs read raxd-${agentName} --region ${region}`,
      cwd,
    );
  },
};
