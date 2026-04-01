/**
 * Cortex server logging — controlled with `CORTEX_LOG`:
 * - `error` | `warn` | `info` | `debug` (default: **info**)
 * - `off` — suppress all cortex-prefixed logs except runner execution failures (still use `console.warn`)
 */

export type CortexLogLevel = "error" | "warn" | "info" | "debug" | "off";

/** Lower = more severe. Config sets the maximum severity number to print (inclusive). */
const SEVERITY: Record<Exclude<CortexLogLevel, "off">, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function effectiveLevel(): CortexLogLevel {
  const raw = process.env.CORTEX_LOG?.trim().toLowerCase();
  if (raw === "off" || raw === "0" || raw === "false") return "off";
  if (raw === "error") return "error";
  if (raw === "warn" || raw === "warning") return "warn";
  if (raw === "debug" || raw === "trace" || raw === "verbose" || raw === "all") return "debug";
  return "info";
}

function shouldLog(level: Exclude<CortexLogLevel, "off">): boolean {
  const floor = effectiveLevel();
  if (floor === "off") return false;
  return SEVERITY[level] <= SEVERITY[floor];
}

/**
 * Structured server log. Prefer `scope` = subsystem (`ingest`, `runner`, `live-ws`, …).
 */
export function cortexLog(
  level: Exclude<CortexLogLevel, "off">,
  scope: string,
  message: string,
  extra?: Record<string, unknown>,
): void {
  if (!shouldLog(level)) return;
  const suffix = extra && Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : "";
  const line = `[cortex:${scope}] ${message}${suffix}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Always warn (even when CORTEX_LOG=off) — use for agent execution failures. */
export function cortexLogRunnerExecution(message: string, extra?: Record<string, unknown>): void {
  const suffix = extra && Object.keys(extra).length > 0 ? ` ${JSON.stringify(extra)}` : "";
  console.warn(`[cortex:runner] ${message}${suffix}`);
}
