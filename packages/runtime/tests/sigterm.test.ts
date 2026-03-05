// packages/runtime/tests/sigterm.test.ts
import { describe, test, expect } from "bun:test";

describe("SIGTERM graceful shutdown", () => {
  test("SIGTERM triggers stop on gateway handle", async () => {
    const { createSigtermHandler } = await import("../src/sigterm.js");

    let stopped = false;
    const mockHandle = {
      stop: async () => {
        stopped = true;
        return { heartbeatsFired: 1, totalRuns: 0, cronChecks: 0 };
      },
      done: new Promise<void>(() => {}),
    };

    const mockDispose = async () => {};

    const handler = createSigtermHandler(mockHandle, mockDispose);
    await handler();

    expect(stopped).toBe(true);
  });

  test("SIGTERM handler calls dispose after stop", async () => {
    const { createSigtermHandler } = await import("../src/sigterm.js");

    const callOrder: string[] = [];
    const mockHandle = {
      stop: async () => {
        callOrder.push("stop");
        return { heartbeatsFired: 0, totalRuns: 0, cronChecks: 0 };
      },
      done: new Promise<void>(() => {}),
    };
    const mockDispose = async () => {
      callOrder.push("dispose");
    };

    const handler = createSigtermHandler(mockHandle, mockDispose);
    await handler();

    expect(callOrder).toEqual(["stop", "dispose"]);
  });
});
