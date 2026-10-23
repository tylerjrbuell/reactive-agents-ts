/**
 * RI telemetry notice emission.
 *
 * Owns: the process-wide notices manager and the once-per-process
 * "Reactive Intelligence" telemetry notice, gated on
 * `config.enableReactiveIntelligence`, the notices manager (which also honors
 * `REACTIVE_AGENTS_SUPPRESS_NOTICES` and `.withReactiveIntelligence({ notice:
 * false })`), and the same opt-out the telemetry upload path honors.
 *
 * Moved verbatim from execution-engine.ts (GH #221 W26 decomposition, former
 * module-level `_noticesManager` lines 135-139 + the in-executeCore notice
 * emission banner, former lines 588-625). The notices manager is deliberately
 * module-level here exactly as it was in execution-engine.ts: process-wide
 * dedup across runs is its purpose.
 */
import { Effect } from "effect";
import type { ReactiveAgentsConfig } from "../types.js";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { ObservableLogger, makeNoticesManager, NOTICE_IDS } from "@reactive-agents/observability";
import { telemetryOptedOut } from "@reactive-agents/reactive-intelligence";

// Deduplicates notices (RI telemetry banner, etc.) across runs within the
// same process. Also honors REACTIVE_AGENTS_SUPPRESS_NOTICES (env) and
// `.withReactiveIntelligence({ notice: false })` (config) — see the
// TELEMETRY_ENABLED gate below.
const _noticesManager = makeNoticesManager();

export const maybeEmitRiTelemetryNotice = (
  config: ReactiveAgentsConfig,
): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    // Emit RI telemetry notice once per process via structured log.
    // `_noticesManager.shouldShow` is also the single choke point for
    // silencing it: `.withReactiveIntelligence({ notice: false })`,
    // REACTIVE_AGENTS_SUPPRESS_NOTICES=1 (env), or a prior dismiss()
    // all resolve here — no separate boolean to keep in sync.
    if (
      config.enableReactiveIntelligence &&
      _noticesManager.shouldShow(NOTICE_IDS.TELEMETRY_ENABLED)
    ) {
      const riOpts = config.reactiveIntelligenceOptions as Record<string, unknown> | undefined;
      const telemetryCfg = riOpts?.telemetry;
      // The notice must never claim telemetry the environment has
      // killed — consult the same opt-out the upload path honors.
      const telemetryEnabled = !telemetryOptedOut() &&
        (telemetryCfg === undefined || telemetryCfg === true ||
        (typeof telemetryCfg === "object" && telemetryCfg !== null &&
          (telemetryCfg as Record<string, unknown>)["enabled"] !== false));
      const noticeEnabled = riOpts?.notice !== false;
      if (noticeEnabled && telemetryEnabled) {
        yield* Effect.serviceOption(ObservableLogger).pipe(
          Effect.tap((loggerOpt) => {
            if (loggerOpt._tag === "Some") {
              return loggerOpt.value.emit({
                _tag: "notice",
                level: "info",
                title: "Reactive Intelligence",
                message: "Anonymous entropy data helps improve the framework. Disable with .withReactiveIntelligence({ telemetry: false })",
                docsLink: "https://docs.reactiveagents.dev/telemetry",
                dismissible: true,
                timestamp: new Date(),
              });
            }
            return Effect.void;
          }),
          Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:724", tag: errorTag(err) })),
        );
      }
    }
  });
