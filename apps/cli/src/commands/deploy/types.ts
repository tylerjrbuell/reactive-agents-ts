// apps/cli/src/commands/deploy/types.ts

/** Supported deployment targets */
export type DeployTarget = "local" | "fly" | "railway" | "render" | "cloudrun" | "digitalocean";

/** Deployment mode */
export type DeployMode = "daemon" | "sdk";

/** Parsed CLI options for deploy commands */
export interface DeployOptions {
  target: DeployTarget;
  mode: DeployMode;
  name: string;
  topology: string;
  scaffoldOnly: boolean;
  follow: boolean;
  build: boolean;
  detach: boolean;
  gpu: boolean;
  dryRun: boolean;
}

/** Everything a provider adapter needs to do its job */
export interface DeployContext {
  /** Working directory (project root) */
  cwd: string;
  /** Parsed CLI options */
  opts: DeployOptions;
  /** Resolved agent name */
  agentName: string;
  /** Monorepo workspace root, or null for standalone */
  monorepoRoot: string | null;
}

// ─── Preflight / Dry-Run ────────────────────────────────────────────────────

export type CheckStatus = "pass" | "fail" | "warn";

/** Single preflight check result */
export interface PreflightCheck {
  label: string;
  status: CheckStatus;
  detail?: string;
}

/** Full preflight report returned by provider.preflight() */
export interface PreflightReport {
  provider: DeployTarget;
  checks: PreflightCheck[];
  /** Commands that `up` would execute (shown in dry-run) */
  plan: string[];
  /** Files that `scaffold` would create */
  filesToCreate: string[];
  /** Overall pass/fail — true if no "fail" checks */
  ok: boolean;
}

// ─── Provider Adapter Interface ─────────────────────────────────────────────

/**
 * Unified provider adapter interface.
 * Every target (local, fly, railway, render, cloudrun, digitalocean) implements this.
 * Adding a new provider = one file implementing DeployProvider + register it.
 */
export interface DeployProvider {
  /** Provider identifier */
  name: DeployTarget;

  /** Config files that indicate this provider is in use (for auto-detection) */
  configFiles: readonly string[];

  /** CLI tool names this provider uses */
  cliNames: readonly string[];

  /** Human-readable install hint for the CLI */
  installHint: string;

  /**
   * Validate prerequisites and return a structured report.
   * Called automatically before `up()`, and standalone via `--dry-run`.
   * Checks: CLI tools, auth, config files, env vars, Docker, etc.
   */
  preflight(ctx: DeployContext): PreflightReport;

  /** Scaffold config files + Dockerfiles. Called by `rax deploy up` before deploy. */
  scaffold(ctx: DeployContext): void;

  /** Build, push, and start the agent. */
  up(ctx: DeployContext): void | Promise<void>;

  /** Stop/destroy the deployment. */
  down(ctx: DeployContext): void;

  /** Print current deployment status. */
  status(ctx: DeployContext): void | Promise<void>;

  /** Tail or print logs. */
  logs(ctx: DeployContext): void;
}

/** Result of a scaffold operation */
export interface ScaffoldResult {
  created: number;
  skipped: number;
  files: string[];
  monorepo: boolean;
  monorepoRoot: string | null;
  appPath: string | null;
}

/** Container status info */
export interface ContainerStatus {
  name: string;
  status: string;
  health: string;
  ports: string;
  uptime: string;
}

export const VALID_TARGETS: DeployTarget[] = [
  "local", "fly", "railway", "render", "cloudrun", "digitalocean",
];

export const VALID_MODES: DeployMode[] = ["daemon", "sdk"];
