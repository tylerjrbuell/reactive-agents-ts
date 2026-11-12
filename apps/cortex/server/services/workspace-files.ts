/**
 * Workspace file listing and bounded reads for the composer's `@` picker.
 *
 * Every path is confined to the session's workspace root: a request names a path
 * relative to it, the resolved real path (symlinks followed) must stay inside the
 * real root, and secrets, VCS data, dependency trees and build output are never
 * listed or read. Listing walks at most `MAX_ENTRIES` files / `MAX_DEPTH` levels,
 * honouring the root's `.gitignore` for simple name and directory patterns.
 */
import { closeSync, existsSync, openSync, type Dirent, readFileSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { ATTACHMENT_CAPS, cutToBytes, rankPaths } from "@reactive-agents/ui-core";

/** Most files one listing walk collects. */
export const MAX_ENTRIES = 5000;
/** Deepest directory level walked (root = 0). */
export const MAX_DEPTH = 8;
/** Longest accepted request path. */
const MAX_PATH_CHARS = 1024;

/** Directory names never entered. */
const IGNORED_DIRS: ReadonlySet<string> = new Set([
  ".git", ".hg", ".svn", "node_modules", ".ssh", ".gnupg", ".aws", ".cortex", ".next", ".svelte-kit", ".turbo", ".cache",
  "dist", "build", "coverage", "target", "__pycache__", ".venv", "venv", ".idea",
]);

/** Whether a file name is a secret or binary store that is never listed or read. */
export function isSecretName(name: string): boolean {
  const n = name.toLowerCase();
  if (n === ".env" || (n.startsWith(".env.") && !n.endsWith(".example") && !n.endsWith(".sample") && !n.endsWith(".template"))) return true;
  if (n === ".npmrc" || n === ".netrc" || n === ".pypirc" || n === ".git-credentials" || n === "secret.key") return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/.test(n)) return true;
  if (/\.(pem|key|p12|pfx|jks|keystore|kdbx)$/.test(n)) return true;
  if (/(^|[._-])(secret|secrets|credentials?)([._-]|$)/.test(n) && /\.(json|ya?ml|toml|ini|txt)$/.test(n)) return true;
  return false;
}

/** One file in a listing. */
export interface WorkspaceFile {
  /** Path relative to the root, `/` separated. */
  readonly path: string;
  readonly bytes: number;
}

type GitIgnoreRule = { readonly test: (relPath: string, isDir: boolean) => boolean };

/** `.gitignore` lines reduced to simple matchers: names, `dir/`, `*.ext`, anchored paths. Negations are skipped. */
export function gitignoreRules(text: string): readonly GitIgnoreRule[] {
  const rules: GitIgnoreRule[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("!")) continue;
    const dirOnly = line.endsWith("/");
    const body = line.replace(/\/+$/, "").replace(/^\//, "");
    if (body === "") continue;
    const anchored = line.replace(/\/+$/, "").includes("/");
    const source = body.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*");
    const re = new RegExp(anchored ? `^${source}(/|$)` : `(^|/)${source}(/|$)`);
    rules.push({ test: (rel, isDir) => (dirOnly && !isDir && !re.test(`${rel}/`) ? false : re.test(rel)) });
  }
  return rules;
}

function readIgnore(root: string): readonly GitIgnoreRule[] {
  try {
    return gitignoreRules(readFileSync(join(root, ".gitignore"), "utf8"));
  } catch {
    return [];
  }
}

/** Listing of a workspace: relative files, whether the walk stopped at the cap. */
export interface WorkspaceListing {
  readonly files: readonly WorkspaceFile[];
  readonly truncated: boolean;
}

/** Walk `root` (an existing directory) collecting listable files. */
export function listWorkspaceFiles(root: string): WorkspaceListing {
  const rules = readIgnore(root);
  const files: WorkspaceFile[] = [];
  let truncated = false;
  const walk = (dir: string, rel: string, depth: number): void => {
    if (truncated) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (files.length >= MAX_ENTRIES) {
        truncated = true;
        return;
      }
      const childRel = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name) || depth + 1 > MAX_DEPTH || rules.some((r) => r.test(childRel, true))) continue;
        walk(join(dir, e.name), childRel, depth + 1);
      } else if (e.isFile()) {
        if (isSecretName(e.name) || rules.some((r) => r.test(childRel, false))) continue;
        try {
          files.push({ path: childRel, bytes: statSync(join(dir, e.name)).size });
        } catch {
          /* vanished mid-walk */
        }
      }
    }
  };
  walk(root, "", 0);
  return { files, truncated };
}

/** A ranked listing for the picker. */
export interface FileSearchResult {
  readonly files: readonly { readonly path: string; readonly bytes: number; readonly indices: readonly number[] }[];
  /** More files exist than the walk collected. */
  readonly truncated: boolean;
}

