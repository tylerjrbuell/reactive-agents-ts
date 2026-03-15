import { signPayload } from "./signing.js";
import { getOrCreateInstallId } from "./install-id.js";
import type { RunReport } from "./types.js";

const VERSION = "0.8.0";
const DEFAULT_ENDPOINT = "https://api.reactiveagents.dev/v1/reports";

export class TelemetryClient {
  private noticePrinted = false;
  private readonly installId: string;

  constructor(private readonly endpoint: string = DEFAULT_ENDPOINT) {
    this.installId = getOrCreateInstallId();
  }

  /** Get the install ID (useful for building RunReports). */
  getInstallId(): string {
    return this.installId;
  }

  /** Send a run report. Fire-and-forget — never blocks, never throws. */
  send(report: RunReport): void {
    if (!this.noticePrinted) {
      console.log(
        "ℹ Reactive Intelligence telemetry enabled — anonymous entropy data helps improve the framework. Disable with { telemetry: false }"
      );
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
