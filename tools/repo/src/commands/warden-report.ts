import { readFileSync } from "node:fs"
import { parse } from "yaml"
import type { Command } from "../cli.ts"
import { flagValue, rejectUnknown, splitArgs } from "../lib/args.ts"

/** What the parent thread does with a warden's UpwardReport (AGENTS.md Dispatcher FSM). There is no `accept`: acceptance follows a passing verifier. */
export type NextAction = "verify" | "verify-with-ablation" | "redispatch" | "escalate" | "surface-blocker"

/** Result of validating an UpwardReport. */
export interface ReportCheck {
  valid: boolean
  errors: readonly string[]
  next: NextAction
}

const STATUSES = ["completed", "failed", "blocked", "denied-by-authority"] as const
type Status = (typeof STATUSES)[number]
const CONFIDENCE_FLOOR = 0.7

/** Exact human-readable follow-up per action. */
export const NEXT_GUIDANCE: Readonly<Record<NextAction, string>> = {
  verify: "verify — run bun run repo verify <pkg-dir> for the files in the report",
  "verify-with-ablation":
    "verify-with-ablation — run bun run repo verify <pkg-dir>, then ablation-warden if the change is a new mechanism; do not re-prompt the warden",
  redispatch: "redispatch — re-dispatch the warden with the report's blockers in MissionBrief.key-tasks",
  escalate: "escalate — ask the user (AskUserQuestion); do not retry or widen authority",
  "surface-blocker": "surface-blocker — report the blocker to the user; do not re-dispatch",
}

/** The last `upward-report:` block (fenced or bare) as a YAML document, or null. */
function lastBlock(text: string): string | null {
  const lines = text.split(/\r?\n/)
  let start = -1
  lines.forEach((l, i) => {
    if (/^\s*upward-report:\s*(?:#.*)?$/.test(l)) start = i
  })
  if (start < 0) return null
  const indent = (lines[start] as string).search(/\S/)
  const body: string[] = [(lines[start] as string).slice(indent)]
  for (const l of lines.slice(start + 1)) {
    if (l.trim().length === 0) {
      body.push("")
      continue
    }
    if (l.search(/\S/) <= indent) break
    body.push(l.slice(indent))
  }
  return body.join("\n")
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function stringList(v: unknown): readonly string[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null
}

/**
 * Validate the last `upward-report:` block in `text` against `.agents/skills/upward-report/SKILL.md`
 * and route it per the Dispatcher FSM. Invalid or absent reports route to `escalate`.
 * `retriesRemaining` comes from the MissionBrief's `retries-allowed` minus attempts used.
 */
export function checkUpwardReport(text: string, retriesRemaining: number): ReportCheck {
  const bad = (errors: readonly string[]): ReportCheck => ({ valid: false, errors, next: "escalate" })
  const block = lastBlock(text)
  if (block === null) return bad(["no `upward-report:` block found"])
  let doc: unknown
  try {
    doc = parse(block)
  } catch (e) {
    return bad([`upward-report block is not valid YAML: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`])
  }
  const r = isObject(doc) ? doc["upward-report"] : undefined
  if (!isObject(r)) return bad(["`upward-report:` must be a mapping"])

  const errors: string[] = []
  const status = r.status
  if (typeof status !== "string" || !STATUSES.includes(status as Status))
    errors.push(`status must be one of ${STATUSES.join(" | ")} (got ${JSON.stringify(status)})`)
  const confidence = r.confidence
  if (typeof confidence !== "number" || Number.isNaN(confidence) || confidence < 0 || confidence > 1)
    errors.push(`confidence must be a number in 0..1 (got ${JSON.stringify(confidence)})`)
  if (typeof r["escalation-required"] !== "boolean") errors.push("escalation-required must be true or false")
  else if (r["escalation-required"] && !(typeof r["escalation-reason"] === "string" && r["escalation-reason"].trim().length > 0))
    errors.push("escalation-reason is required when escalation-required is true")
  for (const key of ["blockers", "evidence-anchors", "planned-actions-pending-approval"])
    if (r[key] !== undefined && r[key] !== null && stringList(r[key]) === null) errors.push(`${key} must be a list of strings`)
  if (errors.length > 0) return bad(errors)

  const s = status as Status
  const blockers = stringList(r.blockers) ?? []
  const next = ((): NextAction => {
    switch (s) {
      case "completed":
        return (confidence as number) >= CONFIDENCE_FLOOR ? "verify" : "verify-with-ablation"
      case "failed":
        return blockers.length > 0 && retriesRemaining > 0 && r["escalation-required"] !== true ? "redispatch" : "escalate"
      case "denied-by-authority":
        return "escalate"
      case "blocked":
        return "surface-blocker"
    }
  })()
  return { valid: true, errors: [], next }
}

function readInput(source: string): string {
  return readFileSync(source === "-" ? 0 : source, "utf8")
}

/** `repo warden-report <file|->`: validate a warden's UpwardReport and name the dispatcher's next move. */
export const wardenReportCommand: Command = {
  name: "warden-report",
  summary: "Validate an UpwardReport (file or -) and name the next dispatcher action",
  example: "bun run repo warden-report report.md --retries 1",
  async run(args, io) {
    const { positionals, flagTokens } = splitArgs(args, ["--retries"])
    const bad = rejectUnknown(io, "warden-report", flagTokens, { values: ["--retries"] })
    if (bad !== undefined) return bad
    if (positionals.length !== 1) return io.usage("expected exactly one file (or - for stdin)", "bun run repo warden-report --help")
    const retriesRaw = flagValue(flagTokens, "--retries") ?? "0"
    const retries = Number(retriesRaw)
    if (!Number.isInteger(retries) || retries < 0) return io.usage(`--retries must be a non-negative integer (got ${retriesRaw})`, "bun run repo warden-report --help")
    let text: string
    try {
      text = readInput(positionals[0] as string)
    } catch (e) {
      return io.usage(`cannot read ${positionals[0]}: ${e instanceof Error ? e.message : String(e)}`, "bun run repo warden-report --help")
    }
    const r = checkUpwardReport(text, retries)
    io.data({ ...r, retriesRemaining: retries })
    if (!r.valid)
      return io.fail(`valid: false\n${r.errors.map((e) => `error: ${e}`).join("\n")}`, NEXT_GUIDANCE[r.next])
    io.out("valid: true")
    io.result(`next: ${NEXT_GUIDANCE[r.next]}`)
    return 0
  },
}