/** Fuzzy search over the workspace listing; `limit` is clamped to 1..100. */
export function searchWorkspaceFiles(root: string, query: string, limit = 30): FileSearchResult {
  const listing = listWorkspaceFiles(root);
  const sizes = new Map(listing.files.map((f) => [f.path, f.bytes] as const));
  const ranked = rankPaths(query.slice(0, 200), listing.files.map((f) => f.path), Math.max(1, Math.min(100, Math.floor(limit))));
  return { files: ranked.map((m) => ({ path: m.path, bytes: sizes.get(m.path) ?? 0, indices: m.indices })), truncated: listing.truncated };
}

/** Why a path was refused. */
export type WorkspacePathCode = "bad-path" | "outside-workspace" | "secret" | "not-found" | "not-a-file" | "binary";

export type WorkspacePathCheck =
  | { readonly ok: true; readonly abs: string; readonly rel: string; readonly bytes: number }
  | { readonly ok: false; readonly code: WorkspacePathCode; readonly error: string };

/**
 * Resolve a request path inside `root`. Refuses absolute paths, NUL bytes, `..`
 * escapes, symlinks whose target leaves the root, secret names and ignored
 * directories, and anything that is not a regular file.
 */
export function resolveWorkspaceFile(root: string, requested: string): WorkspacePathCheck {
  if (requested === "" || requested.length > MAX_PATH_CHARS || requested.includes("\0")) return { ok: false, code: "bad-path", error: "Invalid file path" };
  if (isAbsolute(requested) || /^[A-Za-z]:[\\/]/.test(requested)) return { ok: false, code: "outside-workspace", error: "Paths are relative to the workspace" };
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return { ok: false, code: "not-found", error: "Workspace directory does not exist" };
  }
  const lexical = resolve(realRoot, requested);
  const lexicalRel = relative(realRoot, lexical);
  if (lexicalRel === "" || lexicalRel.startsWith("..") || isAbsolute(lexicalRel)) return { ok: false, code: "outside-workspace", error: "That path is outside the workspace" };
  if (!existsSync(lexical)) return { ok: false, code: "not-found", error: "File not found" };
  let real: string;
  try {
    real = realpathSync(lexical);
  } catch {
    return { ok: false, code: "not-found", error: "File not found" };
  }
  const rel = relative(realRoot, real);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return { ok: false, code: "outside-workspace", error: "That path is outside the workspace" };
  const parts = rel.split(sep);
  if (parts.some((p) => IGNORED_DIRS.has(p)) || parts.some(isSecretName) || lexicalRel.split(sep).some(isSecretName)) {
    return { ok: false, code: "secret", error: "That file is not available (secrets, dependencies and build output are never read)" };
  }
  const st = statSync(real);
  if (!st.isFile()) return { ok: false, code: "not-a-file", error: "Not a file" };
  return { ok: true, abs: real, rel: parts.join("/"), bytes: st.size };
}

/** A bounded read of a workspace file. */
export type WorkspaceFileRead =
  | { readonly ok: true; readonly path: string; readonly text: string; readonly totalBytes: number; readonly shownBytes: number; readonly truncated: boolean }
  | { readonly ok: false; readonly code: WorkspacePathCode; readonly error: string };

/** NUL byte in the head, or invalid UTF-8 replacement density, marks a file as binary. */
export function looksBinary(head: Uint8Array): boolean {
  if (head.includes(0)) return true;
  const text = new TextDecoder("utf-8", { fatal: false }).decode(head);
  let bad = 0;
  for (const ch of text) if (ch === "�") bad++;
  return text.length > 0 && bad / text.length > 0.02;
}

/**
 * Read a workspace text file up to `maxBytes` (default the inline cap). A binary
 * file is refused with its reason; a larger file is cut and says so.
 */
export function readWorkspaceText(root: string, requested: string, maxBytes: number = ATTACHMENT_CAPS.inlineBytes): WorkspaceFileRead {
  const r = resolveWorkspaceFile(root, requested);
  if (!r.ok) return r;
  const want = Math.min(r.bytes, maxBytes + 4);
  const buf = new Uint8Array(want);
  const fd = openSync(r.abs, "r");
  let got = 0;
  try {
    got = readSync(fd, buf, 0, want, 0);
  } finally {
    closeSync(fd);
  }
  const bytes = buf.subarray(0, got);
  if (looksBinary(bytes.subarray(0, 8192))) return { ok: false, code: "binary", error: `${r.rel} is a binary file; only text files can be tagged` };
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const cut = cutToBytes(decoded, maxBytes);
  const shownBytes = new TextEncoder().encode(cut.text).length;
  return { ok: true, path: r.rel, text: cut.text, totalBytes: r.bytes, shownBytes, truncated: cut.truncated || r.bytes > shownBytes };
}
