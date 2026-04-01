/**
 * Runs Cortex API + WebSocket server and SvelteKit dev UI (Vite, default 5173)
 * in one process group. Ctrl+C stops both.
 *
 * Vite proxies `/api` and `/ws` to the API (host/port from `CORTEX_PORT`, default 4321).
 * Open the **Vite** URL in the browser, not the API port alone.
 *
 * Used by `apps/cortex` `bun start` and `rax cortex --dev`.
 */
const cortexRoot = new URL("..", import.meta.url).pathname;

function spawnCortex(
  cmd: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
): ReturnType<typeof Bun.spawn> {
  return Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdout: "inherit",
    stderr: "inherit",
  });
}

const server = spawnCortex(["bun", "run", "server/index.ts"], cortexRoot, {
  CORTEX_NO_OPEN: "1",
});

const ui = spawnCortex(["bun", "run", "dev"], `${cortexRoot}/ui`, {});

function shutdown(code = 0): void {
  try {
    server.kill();
  } catch {
    /* already dead */
  }
  try {
    ui.kill();
  } catch {
    /* already dead */
  }
  process.exit(code);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => shutdown(0));
}

const firstExit = Promise.race([
  server.exited.then((c) => ({ proc: "server", code: c })),
  ui.exited.then((c) => ({ proc: "ui", code: c })),
]);

const result = await firstExit;
console.error(`\n◈ dev-stack: ${result.proc} exited (${result.code}). Stopping the other process.\n`);
shutdown(typeof result.code === "number" ? result.code : 1);
