// File: src/artifacts/artifact-contract.ts
//
// Artifact truth (Wave C / task C2, audit 01-F1) — the tool-declared answer to
// "did this call produce a durable file, and where?".
//
// This REPLACES the old artifact-recognition heuristic (a 4-name
// `WRITING_TOOL_NAMES` set + a ~15-key path whitelist buried in the verifier):
//   - RECOGNITION is now declaration-driven — {@link resolveProduces} reads the
//     tool's own `produces` field (types.ts) off the registered definitions, so
//     adding a file-writing tool is a one-field declaration, never a second list
//     to keep in sync. code-execute / shell-execute writes — invisible to the
//     old 4-name set — are now first-class.
//   - EXTRACTION is a per-builtin contract ({@link extractArtifactFacts}): each
//     file-producer knows how it names its output (file-write → path arg;
//     code-execute → fs calls in the code; shell → redirect targets).
//
// Pure — no I/O, no fs. Consumed by the reasoning kernel's artifact ledger
// emitter (deriveArtifactEntries) at the act tool-execution boundary.

import { builtinTools } from "../skills/builtin.js";
import { shellExecuteTool } from "../skills/shell-execution.js";
import { dockerExecuteTool } from "../skills/docker-execution.js";
import { writeResultToFileTool } from "../skills/write-result-to-file.js";

/** What KIND of durable output a successful tool call produces (types.ts `produces`). */
export type ProducesKind = "file" | "data" | "none";

/** A file artifact a successful call produced — one row per written path. */
export interface ArtifactFact {
  /** The path the tool was asked to write (as named in the call; relative or absolute). */
  readonly path: string;
  /** Mutation kind. `write` overwrites/creates; `append` extends; `delete` removes. */
  readonly op: "write" | "append" | "delete" | "unknown";
  /** Cheap content digest when the written content is available at the call boundary. */
  readonly digest?: string;
}

// ─── produces resolution (declaration-driven) ────────────────────────────────

/**
 * The name→`produces` map, DERIVED from the registered tool definitions' own
 * `produces` field — not a hand-maintained name set. `builtinTools` is the
 * canonical file/data/http roster; shell/docker/write-result-to-file are
 * registered separately (not in that array) so they are added explicitly.
 * A tool that declares no `produces` contributes `"data"` (no artifact).
 */
const PRODUCES_BY_NAME: ReadonlyMap<string, ProducesKind> = new Map(
  [
    ...builtinTools.map((t) => t.definition),
    shellExecuteTool,
    dockerExecuteTool,
    writeResultToFileTool,
  ].map((d) => [d.name, d.produces ?? "data"] as const),
);

/**
 * Resolve a tool's `produces` kind from its declaration. Unknown / MCP /
 * function tools default to `"data"` — the safe false-UNMET direction: an
 * undeclared tool never fabricates an artifact.
 */
export function resolveProduces(toolName: string): ProducesKind {
  return PRODUCES_BY_NAME.get(toolName) ?? "data";
}

// ─── path extraction (per-builtin contract) ──────────────────────────────────

/**
 * Argument keys whose VALUE names a written file path. Restricting extraction to
 * these keys (not every string arg) is load-bearing: a `content` body that
 * merely mentions a path must never be treated AS the path.
 */
const PATH_ARG_KEYS: ReadonlySet<string> = new Set([
  "path",
  "filepath",
  "file_path",
  "file",
  "filename",
  "file_name",
  "dest",
  "destination",
  "outputpath",
  "output_path",
  "outpath",
  "out_path",
  "target",
  "targetpath",
  "target_path",
]);

