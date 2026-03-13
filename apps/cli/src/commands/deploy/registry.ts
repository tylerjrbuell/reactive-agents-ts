// apps/cli/src/commands/deploy/registry.ts
// Provider registry — all adapters register here.
// Adding a new provider: implement DeployProvider, import + register below.

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DeployProvider, DeployTarget, DeployContext, PreflightReport, PreflightCheck } from "./types.js";
import { resolveCli } from "./exec.js";
import { section, info, success, fail, warn, kv, muted } from "../../ui.js";

// ─── Import all adapters ────────────────────────────────────────────────────

import { localProvider } from "./target-local.js";
import { flyProvider } from "./target-fly.js";
import { railwayProvider } from "./target-railway.js";
import { renderProvider } from "./target-render.js";
import { cloudrunProvider } from "./target-cloudrun.js";
import { digitaloceanProvider } from "./target-digitalocean.js";

// ─── Registry ───────────────────────────────────────────────────────────────

const providers = new Map<DeployTarget, DeployProvider>();

function register(provider: DeployProvider) {
  providers.set(provider.name, provider);
}

// Register all built-in providers
register(localProvider);
register(flyProvider);
register(railwayProvider);
register(renderProvider);
register(cloudrunProvider);
register(digitaloceanProvider);

/** Get a provider adapter by name. Throws if unknown. */
export function getProvider(target: DeployTarget): DeployProvider {
  const p = providers.get(target);
  if (!p) {
    throw new Error(`Unknown deploy target: "${target}". Available: ${[...providers.keys()].join(", ")}`);
  }
  return p;
}

/** Get all registered provider names */
export function listProviders(): DeployTarget[] {
  return [...providers.keys()];
}

// ─── Auto-Detection ─────────────────────────────────────────────────────────

/**
 * Auto-detect the deploy target from config files in the working directory.
 * Scans for provider-specific config files and returns the first match.
 * Returns "local" if no provider config is found but docker-compose.yml exists.
 * Returns null if nothing is detected.
 */
export function detectTarget(cwd: string): DeployTarget | null {
  // Check remote providers first (more specific configs)
  const remoteOrder: DeployTarget[] = ["fly", "railway", "render", "cloudrun", "digitalocean"];

  for (const target of remoteOrder) {
    const provider = providers.get(target);
    if (!provider) continue;

    for (const configFile of provider.configFiles) {
      if (existsSync(join(cwd, configFile))) {
        return target;
      }
    }
  }

  // Fall back to local if docker-compose.yml exists
  if (existsSync(join(cwd, "docker-compose.yml"))) {
    return "local";
  }

  return null;
}

// ─── Preflight / Dry-Run Rendering ──────────────────────────────────────────

/** Print a structured preflight report to stdout */
export function printPreflightReport(report: PreflightReport) {
  const { provider, checks, plan, filesToCreate, ok } = report;

  console.log(section(`Preflight Report — target: ${provider}`));
  console.log("");

  // CLI resolution info
  const p = providers.get(provider);
  if (p && p.name !== "local") {
    const resolved = resolveCli(p.cliNames);
    if (resolved) {
      const src = resolved.source === "local" ? "local binary" : "Docker container";
      console.log(kv("CLI", `${resolved.command} (${src})${resolved.version ? ` — ${resolved.version}` : ""}`));
    } else {
      console.log(warn(`CLI not found — install: ${p.installHint}`));
      if (p.cliNames.some((n) => ["flyctl", "gcloud", "doctl"].includes(n))) {
        console.log(muted("       or Docker will be used as fallback if available"));
      }
    }
    console.log("");
  }

  // Checks table
  console.log(section("Checks"));
  for (const check of checks) {
    const detail = check.detail ? ` — ${check.detail}` : "";
    if (check.status === "pass") {
      console.log(success(`${check.label}${detail}`));
    } else if (check.status === "fail") {
      console.log(fail(`${check.label}${detail}`));
    } else {
      console.log(warn(`${check.label}${detail}`));
    }
  }

  // Files
  if (filesToCreate.length > 0) {
    console.log("");
    console.log(section("Files to create"));
    for (const f of filesToCreate) {
      console.log(info(`+ ${f}`));
    }
  }

  // Execution plan
  if (plan.length > 0) {
    console.log("");
    console.log(section("Execution plan"));
    for (let i = 0; i < plan.length; i++) {
      console.log(kv(`${i + 1}`, plan[i]));
    }
  }

  // Result
  console.log("");
  if (ok) {
    console.log(success("Preflight passed — ready to deploy."));
  } else {
    const failures = checks.filter((c) => c.status === "fail");
    console.log(fail(`Preflight failed — ${failures.length} issue(s) to resolve:`));
    for (const f of failures) {
      console.log(muted(`     • ${f.label}${f.detail ? `: ${f.detail}` : ""}`));
    }
  }
  console.log("");
}
