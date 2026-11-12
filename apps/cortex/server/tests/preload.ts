/**
 * Cortex server test preload: no test can spend money.
 *
 * Bun loads the developer's `.env` into `process.env` before tests run, so a suite
 * that builds a real provider (a gateway or chat agent with no `provider: "test"`)
 * would call that provider with a real key. This strips every provider and voice key
 * variable before any test file loads. A test that needs a key sets its own (to a fake)
 * inside the test.
 *
 * Wired by `apps/cortex/bunfig.toml` (the `bun run --cwd apps/cortex test` path). A run
 * from the repo root uses the root bunfig (`scripts/test-preload.ts`), which does not
 * strip keys: there, hermeticity rests on each test using `provider: "test"`.
 */
import { stripSecretEnv } from "./hermetic-env.js";

stripSecretEnv(process.env);
// The root preload's status-mode pin, which a package-level bunfig replaces.
process.env.REACTIVE_AGENTS_DISABLE_STATUS_MODE ??= "true";
