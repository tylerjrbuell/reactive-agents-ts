/**
 * @reactive-agents/runtime-shim
 *
 * Cross-runtime adapter. Detects Bun vs Node.js at module load and dispatches
 * to native implementations of common primitives.
 *
 * Use this package instead of `bun:sqlite`, `Bun.spawn`, `Bun.write`, `Bun.file`,
 * `Bun.hash`, `Bun.serve`, `Bun.Glob`, or `import.meta.main` anywhere reactive-agents
 * code may run on Node.js (Stackblitz, Vercel, Cloudflare, Netlify, etc.).
 */

export { isBun, isNode, isMain } from "./detect.js";
export { Database } from "./database.js";
export { spawn } from "./spawn.js";
export { writeFile, readFile } from "./fs.js";
export { hash } from "./hash.js";
export { serve } from "./serve.js";
export { secureServe, type SecureServeOptions } from "./secure-serve.js";
export {
  assertPublicUrl,
  resolvePublicUrl,
  PublicUrlError,
  isPrivateOrReservedIp,
  isMetadataOrLinkLocalIp,
  type AssertPublicUrlOptions,
  type ResolvedPublicUrl,
} from "./assert-public-url.js";
export {
  fetchPinned,
  nodePinnedTransport,
  type PinnedFetchInit,
  type PinnedFetchOptions,
  type PinnedRequest,
  type PinnedTransport,
} from "./pinned-fetch.js";
export { glob } from "./glob.js";

export type {
  DatabaseLike,
  StatementLike,
  DatabaseConstructor,
  SpawnOptions,
  SpawnResult,
  ServeOptions,
  ServerLike,
  GlobLike,
} from "./types.js";
