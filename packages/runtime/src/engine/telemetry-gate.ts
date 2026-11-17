/**
 * Single decision point for Reactive Intelligence run telemetry (the
 * anonymous RunReport upload and its once-per-process notice).
 *
 * Telemetry is OPT-IN. It is on only when one of these holds:
 *   - `.withReactiveIntelligence({ telemetry: true })`
 *   - `.withReactiveIntelligence({ telemetry: { enabled: true } })`
 *   - env `REACTIVE_AGENTS_TELEMETRY=1|true`, with no explicit `telemetry: false`
 *
 * The environment opt-out always wins, even over an explicit `true`:
 * `DO_NOT_TRACK` (set and not "0") or `REACTIVE_AGENTS_TELEMETRY=0|false`
 * (see `telemetryOptedOut` in @reactive-agents/reactive-intelligence).
 *
 * Both the notice (engine/execute-telemetry-notice.ts) and the upload
 * (engine/finalize/telemetry-emit.ts) read this function, so the notice can
 * never claim telemetry the upload path would not send.
 */
import { telemetryOptedOut } from "@reactive-agents/reactive-intelligence";

/** `REACTIVE_AGENTS_TELEMETRY=1|true` (case-insensitive) opts the process in. */
export function telemetryOptedInByEnv(): boolean {
  const v = process.env["REACTIVE_AGENTS_TELEMETRY"]?.toLowerCase();
  return v === "1" || v === "true";
}

/**
 * The explicit `telemetry` setting from the RI options: `true`/`false` when
 * the caller set it, `undefined` when they did not.
 */
function explicitTelemetrySetting(telemetryCfg: unknown): boolean | undefined {
  if (typeof telemetryCfg === "boolean") return telemetryCfg;
  if (typeof telemetryCfg === "object" && telemetryCfg !== null) {
    const enabled = (telemetryCfg as Record<string, unknown>)["enabled"];
    return typeof enabled === "boolean" ? enabled : undefined;
  }
  return undefined;
}

/**
 * Whether this run may send an anonymous RunReport.
 *
 * @param riOptions - `config.reactiveIntelligenceOptions` (its `telemetry` field is read).
 * @returns `true` only on an explicit or env opt-in with no env opt-out.
 */
export function isRunTelemetryEnabled(riOptions: unknown): boolean {
  if (telemetryOptedOut()) return false;
  const telemetryCfg =
    typeof riOptions === "object" && riOptions !== null
      ? (riOptions as Record<string, unknown>)["telemetry"]
      : undefined;
  const explicit = explicitTelemetrySetting(telemetryCfg);
  if (explicit !== undefined) return explicit;
  return telemetryOptedInByEnv();
}

/** The custom reports endpoint from `telemetry: { endpoint }`, if any. */
export function telemetryEndpoint(riOptions: unknown): string | undefined {
  if (typeof riOptions !== "object" || riOptions === null) return undefined;
  const telemetryCfg = (riOptions as Record<string, unknown>)["telemetry"];
  if (typeof telemetryCfg !== "object" || telemetryCfg === null) return undefined;
  const endpoint = (telemetryCfg as Record<string, unknown>)["endpoint"];
  return typeof endpoint === "string" ? endpoint : undefined;
}
