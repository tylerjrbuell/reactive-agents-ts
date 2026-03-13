import { existsSync } from "node:fs";
import { exec, getComposeStatus, hasCommand, isDockerRunning } from "./deploy/exec.js";
import { section, success, fail, warn, kv, muted, box } from "../ui.js";

const HELP = `
  Usage: rax inspect <agent-id> [options]

  Inspect local runtime/deployment signals for an agent ID.

  Options:
    --logs-tail <n>     How many compose log lines to scan (default: 200)
    --json              Output diagnostics as JSON
    --help              Show this help
`.trimEnd();

interface InspectReport {
  agentId: string;
  cwd: string;
  timestamp: string;
  checks: Array<{ label: string; ok: boolean; detail: string }>;
  composeStatus?: string;
  logMatches: string[];
}

export function runInspect(args: string[]): void {
  if (args.includes("--help") || args.includes("-h")) {
    box(HELP, { title: " rax inspect " });
    return;
  }

  const agentId = args.find((arg) => !arg.startsWith("--"));
  if (!agentId) {
    console.error(fail("Usage: rax inspect <agent-id> [--logs-tail 200] [--json]"));
    process.exit(1);
  }

  let logsTail = 200;
  let asJson = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--logs-tail" && args[i + 1]) {
      const parsed = Number.parseInt(args[++i], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        logsTail = parsed;
      }
    } else if (arg === "--json") {
      asJson = true;
    }
  }

  const cwd = process.cwd();
  const composeFileExists = existsSync("docker-compose.yml");
  const dockerInstalled = hasCommand("docker");
  const dockerRunning = dockerInstalled && isDockerRunning();

  const report: InspectReport = {
    agentId,
    cwd,
    timestamp: new Date().toISOString(),
    checks: [
      {
        label: "docker-compose.yml",
        ok: composeFileExists,
        detail: composeFileExists ? "found" : "missing in current directory",
      },
      {
        label: "docker CLI",
        ok: dockerInstalled,
        detail: dockerInstalled ? "available" : "not found on PATH",
      },
      {
        label: "docker daemon",
        ok: dockerRunning,
        detail: dockerInstalled
          ? dockerRunning
            ? "running"
            : "not running"
          : "skipped (docker missing)",
      },
    ],
    logMatches: [],
  };

  if (composeFileExists && dockerRunning) {
    const status = getComposeStatus(cwd);
    if (status.trim().length > 0) {
      report.composeStatus = status;
    }

    try {
      const logs = exec(`docker compose logs --tail ${logsTail} 2>&1`, cwd);
      report.logMatches = logs
        .split("\n")
        .filter((line) => line.includes(agentId))
        .slice(-20);
    } catch {
      report.logMatches = [];
    }
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(section(`Inspecting agent: ${report.agentId}`));
  console.log(kv("Directory", report.cwd));
  console.log(kv("Timestamp", report.timestamp));
  console.log("");

  console.log(section("Checks"));
  for (const check of report.checks) {
    const detail = check.detail ? `: ${check.detail}` : "";
    if (check.ok) {
      console.log(success(`${check.label}${detail}`));
    } else {
      console.log(fail(`${check.label}${detail}`));
    }
  }

  if (report.composeStatus) {
    console.log("");
    console.log(section("Compose Status"));
    console.log(muted(report.composeStatus));
  }

  console.log("");
  console.log(section("Recent Log Matches"));
  if (report.logMatches.length === 0) {
    console.log(muted(`  (no log lines containing "${report.agentId}" in last ${logsTail} lines)`));
  } else {
    for (const line of report.logMatches) {
      console.log(`  ${line}`);
    }
  }

  if (!composeFileExists) {
    console.log("");
    console.log(warn("Run inspect from a deployment directory containing docker-compose.yml."));
  }
}
