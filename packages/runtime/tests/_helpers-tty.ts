/**
 * Pin stdout's TTY state for a test body.
 *
 * Unset verbosity follows stdout (`resolveVerbosity`): "normal" narration on a
 * TTY, warnings/errors only otherwise. A test that asserts console narration
 * must pin the TTY state instead of inheriting the runner's stdout (a pipe in
 * CI and under `bun run repo test`). Status mode stays off so a TTY arm still
 * streams lines instead of handing output to the status renderer.
 *
 * @param isTTY - The `process.stdout.isTTY` value during `body`.
 * @param body - The test body; state is restored when it settles.
 */
export async function withStdoutTTY<T>(isTTY: boolean, body: () => Promise<T>): Promise<T> {
  const savedTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  const savedStatusEnv = process.env["REACTIVE_AGENTS_DISABLE_STATUS_MODE"];
  Object.defineProperty(process.stdout, "isTTY", { value: isTTY, configurable: true, writable: true });
  process.env["REACTIVE_AGENTS_DISABLE_STATUS_MODE"] = "true";
  try {
    return await body();
  } finally {
    if (savedTTY) Object.defineProperty(process.stdout, "isTTY", savedTTY);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
    if (savedStatusEnv === undefined) delete process.env["REACTIVE_AGENTS_DISABLE_STATUS_MODE"];
    else process.env["REACTIVE_AGENTS_DISABLE_STATUS_MODE"] = savedStatusEnv;
  }
}
