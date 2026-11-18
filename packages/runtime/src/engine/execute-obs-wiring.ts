/**
 * Observability + EventBus acquisition, verbosity binding, log-prefix wiring.
 *
 * Owns: the H1 optional `ObservabilityService` acquisition (narrowed to
 * `ObsLike`), the once-per-execution verbosity helpers (verbosity / isNormal /
 * isVerbose / isDebug / logModelIO), the depth-aware `config.logPrefix`
 * wrapping of ALL obs log methods, and the Phase 0.2 optional EventBus
 * acquisition.
 *
 * NOT owned — stays in execution-engine.ts: the `isRootExecution`
 * discriminator declaration. tests/status-renderer-root-only.test.ts pins the
 * literal `const isRootExecution = !lp;` (and the root-gated
 * `makeStatusRenderer(logger, process.stdout, eb)` construction) to the engine
 * file, so the engine derives it from the `lp` returned here.
 *
 * Moved verbatim from execution-engine.ts (GH #221 W26 decomposition,
 * "observability acquisition + verbosity/logPrefix binding" cluster, former
 * lines 195-262).
 */
import { Effect } from "effect";
import type { ReactiveAgentsConfig } from "../types.js";
import { EventBus } from "@reactive-agents/core";
import {
  ObservabilityService,
  makeObservableLogger,
  resolveVerbosity,
  stdoutIsTTY,
  type LogEvent,
  type ObservabilityEnvironment,
  type ObservableLoggerService,
} from "@reactive-agents/observability";
import type { EbLike, ObsLike } from "./runtime-context.js";
import { asObsLike } from "./runtime-context.js";

/** Verbosity union shared by the engine's log gates + ObservableLogger config. */
export type ExecutionVerbosity = "minimal" | "normal" | "verbose" | "debug";

export interface ObsWiring {
  readonly obs: ObsLike | null;
  readonly verbosity: ExecutionVerbosity;
  /**
   * `true` when no verbosity was set and stdout is not a TTY: narration is
   * off (`verbosity` resolves to "minimal"), but warning and error log events
   * still print live. See {@link makeExecutionLogger}.
   */
  readonly liveWarningsOnly: boolean;
  readonly isNormal: boolean;
  readonly isVerbose: boolean;
  readonly isDebug: boolean;
  readonly logModelIO: boolean;
  /** Depth-aware log prefix ("" for the ROOT execution). */
  readonly lp: string;
  readonly eb: EbLike | null;
}

/**
 * Acquire observability + EventBus for one execution and bind its verbosity.
 *
 * Verbosity: the ObservabilityService's level when present, else the
 * configured `observabilityVerbosity`, else the stdout-dependent default from
 * `resolveVerbosity` ("normal" on a TTY, "minimal" otherwise). Only stdout
 * printing depends on it; EventBus publishing never does.
 *
 * @param config - The engine config fields this reads.
 * @param environment - Host facts; tests inject `stdoutIsTTY`.
 */
export const bindExecutionObservability = (
  config: Pick<ReactiveAgentsConfig, "observabilityVerbosity" | "logModelIO" | "logPrefix">,
  environment: ObservabilityEnvironment = {},
): Effect.Effect<ObsWiring, never> =>
  Effect.gen(function* () {
    // ── H1: Acquire ObservabilityService optionally ──
    const obsOpt = yield* Effect.serviceOption(
      ObservabilityService,
    ).pipe(
      Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
    );
    const obs: ObsLike | null = obsOpt._tag === "Some" ? asObsLike(obsOpt.value) : null;

    // Verbosity helpers — read once per execution
    // ObsLike.verbosity() is typed `() => string` (a deliberately narrow/
    // widened slice of ObservabilityService, see runtime-context.ts) — cast
    // to the real 4-tier union here, matching the existing precedent at
    // this file's other obs.verbosity() call site (progress-logger setup).
    // Unset verbosity follows stdout: a server, pipe or CI job (no TTY) gets
    // "minimal" narration with warnings/errors still printed live.
    const isTTY = (environment.stdoutIsTTY ?? stdoutIsTTY)();
    const verbosity = (obs?.verbosity?.() as
      | "minimal"
      | "normal"
      | "verbose"
      | "debug"
      | undefined) ?? resolveVerbosity(config.observabilityVerbosity, isTTY);
    const liveWarningsOnly = config.observabilityVerbosity === undefined && !isTTY;
    const isNormal = verbosity !== "minimal";
    const isVerbose = verbosity === "verbose" || verbosity === "debug";
    const isDebug = verbosity === "debug";
    // logModelIO: explicit opt-in/out for full prompt/response dumps.
    // Default: true when debug, false otherwise.
    const logModelIO = config.logModelIO ?? isDebug;

    // Log prefix for visual nesting: a sub-agent's lines carry a
    // depth-aware, name-tagged prefix (built in sub-agent-executor) so a
    // reader can tell WHICH child — and at what nesting — every line came
    // from, even when children run in parallel. Wrap ALL log methods, not
    // just info/debug: a child's warn/error must indent + attribute the
    // same, or it appears at the PARENT's level and reads as the parent
    // failing (2026-07-23 — the prior wrap covered info/debug only).
    const lp = config.logPrefix ?? "";

    if (obs && lp) {
      const origInfo = obs.info.bind(obs);
      const origDebug = obs.debug.bind(obs);
      const origWarn = obs.warn.bind(obs);
      const origError = obs.error.bind(obs);
      const mutableObs = obs as {
        info: (msg: string, meta?: Record<string, unknown>) => unknown;
        debug: (msg: string, meta?: Record<string, unknown>) => unknown;
        warn: (msg: string, meta?: Record<string, unknown>) => unknown;
        error: (msg: string, err?: unknown, meta?: Record<string, unknown>) => unknown;
      };
      mutableObs.info = (msg, meta) => origInfo(`${lp}${msg}`, meta);
      mutableObs.debug = (msg, meta) => origDebug(`${lp}${msg}`, meta);
      mutableObs.warn = (msg, meta) => origWarn(`${lp}${msg}`, meta);
      mutableObs.error = (msg, err, meta) => origError(`${lp}${msg}`, err, meta);
    }

    // ── Phase 0.2: Acquire EventBus optionally ──
    const ebOpt = yield* Effect.serviceOption(EventBus).pipe(
      Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
    );
    const eb: EbLike | null = ebOpt._tag === "Some" ? ebOpt.value : null;

    return { obs, verbosity, liveWarningsOnly, isNormal, isVerbose, isDebug, logModelIO, lp, eb };
  });

