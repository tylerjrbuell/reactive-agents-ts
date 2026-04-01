import type { CortexIngestMessage } from "../types.js";
import { Cause, Effect, Exit, Layer } from "effect";
import { cortexLog } from "../cortex-log.js";
import { CortexIngestService } from "../services/ingest-service.js";

let parseErrorCount = 0;

function rawPreview(raw: string | Buffer): string {
  const text = typeof raw === "string" ? raw : raw.toString("utf8");
  return text.replace(/\s+/g, " ").slice(0, 120);
}

function rawByteLength(raw: unknown): number {
  if (typeof raw === "string") return raw.length;
  if (raw instanceof Buffer || raw instanceof Uint8Array) return raw.byteLength;
  return 0;
}

function rawPreviewUnknown(raw: unknown): string {
  if (typeof raw === "string") return rawPreview(raw);
  if (raw instanceof Buffer || raw instanceof Uint8Array) return rawPreview(Buffer.from(raw));
  return "";
}

function validateIngestPayload(
  parsed: unknown,
): { ok: true; msg: CortexIngestMessage } | { ok: false; reason: string } {
  if (!parsed || typeof parsed !== "object") return { ok: false, reason: "not_an_object" };
  const m = parsed as Record<string, unknown>;
  if (m.v !== 1) return { ok: false, reason: "bad_protocol_version" };
  if (typeof m.agentId !== "string" || !m.agentId.trim()) return { ok: false, reason: "missing_agentId" };
  if (typeof m.runId !== "string" || !m.runId.trim()) return { ok: false, reason: "missing_runId" };
  if (!m.event || typeof m.event !== "object") return { ok: false, reason: "missing_event" };
  const ev = m.event as Record<string, unknown>;
  if (typeof ev._tag !== "string" || !ev._tag) return { ok: false, reason: "missing_event._tag" };
  return { ok: true, msg: parsed as CortexIngestMessage };
}

export function handleIngestMessage(
  _ws: unknown,
  raw: unknown,
  ingestLayer: Layer.Layer<CortexIngestService>,
): void {
  let parsed: unknown;
  try {
    if (typeof raw === "string") {
      parsed = JSON.parse(raw) as unknown;
    } else if (raw instanceof Buffer || raw instanceof Uint8Array) {
      parsed = JSON.parse(Buffer.from(raw).toString("utf8")) as unknown;
    } else if (raw && typeof raw === "object") {
      // Some WS adapters already decode JSON and pass objects directly.
      parsed = raw;
    } else {
      throw new Error("Unsupported ingest payload type");
    }
  } catch {
    parseErrorCount += 1;
    // Log first error, then every 50th to avoid drowning useful diagnostics.
    if (parseErrorCount === 1 || parseErrorCount % 50 === 0) {
      cortexLog("debug", "ingest", "dropped: non-JSON payload on /ws/ingest", {
        count: parseErrorCount,
        bytes: rawByteLength(raw),
        preview: rawPreviewUnknown(raw),
      });
    }
    return;
  }

  const validated = validateIngestPayload(parsed);
  if (!validated.ok) {
    cortexLog("debug", "ingest", "dropped: invalid payload", { reason: validated.reason });
    return;
  }
  const msg = validated.msg;

  const program = Effect.gen(function* () {
    const svc = yield* CortexIngestService;
    yield* svc.handleEvent(msg.agentId, msg.runId, msg);
  });

  Effect.runFork(
    Effect.gen(function* () {
      const ex = yield* Effect.exit(program.pipe(Effect.provide(ingestLayer)));
      if (Exit.isFailure(ex)) {
        cortexLog("warn", "ingest", "persist_failed", {
          agentId: msg.agentId,
          runId: msg.runId,
          type: (msg.event as { _tag?: string })._tag,
          cause: Cause.pretty(ex.cause),
        });
      } else {
        cortexLog("debug", "ingest", "event_persisted", {
          agentId: msg.agentId,
          runId: msg.runId,
          type: (msg.event as { _tag?: string })._tag,
        });
      }
    }),
  );
}
