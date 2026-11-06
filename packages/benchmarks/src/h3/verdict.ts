// File: src/h3/verdict.ts — one decisive verdict for a targeted H3 rerun.
//
//   bun run src/h3/verdict.ts --before <a.json,...> --after <b.json,...> --reason harness:<r> \
//     [--mechanism <activity key or fragment>] [--json] [--baseline] [--removal [--loc-delta -N]] \
//     [--ledger <path> --weakness "<text>" --hypothesis "<text>"]
//
// `--baseline` records a baseline refresh: the after-arm becomes the new
// before-point, decision `baseline` (exit 0), never `rejected`.
//
// `--removal` declares the fix a REMOVAL (a mechanism or code path deleted).
// The expected outcome is "same or better with less", not "the reason drops",
// and the removed mechanism firing in zero after-runs is the point, not `inert`.
// Decision `removed` (exit 0, ledger `adopted`) when the pass rate holds within
// noise, no harness reason rises (the targeted one included), the mechanism (if
// named) no longer fires, and billed tokens drop or `--loc-delta` is negative.
//
// Compares the SAME (tier, task) cells before and after a fix. `before` is
// restricted to the cells present in `after`, so a targeted rerun of 2 cells is
// compared against those 2 cells of the baseline, not the whole suite.
//
// Success metric (decisive, zero extra tokens): the targeted harness reason's
// run count drops, and no other `harness:*` reason rises (else `shifted`: the
// runs now fail on a different harness defect). Exit 0 only on fixed/improved
// (and removed / baseline in their modes).
// Pass rate is reported
// with pooled 95% Wilson intervals and is claimable ONLY when they are disjoint.
// Attribution is recomputed from each cell's trace (`attributeFailure`), so a
// fix to the attribution rules themselves re-scores old traces too.
//
// Mechanism activity (`mechanismActivity`, same traces) answers "did the change
// run at all?". The verdict always lists the activity keys whose run count
// changed. With `--mechanism`, it counts the after-runs in which that mechanism
// fired; zero is `inert`: nothing that changed can be credited to it.
import { readFileSync } from "node:fs"
import {
  attributeFailure,
  compareActivity,
  loadTrace,
  mechanismActivity,
  runsWithMechanism,
  type ActivityDelta,
  type MechanismActivity,
} from "@reactive-agents/trace"
import {
  loadLedger,
  recordAttributionOutcome,
  saveLedger,
  type AttributionDecision,
} from "../ledger.js"
import { isMeasured } from "./report.js"
import type { H3Cell, H3Results } from "./run-h3.js"
import { intervalsDisjoint, wilson } from "./stats.js"

/** Label used for a measured cell with no trace on disk (timeout, pruned trace). */
export const NO_TRACE = "no-trace"

/** Pooled summary of one arm over the targeted cells. */
export interface ArmSummary {
  readonly n: number
  readonly solved: number
  readonly rate: number
  readonly ci: { readonly lo: number; readonly hi: number }
  /** Mean billed tokens over cells that recorded them; null when none did. */
  readonly meanBilledTokens: number | null
  /** Attribution reason → run count (includes `not-failed` and `no-trace`). */
  readonly reasons: Readonly<Record<string, number>>
}

/** Output of {@link compareTargeted}. */
export interface TargetedVerdict {
  readonly reason: string
  /** Targeted cells, `tier|taskId`. */
  readonly cells: readonly string[]
  readonly before: ArmSummary
  readonly after: ArmSummary
  readonly targetBefore: number
  readonly targetAfter: number
  /** Other `harness:*` reasons whose count rose, with before/after counts. */
  readonly newHarnessReasons: Readonly<Record<string, { readonly before: number; readonly after: number }>>
  readonly passRateDeltaPp: number
  readonly passRateResolvable: boolean
  readonly tokenDeltaPct: number | null
  /** Activity keys whose run count changed between the arms, largest change first. */
  readonly activityChanged: readonly ActivityDelta[]
  /** Present with `--mechanism`: after-runs in which it fired, of `after.n`. */
  readonly mechanism?: { readonly key: string; readonly firedAfter: number; readonly firedBefore: number }
  readonly decision: AttributionDecision
  readonly rationale: string
}

