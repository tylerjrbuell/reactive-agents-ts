// packages/runtime/src/sigterm.ts

/**
 * Creates a SIGTERM handler that gracefully shuts down a gateway agent.
 * Used in containerized deployments where `docker stop` sends SIGTERM.
 *
 * @param handle - The GatewayHandle from agent.start()
 * @param dispose - The agent.dispose() function
 * @param onSummary - Optional callback to log the shutdown summary
 */
export function createSigtermHandler(
  handle: { stop: () => Promise<Record<string, unknown>> },
  dispose: () => Promise<void>,
  onSummary?: (summary: Record<string, unknown>) => void,
): () => Promise<void> {
  return async () => {
    const summary = await handle.stop();
    if (onSummary) onSummary(summary);
    await dispose();
  };
}

/**
 * Registers SIGTERM and SIGINT handlers for graceful container shutdown.
 * Call this after agent.start() in a containerized deployment.
 */
export function registerShutdownHandlers(
  handle: { stop: () => Promise<Record<string, unknown>> },
  dispose: () => Promise<void>,
  options?: { log?: boolean },
): void {
  const handler = createSigtermHandler(handle, dispose, (summary) => {
    if (options?.log !== false) {
      console.log("[raxd] Graceful shutdown complete:", summary);
    }
  });

  const shutdown = () => {
    handler().then(() => process.exit(0));
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
