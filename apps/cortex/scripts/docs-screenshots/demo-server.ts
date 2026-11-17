/**
 * Hermetic Cortex for the docs screenshots. Everything lives under `DEMO_DIR`
 * (`HOME`, the db, provider keys, workspace): nothing touches `~/.reactive-agents`
 * or the real `.cortex/`. No provider keys, no network: agents use the scripted `test` provider.
 *
 *   DEMO_DIR=/tmp/x DEMO_PORT=4399 bun run scripts/docs-screenshots/demo-server.ts
 */
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const demoDir = process.env.DEMO_DIR;
const port = Number(process.env.DEMO_PORT ?? "4399");
if (!demoDir) {
  console.error("DEMO_DIR is required");
  process.exit(2);
}
const dir = resolve(demoDir);
mkdirSync(join(dir, "cortex"), { recursive: true });

// Fail closed: Bun reads HOME for os.homedir() at process start only, so the caller (run.ts) must spawn this
// process with HOME=DEMO_DIR. Without that, calibration.db, skills and other home-based paths would be the real ones.
if (homedir() !== dir) {
  console.error(`refusing to start: os.homedir() is ${homedir()}, expected DEMO_DIR (${dir}). Spawn with HOME=$DEMO_DIR.`);
  process.exit(2);
}
process.env.HOME = dir;
process.env.USERPROFILE = dir;
process.env.XDG_CONFIG_HOME = join(dir, ".config");
process.env.XDG_DATA_HOME = join(dir, ".local", "share");
process.env.REACTIVE_AGENTS_RUNS_DIR = join(dir, "runs");
process.env.CORTEX_NO_OPEN = "1";
process.env.CORTEX_LOG = "warn";
process.env.CORTEX_HOST = "127.0.0.1";
for (const k of Object.keys(process.env)) {
  if (/(_API_KEY|_TOKEN|_SECRET)$/.test(k) && k !== "CORTEX_TOKEN") delete process.env[k];
}
delete process.env.CORTEX_TOKEN;

const { startCortexServer } = await import("../../server/index.js");
const started = await startCortexServer({
  port,
  hostname: "127.0.0.1",
  dbPath: join(dir, "cortex", "cortex.db"),
  openBrowser: false,
});
console.log(`demo cortex listening on ${port}`, Object.keys(started));
