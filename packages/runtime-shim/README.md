# @reactive-agents/runtime-shim

Cross-runtime adapter for `reactive-agents`. Detects Bun vs Node.js at module load and dispatches to native primitives — Bun gets `Bun.*`, Node gets `node:*`. Same API surface on both runtimes.

## What it shims

| Primitive | Bun path | Node path | Fallback |
|-----------|----------|-----------|----------|
| `Database` | `bun:sqlite` | `node:sqlite` (22.5+) | In-memory stub |
| `spawn` | `Bun.spawn` | `node:child_process.spawn` | — |
| `writeFile` / `readFile` | `Bun.write` / `Bun.file().text()` | `node:fs/promises` | — |
| `hash` | `Bun.hash` (Wyhash) | SHA-256 truncated to 64 bits | — |
| `serve` | `Bun.serve` | `node:http` + Fetch API adapter | — |
| `glob` | `Bun.Glob` | `node:fs/promises.glob` | `readdir` for `*.ext` |
| `isMain(import.meta.url)` | matches `Bun.main` path | compares `process.argv[1]` URL | — |

## Usage

```ts
import { Database, spawn, hash, serve, isMain } from "@reactive-agents/runtime-shim";

const db = new Database(":memory:");
db.exec("CREATE TABLE t (id INTEGER)");

const proc = spawn(["echo", "hello"], { stdout: "pipe" });
const exitCode = await proc.exited;

const key = hash("text").toString(36);

const server = await serve({
  port: 0,
  fetch: (req) => new Response("ok"),
});

if (isMain(import.meta.url)) {
  // running as entry script
}
```

## Runtime support

- Bun ≥ 1.1 (native fast paths)
- Node.js ≥ 22.5 (real `node:sqlite` persistence + `node:fs.glob`)
- Node.js ≥ 20 (stub Database, manual glob fallback)
- Stackblitz WebContainer (Node-based, works with stub or real sqlite depending on Node version)
- Cloudflare Workers / Deno (subset — Database stub + hash; spawn/serve/fs require runtime-specific shims; out of scope for v0.11)

## Design notes

- **Module-load detection.** `isBun` is set once at import time via `typeof globalThis.Bun !== "undefined"`. No per-call runtime check overhead.
- **Sync require via `createRequire`.** No top-level await — consumers can import synchronously.
- **API parity surface area is intentionally narrow.** Each primitive exposes only the methods reactive-agents actually uses. Wider Bun APIs (e.g. `Bun.file().stream()`) are not shimmed.
- **`serve` is the only async primitive.** Returns `Promise<ServerLike>` because `node:http.listen` is async-only. Bun callers wrap in `Promise.resolve` for parity.
