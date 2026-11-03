import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"
import type { Command } from "../cli.ts"
import { flagValue, rejectUnknown } from "../lib/args.ts"
import { classifyBash, loadRules } from "../lib/hook-rules.ts"
import { allowedReason } from "../lib/allow-paths.ts"
import { isHookExempt, loadPlacement, placeFile } from "../lib/placement.ts"
import { resolveRoot } from "../lib/root.ts"

export { classifyBash } from "../lib/hook-rules.ts"
export type { HookDecision, HookRule } from "../lib/hook-rules.ts"

const COMMAND_LOG_CAP = 300

function log(root: string, file: string, entry: Record<string, unknown>): void {
  try {
    const dir = join(root, ".repo-logs")
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, file), `${JSON.stringify({ ...entry, ts: new Date().toISOString() })}\n`)
  } catch {
    // Logging must never break a tool call.
  }
}

function commandOf(stdin: string): string | undefined {
  const doc: unknown = JSON.parse(stdin)
  if (typeof doc !== "object" || doc === null) return undefined
  const input = (doc as Record<string, unknown>).tool_input
  if (typeof input !== "object" || input === null) return undefined
  const cmd = (input as Record<string, unknown>).command
  return typeof cmd === "string" ? cmd : undefined
}

/**
 * Handle one PreToolUse payload. Returns the deny JSON to print, or undefined to allow.
 * Fails open: any internal error allows the call and is appended to `.repo-logs/hook-errors.jsonl`.
 */
export function preBash(root: string, stdin: string, env: Readonly<Record<string, string | undefined>>): string | undefined {
  try {
    const command = commandOf(stdin)
    if (command === undefined) return undefined
    const verdict = classifyBash(command, loadRules(root), env, { root })
    if (verdict.decision === "allow") {
      for (const o of verdict.overrides ?? [])
        log(root, "overrides.jsonl", { ruleId: o.ruleId, reason: o.reason, command: command.slice(0, COMMAND_LOG_CAP) })
      return undefined
    }
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: verdict.reason },
    })
  } catch (e) {
    log(root, "hook-errors.jsonl", { error: e instanceof Error ? e.message : String(e) })
    return undefined
  }
}

function filePathOf(stdin: string): string | undefined {
  const doc: unknown = JSON.parse(stdin)
  if (typeof doc !== "object" || doc === null) return undefined
  const input = (doc as Record<string, unknown>).tool_input
  if (typeof input !== "object" || input === null) return undefined
  const o = input as Record<string, unknown>
  const p = o.file_path ?? o.notebook_path
  return typeof p === "string" && p.length > 0 ? p : undefined
}

/**
 * Handle one PreToolUse `Write` payload. Returns the deny JSON to print, or undefined to allow.
 * Allows existing files, paths outside the repo, `placement.json#hookExempt` scratch dirs and
 * `REPO_ALLOW=<ruleId>` with a reason. (Not `git check-ignore`: root `note.md`/`scratch.ts` are
 * git-ignored yet are exactly the litter the rules exist to stop.)
 * Fails open: any internal error allows the call and is appended to `.repo-logs/hook-errors.jsonl`.
 */
export function preWrite(root: string, stdin: string, env: Readonly<Record<string, string | undefined>>): string | undefined {
  try {
    const given = filePathOf(stdin)
    if (given === undefined) return undefined
    const abs = resolve(root, given)
    const rel = relative(root, abs)
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined
    const path = rel.split("\\").join("/")
    const { rules, hookExempt } = loadPlacement(root)
    const verdict = placeFile(path, rules)
    if (verdict.ok || existsSync(abs) || isHookExempt(path, hookExempt)) return undefined
    const allowed = (env.REPO_ALLOW ?? "").split(/[\s,]+/).filter((s) => s.length > 0)
    const why = (env.REPO_ALLOW_REASON ?? "").trim()
    if (why.length > 0 && allowed.includes(verdict.ruleId)) {
      log(root, "overrides.jsonl", { ruleId: verdict.ruleId, reason: why, command: `Write ${path}` })
      return undefined
    }
    const granted = allowedReason(root, path)
    if (granted !== undefined) {
      log(root, "overrides.jsonl", { ruleId: verdict.ruleId, reason: granted, command: `Write ${path}` })
      return undefined
    }
    const reason =
      `${verdict.reason}\ncanonical: ${verdict.canonical}\n` +
      `if intended: bun run repo place --allow ${path} --reason "<why>"\n[source: tools/repo/placement.json#${verdict.ruleId}]`
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
    })
  } catch (e) {
    log(root, "hook-errors.jsonl", { error: e instanceof Error ? e.message : String(e) })
    return undefined
  }
}

const EVENTS = ["pre-bash", "pre-write"] as const

/** `repo hook pre-bash|pre-write`: Claude Code PreToolUse hooks (hidden; wired in .claude/settings.json). */
export const hookCommand: Command = {
  name: "hook",
  summary: "Claude Code hooks (internal)",
  example: "bun run repo hook pre-bash",
  hidden: true,
  async run(args, io) {
    const bad = rejectUnknown(io, "hook", args.filter((a) => !(EVENTS as readonly string[]).includes(a)), { values: ["--root"] })
    if (bad !== undefined) return bad
    const event = args[0]
    if (event !== "pre-bash" && event !== "pre-write") return io.usage("unknown hook event", "bun run repo hook pre-bash")
    const root = resolveRoot(flagValue(args, "--root"))
    let stdin = ""
    try {
      stdin = readFileSync(0, "utf8")
    } catch (e) {
      log(root, "hook-errors.jsonl", { error: e instanceof Error ? e.message : String(e) })
      return 0
    }
    const out = event === "pre-bash" ? preBash(root, stdin, process.env) : preWrite(root, stdin, process.env)
    if (out !== undefined) io.result(out)
    return 0
  },
}