/** Activity inputs for {@link compareTargeted}. */
export interface ActivityInput {
  /** Activity of a measured cell (empty when it has no trace). */
  readonly of: (c: H3Cell) => MechanismActivity
  /** The mechanism under test (an activity key or fragment). */
  readonly mechanism?: string
}

const NO_ACTIVITY: ActivityInput = { of: () => new Set() }

/** Declares the fix under test a removal (`--removal`); see the file header. */
export interface RemovalInput {
  /** Net source lines changed by the removal (negative = less code); optional complexity evidence. */
  readonly locDelta?: number
}

const cellKey = (c: H3Cell): string => `${c.tier}|${c.taskId}${c.variant === "ra-default" ? "" : `@${c.variant}`}`

function summarize(cells: readonly H3Cell[], reasonOf: (c: H3Cell) => string): ArmSummary {
  const measured = cells.filter(isMeasured)
  const solved = measured.filter((c) => c.solved).length
  const reasons: Record<string, number> = {}
  for (const c of measured) {
    const r = reasonOf(c)
    reasons[r] = (reasons[r] ?? 0) + 1
  }
  const billed = measured.flatMap((c) => (c.billedTokens == null ? [] : [c.billedTokens]))
  return {
    n: measured.length,
    solved,
    rate: measured.length ? solved / measured.length : 0,
    ci: wilson(solved, measured.length),
    meanBilledTokens: billed.length ? billed.reduce((a, b) => a + b, 0) / billed.length : null,
    reasons,
  }
}

/**
 * Pure verdict over two cell sets. `reasonOf` returns the attribution reason of
 * a measured cell (or {@link NO_TRACE}); the CLI computes it from the traces.
 */
