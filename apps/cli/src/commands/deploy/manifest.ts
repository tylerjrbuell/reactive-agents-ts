// apps/cli/src/commands/deploy/manifest.ts
// Single source of truth for all deployment constants.
// Every template imports from here — change once, update everywhere.

/** Default deployment constants shared across all provider templates */
export const DEPLOY_DEFAULTS = {
  /** Health/API port — used by every template */
  port: 3000,

  /** Health check endpoint path */
  healthPath: "/health",

  /** Health check timing shared across providers */
  healthCheck: {
    interval: "30s",
    timeout: "5s",
    startPeriod: "15s",
    retries: 3,
    gracePeriod: "10s",
  },

  /** Container resource limits */
  resources: {
    memory: "512m",
    pidsLimit: 50,
  },

  /** Base Docker image for all Dockerfiles */
  baseImage: "oven/bun:1-alpine",

  /** Non-root user for all containers */
  user: {
    name: "raxd",
    uid: 1001,
    gid: 1001,
  },

  /** Container name prefix — "raxd-<agentName>" */
  containerPrefix: "raxd",

  /** Default LLM config baked into templates */
  llm: {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
  },

  /** Env var names that must be set as secrets (not baked into configs) */
  secrets: ["ANTHROPIC_API_KEY", "TAVILY_API_KEY"] as readonly string[],

  /** Container security hardening */
  security: {
    capDrop: ["ALL"] as readonly string[],
    noNewPrivileges: true,
    stopSignal: "SIGTERM",
  },

  /** Default regions per provider */
  regions: {
    fly: "iad",
    render: "oregon",
    cloudrun: "us-central1",
    digitalocean: "nyc",
  },
} as const;

/** Provider CLI commands and config file markers */
export const PROVIDER_CLI = {
  local: {
    configFiles: ["docker-compose.yml"],
    cliNames: ["docker"],
    installHint: "https://docs.docker.com/get-docker/",
  },
  fly: {
    configFiles: ["fly.toml"],
    cliNames: ["flyctl", "fly"],
    installHint: "curl -L https://fly.io/install.sh | sh",
    docs: "https://fly.io/docs/flyctl/",
  },
  railway: {
    configFiles: ["railway.json", "railway.toml"],
    cliNames: ["railway"],
    installHint: "npm install -g @railway/cli",
    docs: "https://docs.railway.com/cli",
  },
  render: {
    configFiles: ["render.yaml"],
    cliNames: ["render"],
    installHint: "https://render.com/docs/cli",
    docs: "https://render.com/docs/cli",
  },
  cloudrun: {
    configFiles: ["cloudbuild.yaml"],
    cliNames: ["gcloud"],
    installHint: "https://cloud.google.com/sdk/docs/install",
    docs: "https://cloud.google.com/run/docs/quickstarts",
  },
  digitalocean: {
    configFiles: [".do/app.yaml"],
    cliNames: ["doctl"],
    installHint: "https://docs.digitalocean.com/reference/doctl/how-to/install/",
    docs: "https://docs.digitalocean.com/reference/doctl/",
  },
} as const;

export type ProviderName = keyof typeof PROVIDER_CLI;