/** FNV-1a 32-bit hex — a cheap, deterministic content digest (not cryptographic). */
function cheapDigest(content: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** file-write family — the path is a dedicated path arg; digest from `content`. */
function extractPathArgFacts(args: Record<string, unknown>): ArtifactFact[] {
  const content = typeof args.content === "string" ? args.content : undefined;
  const digest = content !== undefined ? cheapDigest(content) : undefined;
  const facts: ArtifactFact[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (!PATH_ARG_KEYS.has(key.toLowerCase())) continue;
    if (typeof value !== "string" || value.trim().length === 0) continue;
    facts.push({ path: value.trim(), op: "write", ...(digest !== undefined ? { digest } : {}) });
  }
  return facts;
}

// Match `fs.writeFileSync('p', ...)`, `writeFile("p", ...)`, `Bun.write('p', ...)`,
// `fs.promises.appendFile(\`p\`, ...)`, `unlinkSync('p')`, etc. The first string
// literal argument is the path. `op` is inferred from the call name.
const CODE_WRITE_CALL =
  /\b(?:fs\.)?(?:promises\.)?(writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|unlink|unlinkSync|rm|rmSync)\s*\(\s*(['"`])([^'"`]+)\2/g;
const BUN_WRITE_CALL = /\bBun\.write\s*\(\s*(['"`])([^'"`]+)\1/g;

function codeOp(call: string): ArtifactFact["op"] {
  if (call.startsWith("append")) return "append";
  if (call.startsWith("unlink") || call.startsWith("rm")) return "delete";
  return "write";
}

/** code-execute — files written by fs / Bun calls inside the code string (01-F1). */
function extractCodeFacts(args: Record<string, unknown>): ArtifactFact[] {
  const code = typeof args.code === "string" ? args.code : "";
  if (code.length === 0) return [];
  const facts: ArtifactFact[] = [];
  const seen = new Set<string>();
  for (const m of code.matchAll(CODE_WRITE_CALL)) {
    const path = m[3]!.trim();
    const op = codeOp(m[1]!);
    const key = `${op}:${path}`;
    if (path.length === 0 || seen.has(key)) continue;
    seen.add(key);
    facts.push({ path, op });
  }
  for (const m of code.matchAll(BUN_WRITE_CALL)) {
    const path = m[2]!.trim();
    const key = `write:${path}`;
    if (path.length === 0 || seen.has(key)) continue;
    seen.add(key);
    facts.push({ path, op: "write" });
  }
  return facts;
}

// Match shell output redirects: `> file`, `>> file`, `tee file`, `tee -a file`.
const SHELL_REDIRECT = /(>>|>)\s*("([^"]+)"|'([^']+)'|([^\s;&|<>]+))/g;
const SHELL_TEE = /\btee\s+(?:-a\s+)?("([^"]+)"|'([^']+)'|([^\s;&|<>]+))/g;

/** shell-execute — best-effort redirect / tee targets in the command string. */
function extractShellFacts(args: Record<string, unknown>): ArtifactFact[] {
  const command = typeof args.command === "string" ? args.command : "";
  if (command.length === 0) return [];
  const facts: ArtifactFact[] = [];
  const seen = new Set<string>();
  const push = (path: string, op: ArtifactFact["op"]) => {
    const p = path.trim();
    const key = `${op}:${p}`;
    if (p.length === 0 || seen.has(key)) return;
    seen.add(key);
    facts.push({ path: p, op });
  };
  for (const m of command.matchAll(SHELL_REDIRECT)) {
    const path = m[3] ?? m[4] ?? m[5] ?? "";
    push(path, m[1] === ">>" ? "append" : "write");
  }
  for (const m of command.matchAll(SHELL_TEE)) {
    const path = m[2] ?? m[3] ?? m[4] ?? "";
    push(path, "append");
  }
  return facts;
}

/**
 * Extract the file artifacts a successful call to `toolName` produced, per the
 * per-builtin path-extraction contract. Returns `[]` for tools that name no
 * recoverable path (the safe false-UNMET direction). Callers gate on
 * {@link resolveProduces} `=== "file"` first, so a `data`/`none` tool is never
 * asked here in the ledger path.
 */
export function extractArtifactFacts(
  toolName: string,
  args: Record<string, unknown>,
): ArtifactFact[] {
  switch (toolName) {
    case "file-write":
    case "write-file":
    case "fs-write":
    case "writefile":
    case "write-result-to-file":
      return extractPathArgFacts(args);
    case "code-execute":
      return extractCodeFacts(args);
    case "shell-execute":
    case "docker-execute":
      return extractShellFacts(args);
    default:
      return [];
  }
}