export function compareTargeted(
  beforeAll: readonly H3Cell[],
  after: readonly H3Cell[],
  reason: string,
  reasonOf: (c: H3Cell) => string,
  activity: ActivityInput = NO_ACTIVITY,
  removal?: RemovalInput,
): TargetedVerdict {
  const keys = new Set(after.map(cellKey))
  const before = beforeAll.filter((c) => keys.has(cellKey(c)))
  const actBefore = before.filter(isMeasured).map(activity.of)
  const actAfter = after.filter(isMeasured).map(activity.of)
  const activityChanged = compareActivity(actBefore, actAfter).changed
  const mechanism =
    activity.mechanism === undefined
      ? undefined
      : {
          key: activity.mechanism,
          firedBefore: runsWithMechanism(actBefore, activity.mechanism),
          firedAfter: runsWithMechanism(actAfter, activity.mechanism),
        }
  const b = summarize(before, reasonOf)
  const a = summarize(after, reasonOf)
  const targetBefore = b.reasons[reason] ?? 0
  const targetAfter = a.reasons[reason] ?? 0

  const newHarnessReasons: Record<string, { before: number; after: number }> = {}
  for (const [r, n] of Object.entries(a.reasons)) {
    if (r === reason || !r.startsWith("harness:")) continue
    const was = b.reasons[r] ?? 0
    if (n > was) newHarnessReasons[r] = { before: was, after: n }
  }

  const passRateDeltaPp = (a.rate - b.rate) * 100
  const passRateResolvable = b.n > 0 && a.n > 0 && intervalsDisjoint(a.ci, b.ci)
  const tokenDeltaPct =
    a.meanBilledTokens != null && b.meanBilledTokens != null && b.meanBilledTokens > 0
      ? ((a.meanBilledTokens - b.meanBilledTokens) / b.meanBilledTokens) * 100
      : null

  const regressedNew = Object.keys(newHarnessReasons).length > 0
  const regressedRate = passRateResolvable && passRateDeltaPp < 0
  const dropped = targetAfter < targetBefore
  const inert = removal === undefined && mechanism !== undefined && mechanism.firedAfter === 0
  // Removal: "less" is billed tokens down or fewer source lines; the removed mechanism must be gone.
  const stillFires = removal !== undefined && mechanism !== undefined && mechanism.firedAfter > 0
  const less =
    (tokenDeltaPct !== null && tokenDeltaPct < 0) || (removal?.locDelta !== undefined && removal.locDelta < 0)
  const decision: AttributionDecision =
    removal !== undefined
      ? regressedRate || regressedNew || targetAfter > targetBefore
        ? "regressed"
        : !stillFires && less
          ? "removed"
          : "no-change"
      : inert
        ? "inert"
        : regressedRate || targetAfter > targetBefore
          ? "regressed"
          : dropped && regressedNew
            ? "shifted"
            : dropped && targetAfter === 0
              ? "fixed"
              : dropped
                ? "improved"
                : "no-change"

  const rate = `pass ${b.solved}/${b.n} → ${a.solved}/${a.n} (${passRateDeltaPp >= 0 ? "+" : ""}${passRateDeltaPp.toFixed(0)}pp, ${passRateResolvable ? "RESOLVABLE" : "within noise"})`
  const extra = regressedNew
    ? `; new harness reasons: ${Object.entries(newHarnessReasons).map(([r, v]) => `${r} ${v.before}→${v.after}`).join(", ")}`
    : ""
  const missing = targetBefore === 0 ? `; ${reason} absent from the baseline cells (wrong target?)` : ""
  const firedNote = inert
    ? " (never ran: no delta is creditable to it)"
    : stillFires
      ? " (still fires: the removal did not land)"
      : removal !== undefined && mechanism !== undefined
        ? " (gone, as a removal expects)"
        : ""
  const fired = mechanism
    ? ` · mechanism ${mechanism.key} fired ${mechanism.firedBefore}/${b.n} → ${mechanism.firedAfter}/${a.n}${firedNote}`
    : ""
  const removalNote =
    removal === undefined
      ? ""
      : ` · removal: tokens ${tokenDeltaPct === null ? "unbilled" : `${tokenDeltaPct >= 0 ? "+" : ""}${tokenDeltaPct.toFixed(1)}%`}, loc ${removal.locDelta ?? "n/a"}${less ? "" : " (nothing got smaller)"}`
  const changedKeys = activityChanged.slice(0, 6).map((d) => `${d.key} ${d.before}/${b.n}→${d.after}/${a.n}`)
  const act = changedKeys.length > 0 ? `\n  activity changed: ${changedKeys.join("; ")}` : "\n  activity changed: none"
  // A removal does not need its reason in the baseline: the claim is "same or better with less".
  const missingNote = removal === undefined ? missing : ""
  const rationale = `${decision.toUpperCase()} · ${reason} ${targetBefore}→${targetAfter} · ${rate}${fired}${removalNote}${extra}${missingNote}${act}`

  return {
    reason,
    cells: [...keys].sort(),
    before: b,
    after: a,
    targetBefore,
    targetAfter,
    newHarnessReasons,
    passRateDeltaPp,
    passRateResolvable,
    tokenDeltaPct,
    activityChanged,
    ...(mechanism ? { mechanism } : {}),
    decision,
    rationale,
  }
}

/**
 * Re-label a comparison as a baseline refresh (`--baseline`): the counts and
 * rationale are kept for the record, the decision is `baseline`, so the
 * ledger records a new before-point instead of a rejected fix.
 */
export function asBaseline(v: TargetedVerdict): TargetedVerdict {
  return { ...v, decision: "baseline", rationale: `BASELINE · ${v.rationale.slice(v.rationale.indexOf("·") + 2)}` }
}