/** Warning and error log events: the ones that still print in warnings-only mode. */
const isWarningOrError = (event: LogEvent): boolean =>
  event._tag === "warning" ||
  event._tag === "error" ||
  (event._tag === "log" && (event.level === "warn" || event.level === "error"));

/**
 * Build the execution's ObservableLogger. With `liveWarningsOnly` and a live
 * logger, a subscriber prints warning/error events to stdout (the logger
 * itself sits at "minimal" and prints nothing). Buffering and subscribers are
 * unchanged, so run summaries and any event consumer see every event.
 *
 * @param loggerConfig - Passed to `makeObservableLogger` unchanged.
 * @param liveWarningsOnly - From {@link bindExecutionObservability}.
 */
export const makeExecutionLogger = (
  loggerConfig: Parameters<typeof makeObservableLogger>[0],
  liveWarningsOnly: boolean,
): Effect.Effect<ObservableLoggerService, never> =>
  Effect.gen(function* () {
    const logger = yield* makeObservableLogger(loggerConfig);
    if (liveWarningsOnly && loggerConfig.live) {
      const prefix = loggerConfig.logPrefix ?? "";
      yield* logger.subscribe((event, formatted) =>
        isWarningOrError(event)
          ? Effect.sync(() => { console.log(`${prefix}${formatted}`); })
          : Effect.void,
      );
    }
    return logger;
  });

/** Host facts {@link resolveStatusMode} reads; tests inject both. */
export interface StatusModeEnvironment {
  readonly stdoutIsTTY?: () => boolean;
  /** `REACTIVE_AGENTS_DISABLE_STATUS_MODE` value. Default: read from `process.env`. */
  readonly disableStatusModeEnv?: string;
}

/**
 * Whether this execution hands stdout to the live status line.
 *
 * `logging.mode: "status"` always wins. Otherwise status mode turns on by
 * itself only when stdout is a TTY, nothing opted out
 * (`logging.disableStatusMode` or `REACTIVE_AGENTS_DISABLE_STATUS_MODE=true`;
 * the runtime never reads NODE_ENV, HS-01), and verbosity is not "minimal".
 * On a TTY "minimal" is only ever explicit, so
 * `withObservability({ verbosity: "minimal" })` prints the answer alone.
 *
 * @param logging - The engine's `logging` config.
 * @param verbosity - The execution's resolved verbosity.
 * @param environment - Host facts; tests inject them.
 */
export const resolveStatusMode = (
  logging: Pick<NonNullable<ReactiveAgentsConfig["logging"]>, "mode" | "disableStatusMode"> | undefined,
  verbosity: ExecutionVerbosity,
  environment: StatusModeEnvironment = {},
): boolean => {
  if (logging?.mode === "status") return true;
  const disabledByEnv =
    (environment.disableStatusModeEnv ?? process.env.REACTIVE_AGENTS_DISABLE_STATUS_MODE) === "true";
  return (
    logging?.mode !== "stream" &&
    logging?.disableStatusMode !== true &&
    !disabledByEnv &&
    verbosity !== "minimal" &&
    (environment.stdoutIsTTY ?? stdoutIsTTY)()
  );
};
