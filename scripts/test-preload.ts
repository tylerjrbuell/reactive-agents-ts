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

/**
 * Trace-corpus isolation (2026-10-29 failure-mode census): unit tests used to
 * write ~2,900 synthetic traces into ~/.reactive-agents/traces next to real
 * runs, and count-based pruning then deleted real-model traces. Point the
 * canonical trace-dir override at a per-process temp dir. The trace recorder
 * also redirects a hard-coded default dir to this override, so tests that
 * build default tracing never touch the real corpus. An explicit outer
 * REACTIVE_AGENTS_TRACE_DIR (e.g. a bench replay dir) still wins via `??=`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installDnsGuard } from "../tools/repo/src/lib/dns-guard.ts";
import { testHomeEnv } from "../tools/repo/src/lib/test-home.ts";
import { pidAlive } from "../tools/repo/src/lib/test-slots.ts";
import { makeTestRoot, realFs, sweep, TEST_ROOT_ENV, testTmpBase } from "../tools/repo/src/lib/tmp-janitor.ts";

/**
 * One temp root per test process (2026-11-18 OOM audit): /tmp is RAM-backed, ~33,000 leaked test dirs
 * reached 7 GB, and `process.on("exit")` cleanup never runs when a process is SIGKILLed or OOM-killed.
 * Point TMPDIR at `<tmp>/ra-tests-<pid>-<rand>/` so every suite's `os.tmpdir()` mkdtemp lands in one
 * removable tree; remove it on exit, SIGINT and SIGTERM; and reap roots whose PID is dead (names only,
 * no stat, so startup stays cheap). `repo test` creates the root itself and passes RA_TEST_TMP_ROOT.
 */
if (!process.env[TEST_ROOT_ENV]) {
  try {
    sweep(realFs, testTmpBase(), { pidAlive, now: Date.now(), legacy: false, dryRun: false });
    const root = makeTestRoot();
    process.env.TMPDIR = root;
    process.env[TEST_ROOT_ENV] = root;
    // HOME isolation (2026-11-19): suites leaked ~9,000 agent memory dirs into the real
    // ~/.reactive-agents/memory. Point HOME at a mirror of the real home without ~/.reactive-agents.
    // Bun caches os.homedir() at startup, so this covers process.env.HOME readers (the memory db
    // resolver) and child processes; `repo test` sets HOME at spawn and covers os.homedir() too.
    Object.assign(process.env, testHomeEnv(root));
    const cleanup = (): void => {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // best-effort; the next run's sweep reaps it by dead PID
      }
    };
    process.on("exit", cleanup);
    for (const [sig, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
      process.on(sig, () => {
        cleanup();
        process.exit(code);
      });
    }
  } catch {
    // hooks and preloads fail open: tests still run against the plain OS temp dir
  }
}

if (!process.env.REACTIVE_AGENTS_TRACE_DIR) {
  const traceDir = mkdtempSync(join(tmpdir(), "ra-test-traces-"));
  process.env.REACTIVE_AGENTS_TRACE_DIR = traceDir;
  process.on("exit", () => {
    try {
      rmSync(traceDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });
}

/**
 * Durable-run store isolation (2026-11-17): Cortex now defaults Durable runs on, so tests that
 * build tool-using sessions wrote ~100 `<agentId>/runs.db` dirs into the real
 * ~/.reactive-agents. Point the framework's base-dir override at a per-process temp dir.
 * An explicit outer REACTIVE_AGENTS_RUNS_DIR still wins.
 */
if (!process.env.REACTIVE_AGENTS_RUNS_DIR) {
  const runsDir = mkdtempSync(join(tmpdir(), "ra-test-runs-"));
  process.env.REACTIVE_AGENTS_RUNS_DIR = runsDir;
  process.on("exit", () => {
    try {
      rmSync(runsDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });
}

/**
 * Hermetic DNS (2026-11-20): a test that let a made-up host (`gpu-box`) reach the system resolver
 * waited ~4 s for ENOTFOUND and timed out in CI. Lookups of anything but localhost, *.localhost and
 * IP literals now fail at once, naming the host and the fix (inject a resolver or a fetch stub).
 * Deliberate live tests opt out with REPO_TEST_ALLOW_DNS=1; REPO_TEST_DNS_ALLOW=a,b allows names.
 * Coverage and gaps: tools/repo/src/lib/dns-guard.ts.
 */
try {
  installDnsGuard();
} catch {
  // preloads fail open: tests still run, with real DNS
}

/**
 * Hermetic provider keys (owner decision 2026-11-12): unit tests must never
 * reach a live model by accident because a developer's `.env` holds keys.
 * Strip every provider/service credential unless the run opts in with
 * `REACTIVE_AGENTS_TEST_LIVE=1`. CI has no keys, so this makes local runs
 * match CI. Keep the name list in step with apps/cortex/server/tests/hermetic-env.ts.
 */
if (process.env.REACTIVE_AGENTS_TEST_LIVE !== "1") {
  const isSecretEnvName = (name: string): boolean =>
    /(^|_)(API_KEY|API_TOKEN|AUTH_TOKEN|ACCESS_TOKEN|SECRET_KEY)$/i.test(name) ||
    (/^(ANTHROPIC|OPENAI|GEMINI|GOOGLE|OPENROUTER|LITELLM|ELEVENLABS|GROQ|MISTRAL|COHERE|XAI|TOGETHER|DEEPSEEK)_/i.test(name) &&
      /KEY|TOKEN/i.test(name));
  for (const name of Object.keys(process.env)) {
    if (isSecretEnvName(name)) delete process.env[name];
  }
}
