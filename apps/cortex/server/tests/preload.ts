/**
 * Cortex server test preload: no test can spend money or reach the network by accident.
 *
 * Bun loads the developer's `.env` into `process.env` before tests run, so a suite
 * that builds a real provider (a gateway or chat agent with no `provider: "test"`)
 * would call that provider with a real key. This strips every provider and voice key
 * variable before any test file loads. A test that needs a key sets its own (to a fake)
 * inside the test.
 *
 * Wired by `apps/cortex/bunfig.toml` (the `bun run --cwd apps/cortex test` path). A package
 * bunfig replaces the root one, so this preload also installs what the root preload
 * (`scripts/test-preload.ts`) installs and Cortex tests depend on: key stripping, the
 * status-mode pin and the DNS guard. A run from the repo root uses the root preload, which
 * strips the same keys (unless `REACTIVE_AGENTS_TEST_LIVE=1`) and installs the same guard.
 */
import { installDnsGuard } from "../../../../tools/repo/src/lib/dns-guard.js";
import { stripSecretEnv } from "./hermetic-env.js";

stripSecretEnv(process.env);
// The root preload's status-mode pin, which a package-level bunfig replaces.
process.env.REACTIVE_AGENTS_DISABLE_STATUS_MODE ??= "true";
// Hermetic DNS, as in the root preload: a lookup of anything but localhost, *.localhost or an
// IP literal fails at once instead of waiting seconds on the system resolver (a made-up `gpu-box`
// took ~4 s and timed out a test). Opt out with REPO_TEST_ALLOW_DNS=1; allow names with
// REPO_TEST_DNS_ALLOW=a,b. Coverage and gaps: tools/repo/src/lib/dns-guard.ts.
try {
  installDnsGuard();
} catch {
  // preloads fail open: tests still run, with real DNS
}
