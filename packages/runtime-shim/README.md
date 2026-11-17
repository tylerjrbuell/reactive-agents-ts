# @reactive-agents/runtime-shim

> One API for Bun and Node.js: SQLite, spawn, serve, glob, hash and file I/O, plus egress-safe fetch helpers, for Reactive Agents packages and apps.

> **Stability:** unstable. The pinned-fetch helpers (`fetchPinned`, `resolvePublicUrl`) are `@unstable`; the other primitives follow the same minor-version change policy.

## Install

```bash
bun add @reactive-agents/runtime-shim
# or: npm install @reactive-agents/runtime-shim
```

## Usage

```ts
import { Database, spawn, hash, serve, isMain } from "@reactive-agents/runtime-shim";

const db = new Database(":memory:");
db.exec("CREATE TABLE t (id INTEGER)");

const proc = spawn(["echo", "hello"], { stdout: "pipe" });
await proc.exited;

const key = hash("text").toString(36);

const server = await serve({ port: 0, fetch: () => new Response("ok") });

if (isMain(import.meta.url)) {
  // running as the entry script
}
```

The runtime is detected once at import. Bun uses `Bun.*` and `bun:sqlite`; Node uses `node:*` built-ins.

## API

| Export | Use it when |
|---|---|
| `Database` | You need SQLite (`bun:sqlite` or `node:sqlite`). |
| `spawn` | You run a child process. |
| `writeFile`, `readFile` | You read or write files. |
| `hash` | You need a 64-bit content hash (`bigint`). Values differ between Bun and Node. |
| `serve`, `secureServe` | You start an HTTP server. `serve` returns a `Promise`. |
| `glob` | You match files by pattern. |
| `isMain`, `isBun`, `isNode` | You branch on entry script or runtime. |
| `assertPublicUrl`, `resolvePublicUrl`, `fetchPinned`, `PublicUrlError` | You fetch user-supplied URLs with SSRF protection. |

## Limitations

- On Node, `Database` uses `node:sqlite`, which has no FTS5. Search falls back to `LIKE`.
- Only the methods Reactive Agents uses are shimmed. Wider Bun APIs are not.

## Documentation

- [Installation](https://docs.reactiveagents.dev/guides/installation/)

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
