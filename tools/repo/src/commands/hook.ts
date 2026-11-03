import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { Command } from "../cli.ts"
import { flagValue, rejectUnknown } from "../lib/args.ts"
import { classifyBash, loadRules } from "../lib/hook-rules.ts"
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

/** `repo hook pre-bash`: Claude Code PreToolUse hook (hidden; wired in .claude/settings.json). */
export const hookCommand: Command = {
  name: "hook",
  summary: "Claude Code hooks (internal)",
  example: "bun run repo hook pre-bash",
  hidden: true,
  async run(args, io) {
    const bad = rejectUnknown(io, "hook", args.filter((a) => a !== "pre-bash"), { values: ["--root"] })
    if (bad !== undefined) return bad
    if (args[0] !== "pre-bash") return io.usage("unknown hook event", "bun run repo hook pre-bash")
    const root = resolveRoot(flagValue(args, "--root"))
    let stdin = ""
    try {
      stdin = readFileSync(0, "utf8")
    } catch (e) {
      log(root, "hook-errors.jsonl", { error: e instanceof Error ? e.message : String(e) })
      return 0
    }
    const out = preBash(root, stdin, process.env)
    if (out !== undefined) io.result(out)
    return 0
  },
}
