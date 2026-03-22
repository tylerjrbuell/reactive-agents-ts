import type { PlatformAdapters } from "./types.js";

export function detectRuntime(): "bun" | "node" {
  return typeof (globalThis as Record<string, unknown>).Bun !== "undefined" ? "bun" : "node";
}

let _platform: PlatformAdapters | null = null;

export async function getPlatform(): Promise<PlatformAdapters> {
  if (_platform) return _platform;
  const runtime = detectRuntime();
  if (runtime === "bun") {
    const { createBunDatabase } = await import("./adapters/bun-database.js");
    const { createBunProcess } = await import("./adapters/bun-process.js");
    const { createBunServer } = await import("./adapters/bun-server.js");
    _platform = {
      runtime,
      database: createBunDatabase,
      process: createBunProcess(),
      server: createBunServer(),
    };
  } else {
    const { createNodeDatabase } = await import("./adapters/node-database.js");
    const { createNodeProcess } = await import("./adapters/node-process.js");
    const { createNodeServer } = await import("./adapters/node-server.js");
    _platform = {
      runtime,
      database: createNodeDatabase,
      process: createNodeProcess(),
      server: createNodeServer(),
    };
  }
  return _platform;
}

export function setPlatform(platform: PlatformAdapters): void {
  _platform = platform;
}

export function resetPlatform(): void {
  _platform = null;
}

export function getPlatformSync(): PlatformAdapters {
  if (_platform) return _platform;
  const runtime = detectRuntime();
  if (runtime === "bun") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createBunDatabase } = require("./adapters/bun-database.js") as typeof import("./adapters/bun-database.js");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createBunProcess } = require("./adapters/bun-process.js") as typeof import("./adapters/bun-process.js");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createBunServer } = require("./adapters/bun-server.js") as typeof import("./adapters/bun-server.js");
    _platform = {
      runtime,
      database: createBunDatabase,
      process: createBunProcess(),
      server: createBunServer(),
    };
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createNodeDatabase } = require("./adapters/node-database.js") as typeof import("./adapters/node-database.js");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createNodeProcess } = require("./adapters/node-process.js") as typeof import("./adapters/node-process.js");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createNodeServer } = require("./adapters/node-server.js") as typeof import("./adapters/node-server.js");
    _platform = {
      runtime,
      database: createNodeDatabase,
      process: createNodeProcess(),
      server: createNodeServer(),
    };
  }
  return _platform;
}
