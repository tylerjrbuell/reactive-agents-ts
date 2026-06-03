/**
 * Bun test preload — runs once before any test file is imported.
 *
 * Disables status-mode auto-activation for the entire test run.
 *
 * Why: `execution-engine.ts` auto-enables "status mode" (the interactive
 * terminal renderer) whenever `process.stdout.isTTY` is truthy and no explicit
 * opt-out is set. Status mode installs a `StreamingTextCallback` on every
 * `execute()`, which routes runs down the streaming branch and reroutes text
 * deltas to the renderer. That is correct for an interactive terminal, but it
 * silently changes execution semantics under the test runner: `agent.run()`
 * stops returning tool output, `runStream()`'s own delta callback gets
 * clobbered, and ~16 behavioral tests fail — but ONLY when `bun test` is
 * invoked from a real TTY. Piped/CI runs have `isTTY=false`, so the same suite
 * passes there. The result is "green in CI, red in my terminal" flakiness that
 * depends purely on whether stdout is a TTY.
 *
 * Setting the documented opt-out here makes the suite deterministic regardless
 * of how it is launched (TTY, pipe, watch). Status mode is a rendering concern
 * with no place in non-interactive assertions. We use `??=` so an explicit
 * override on the command line still wins (e.g. for debugging the renderer).
 */
process.env.REACTIVE_AGENTS_DISABLE_STATUS_MODE ??= "true";
