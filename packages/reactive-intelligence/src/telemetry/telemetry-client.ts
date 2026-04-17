import { signPayload } from "./signing.js";
import { getOrCreateInstallId } from "./install-id.js";
import type { RunReport } from "./types.js";

const VERSION = "0.8.0";
const HARDCODED_DEFAULT = "https://api.reactiveagents.dev/v1/reports";

/**
 * Resolve the reports endpoint URL.
 * Precedence: REACTIVE_AGENTS_TELEMETRY_REPORTS_URL > BASE_URL + /v1/reports > hardcoded.
 * Symmetric with community-profile-client's resolveDefaultProfileEndpoint.
 */
export function resolveDefaultReportsEndpoint(): string {
  const full = process.env["REACTIVE_AGENTS_TELEMETRY_REPORTS_URL"];
  if (full) return full;
  const base = process.env["REACTIVE_AGENTS_TELEMETRY_BASE_URL"];
  if (base) return `${base.replace(/\/$/, "")}/v1/reports`;
  return HARDCODED_DEFAULT;
}

export class TelemetryClient {
  private noticePrinted = false;
  private readonly installId: string;

  constructor(private readonly endpoint: string = resolveDefaultReportsEndpoint()) {
    this.installId = getOrCreateInstallId();
  }

  /** Get the install ID (useful for building RunReports). */
  getInstallId(): string {
    return this.installId;
  }

  /** Check if this is a test run — never send telemetry for test runs. */
  private isTestRun(report: RunReport): boolean {
    return (
      report.provider === "test" ||
      report.modelId === "test" ||
      report.modelId.startsWith("test-") ||
      (report as any).modelTier === "test"
    );
  }

  /** Send a run report. Fire-and-forget — never blocks, never throws. */
  send(report: RunReport): void {
    // Guard: never send telemetry for test runs
    if (this.isTestRun(report)) return;

    if (!this.noticePrinted) {
      // Notice is now shown via ObservableLogger as a structured 'notice' event.
      // See execution-engine.ts for the NoticesManager integration.
      this.noticePrinted = true;
    }
    try {
      const body = JSON.stringify(report);
      const signature = signPayload(body);
      fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-RA-Client-Version": VERSION,
          "X-RA-Client-Signature": signature,
        },
        body,
      }).catch(() => {}); // fire-and-forget
    } catch {
      // silent — telemetry must never affect agent
    }
  }
}
