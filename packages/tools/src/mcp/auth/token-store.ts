/**
 * MCP client OAuth — token persistence.
 *
 * Part of Task 2 of `wiki/Planning/Implementation-Plans/2026-09-17-mcp-client-oauth.md`.
 *
 * `createFileTokenStore` persists {@link StoredMcpCredentials} under
 * `~/.reactive-agents/mcp-auth` by default (matching the existing
 * `~/.reactive-agents/<...>` convention — see
 * `packages/diagnose/src/lib/resolve.ts`'s `candidateTraceDirs`). Each
 * credential is written to its own file named by a SHA-256 hash of the
 * caller's key — never the raw server URL — so the directory listing does
 * not leak which servers a user has authenticated against. The store
 * directory is created `0700` and every credential file `0600`; reads
 * refuse any file that is group- or world-readable (a permission
 * regression, e.g. from a restrictive umask being loosened, should fail
 * loudly rather than silently hand back a secret that leaked).
 */
import { createHash, randomBytes } from "node:crypto";
import {
  mkdir,
  chmod,
  writeFile,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MCPTokenStore, StoredMcpCredentials } from "./types.js";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
/** Bits that must be clear on a credential file: group + other, any permission. */
const UNSAFE_MODE_MASK = 0o077;

/** Default file-store directory — matches the `~/.reactive-agents/<...>` convention. */
export const DEFAULT_MCP_AUTH_DIR = join(homedir(), ".reactive-agents", "mcp-auth");

/** Env var that overrides {@link DEFAULT_MCP_AUTH_DIR} for every file store built without a `dir`. */
export const MCP_AUTH_DIR_ENV = "REACTIVE_AGENTS_MCP_AUTH_DIR";

/**
 * The directory a file store built without a `dir` uses:
 * `REACTIVE_AGENTS_MCP_AUTH_DIR` when set and non-empty, else
 * {@link DEFAULT_MCP_AUTH_DIR}. Read at call time, not import time, so a test
 * preload (or a host app) can redirect stored logins away from the real home
 * directory. Bun caches `os.homedir()` at process start, so pointing `HOME`
 * elsewhere after start does not move the default; this override does.
 */
export function resolveMcpAuthDir(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const override = env[MCP_AUTH_DIR_ENV];
  return override !== undefined && override.length > 0 ? override : DEFAULT_MCP_AUTH_DIR;
}

/**
 * Normalize an MCP server URL into a stable, comparable resource key.
 *
 * - Lowercases scheme and host.
 * - Drops the port when it is the scheme's default (443 for `https`, 80 for `http`).
 * - Drops the fragment.
 * - Keeps the path (and query, if present) as-is — two URLs differing only
 *   in path are different resources by design.
 *
 * @example
 * canonicalResourceKey("https://A.com:443/mcp#x") === canonicalResourceKey("https://a.com/mcp")
 */
export function canonicalResourceKey(serverUrl: string): string {
  const url = new URL(serverUrl);
  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  const host = url.hostname.toLowerCase();
  const isDefaultPort =
    url.port === "" ||
    (scheme === "https" && url.port === "443") ||
    (scheme === "http" && url.port === "80");
  const port = isDefaultPort ? "" : `:${url.port}`;
  const path = url.pathname === "" ? "/" : url.pathname;
  return `${scheme}://${host}${port}${path}${url.search}`;
}

/** In-memory {@link MCPTokenStore} — lives only for the current process. */
export function createMemoryTokenStore(): MCPTokenStore {
  const store = new Map<string, StoredMcpCredentials>();
  return {
    async get(key) {
      return store.get(key);
    },
    async set(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
    async list() {
      return [...store.keys()];
    },
  };
}

interface FileRecord {
  readonly key: string;
  readonly value: StoredMcpCredentials;
}

const hashKey = (key: string): string =>
  createHash("sha256").update(key, "utf8").digest("hex");

const permissionError = (path: string, mode: number): Error =>
  new Error(
    `Refusing to read MCP credential file "${path}": mode ${(mode & 0o777).toString(8)} ` +
      `is group- or world-readable. Fix with: chmod 600 "${path}"`,
  );

/**
 * Persistent {@link MCPTokenStore} backed by one JSON file per key under
 * `dir` (default {@link resolveMcpAuthDir}: `REACTIVE_AGENTS_MCP_AUTH_DIR`,
 * else {@link DEFAULT_MCP_AUTH_DIR}). Multiple store instances pointed at the
 * same directory (including across process restarts) see each other's writes.
 */
export function createFileTokenStore(dir: string = resolveMcpAuthDir()): MCPTokenStore {
  const pathFor = (key: string): string => join(dir, `${hashKey(key)}.json`);

  const ensureDir = async (): Promise<void> => {
    await mkdir(dir, { recursive: true, mode: DIR_MODE });
    // `mkdir`'s `mode` is subject to umask and (for pre-existing directories)
    // is not applied at all — enforce it explicitly so a loose umask or an
    // already-existing dir never leaves this directory group/world-readable.
    await chmod(dir, DIR_MODE);
  };

  const readRecord = async (key: string): Promise<FileRecord | undefined> => {
    const path = pathFor(key);
    let fileStat;
    try {
      fileStat = await stat(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
    if ((fileStat.mode & UNSAFE_MODE_MASK) !== 0) {
      throw permissionError(path, fileStat.mode);
    }
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as FileRecord;
  };

  return {
    async get(key) {
      const record = await readRecord(key);
      return record?.value;
    },

    async set(key, value) {
      await ensureDir();
      const path = pathFor(key);
      const tmpPath = `${path}.tmp-${randomBytes(6).toString("hex")}`;
      const record: FileRecord = { key, value };
      try {
        await writeFile(tmpPath, JSON.stringify(record, null, 2), {
          mode: FILE_MODE,
        });
        // Same reasoning as ensureDir: enforce the mode explicitly, umask
        // notwithstanding.
        await chmod(tmpPath, FILE_MODE);
        // Atomic on POSIX: rename is a single filesystem operation, so a
        // reader never observes a partially-written credential file at
        // `path`. If rename throws (disk full, simulated failure, etc.)
        // `path` is left exactly as it was before this call.
        await rename(tmpPath, path);
      } catch (err) {
        await unlink(tmpPath).catch(() => {
          /* best-effort cleanup of the temp file; the original error wins */
        });
        throw err;
      }
    },

    async delete(key) {
      const path = pathFor(key);
      await unlink(path).catch((err) => {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      });
    },

    async list() {
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw err;
      }
      const keys: string[] = [];
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        const path = join(dir, entry);
        const fileStat = await stat(path);
        if ((fileStat.mode & UNSAFE_MODE_MASK) !== 0) {
          throw permissionError(path, fileStat.mode);
        }
        const raw = await readFile(path, "utf8");
        const record = JSON.parse(raw) as FileRecord;
        keys.push(record.key);
      }
      return keys;
    },
  };
}