/** Mechanism activity per cell, read from its trace (zero tokens; empty without a trace). */
export async function activityFromTraces(cells: readonly H3Cell[]): Promise<Map<H3Cell, MechanismActivity>> {
  const out = new Map<H3Cell, MechanismActivity>()
  for (const c of cells) {
    const act: MechanismActivity = c.traceFile
      ? await loadTrace(c.traceFile).then(mechanismActivity, () => new Set<string>())
      : new Set<string>()
    out.set(c, act)
  }
  return out
}

/** Attribution reason per cell, read from its trace (zero tokens). */
export async function reasonsFromTraces(cells: readonly H3Cell[]): Promise<Map<H3Cell, string>> {
  const out = new Map<H3Cell, string>()
  for (const c of cells) {
    if (!c.traceFile) {
      out.set(c, NO_TRACE)
      continue
    }
    const r: string = await loadTrace(c.traceFile).then(
      (t) => attributeFailure(t).reason,
      () => NO_TRACE,
    )
    out.set(c, r)
  }
  return out
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const cellsOf = (files: string): H3Cell[] =>
  files
    .split(",")
    .filter((f) => f.length > 0)
    .flatMap((f) => (JSON.parse(readFileSync(f, "utf8")) as H3Results).cells)

if (import.meta.main) {
  const beforeArg = arg("before")
  const afterArg = arg("after")
  const reason = arg("reason")
  if (!beforeArg || !afterArg || !reason) {
    console.error(
      "usage: --before <results.json,...> --after <results.json,...> --reason harness:<r> [--mechanism <key>] [--json] [--baseline] [--removal [--loc-delta -N]] [--ledger <path> --weakness <t> --hypothesis <t>]",
    )
    process.exit(2)
  }
  const before = cellsOf(beforeArg)
  const after = cellsOf(afterArg)
  const reasons = await reasonsFromTraces([...before, ...after])
  const activity = await activityFromTraces([...before, ...after])
  const mechanismArg = arg("mechanism")
  const locArg = arg("loc-delta")
  const removal: RemovalInput | undefined = process.argv.includes("--removal")
    ? locArg !== undefined && Number.isFinite(Number(locArg)) ? { locDelta: Number(locArg) } : {}
    : undefined
  const compared = compareTargeted(
    before,
    after,
    reason,
    (c) => reasons.get(c) ?? NO_TRACE,
    {
      of: (c) => activity.get(c) ?? new Set<string>(),
      ...(mechanismArg ? { mechanism: mechanismArg } : {}),
    },
    removal,
  )
  // A baseline refresh measures the new before-point; it is never a fix under test.
  const v: TargetedVerdict = process.argv.includes("--baseline") ? asBaseline(compared) : compared
  console.log(process.argv.includes("--json") ? JSON.stringify(v, null, 2) : v.rationale)

  const ledgerPath = arg("ledger")
  if (ledgerPath) {
    const ledger = await loadLedger(ledgerPath)
    const updated = recordAttributionOutcome(ledger, {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      weakness: arg("weakness") ?? reason,
      hypothesis: arg("hypothesis") ?? "(not given)",
      variantId: after[0]?.variant ?? "ra-default",
      decision: v.decision,
      passRateDeltaPp: v.passRateDeltaPp,
      tokenDeltaPct: v.tokenDeltaPct,
      rationale: v.rationale,
      attribution: {
        reason,
        before: v.targetBefore,
        after: v.targetAfter,
        newHarnessReasons: Object.keys(v.newHarnessReasons),
        passRateResolvable: v.passRateResolvable,
        cells: v.cells,
      },
    })
    await saveLedger(ledgerPath, updated)
    console.error(`[verdict] recorded to ${ledgerPath} (${updated.entries.length} entries)`)
  }
  // 0 = success (fixed / improved / removed / baseline recorded); 1 = anything else, so a script can gate on it.
  const ok: readonly AttributionDecision[] = ["fixed", "improved", "removed", "baseline"]
  process.exit(ok.includes(v.decision) ? 0 : 1)
}
