/**
 * weakness-queue — rank the harness's weaknesses from a SessionReport so every
 * improvement pass starts aimed at the highest-value target.
 *
 * Feedback-loop amplification (2026-07-07): the bench already captures scores,
 * per-run diagnosis, honesty labels, trust verdicts, and error evidence — but
 * they lived in separate JSON branches nobody aggregated. This module folds a
 * report into a ranked queue of (weakness, evidence, suggested probe) rows.
 *
 * Usage:
 *   bun run src/weakness-queue.ts <report.json> [--variant ra-full] [--top 10]
 *
 * Ranking model (deterministic, documented):
 *   severity = gapVsBest * 0.5 + failureRate * 0.3 + dishonestyRate * 0.2
 * where gapVsBest = best-variant accuracy − target-variant accuracy per task
 * (how much headroom the task has proven exists), failureRate = share of the
 * target's runs that errored/timed out, dishonestyRate = share labeled
 * dishonest-success-suspected or claimed-success (unverified).
 */
import { readFileSync } from "node:fs"

interface RunRow {
    readonly status?: string
    readonly output?: string
    readonly durationMs?: number
    readonly tokensUsed?: number
    readonly dimensions?: ReadonlyArray<{ dimension: string; score: number; evidence?: string }>
    readonly diagnosis?: { honestyLabel?: string; failureModes?: readonly string[] }
    readonly trust?: string
    readonly traceId?: string
}

interface TaskVariantRow {
    readonly taskId: string
    readonly modelVariantId: string
    readonly variantId: string
    readonly runs: ReadonlyArray<RunRow>
    readonly meanScores: ReadonlyArray<{ dimension: string; score: number }>
}

export interface WeaknessRow {
    readonly taskId: string
    readonly model: string
    readonly severity: number
    readonly accuracy: number
    readonly bestVariant: string
    readonly bestAccuracy: number
    readonly failureRate: number
    readonly dishonestyRate: number
    readonly failureModes: readonly string[]
    readonly evidence: readonly string[]
    readonly traceIds: readonly string[]
}

const DISHONEST = new Set(["dishonest-success-suspected", "claimed-success (unverified)"])

export function buildWeaknessQueue(
    report: { taskReports?: ReadonlyArray<TaskVariantRow> },
    target = "ra-full",
): WeaknessRow[] {
    const rows = report.taskReports ?? []
    const byTaskModel = new Map<string, TaskVariantRow[]>()
    for (const r of rows) {
        const key = `${r.taskId}::${r.modelVariantId}`
        const list = byTaskModel.get(key) ?? []
        list.push(r)
        byTaskModel.set(key, list)
    }

    const out: WeaknessRow[] = []
    for (const [key, variants] of byTaskModel) {
        const [taskId, model] = key.split("::") as [string, string]
        const mine = variants.find((v) => v.variantId === target)
        if (!mine) continue
        const acc = (v: TaskVariantRow) =>
            v.meanScores.find((s) => s.dimension === "accuracy")?.score ?? 0
        const best = [...variants].sort((a, b) => acc(b) - acc(a))[0]!
        const myAcc = acc(mine)
        const gap = Math.max(0, acc(best) - myAcc)
        const runs = mine.runs
        const failures = runs.filter((r) => r.status === "error").length
        const dishonest = runs.filter((r) => DISHONEST.has(r.diagnosis?.honestyLabel ?? "")).length
        const failureRate = runs.length ? failures / runs.length : 0
        const dishonestyRate = runs.length ? dishonest / runs.length : 0
        const severity = gap * 0.5 + failureRate * 0.3 + dishonestyRate * 0.2
        if (severity === 0) continue
        out.push({
            taskId,
            model,
            severity: Number(severity.toFixed(3)),
            accuracy: myAcc,
            bestVariant: best.variantId,
            bestAccuracy: acc(best),
            failureRate,
            dishonestyRate,
            failureModes: [
                ...new Set(runs.flatMap((r) => r.diagnosis?.failureModes ?? [])),
            ],
            evidence: runs
                .map((r) => r.dimensions?.find((d) => d.dimension === "accuracy")?.evidence)
                .filter((e): e is string => typeof e === "string" && e.length > 0)
                .map((e) => e.slice(0, 160)),
            traceIds: runs.map((r) => r.traceId).filter((t): t is string => !!t),
        })
    }
    return out.sort((a, b) => b.severity - a.severity)
}

if (import.meta.main) {
    const [reportPath, ...rest] = process.argv.slice(2)
    if (!reportPath) {
        console.error("usage: bun run src/weakness-queue.ts <report.json> [--variant ra-full] [--top 10]")
        process.exit(1)
    }
    const variantIdx = rest.indexOf("--variant")
    const topIdx = rest.indexOf("--top")
    const target = variantIdx >= 0 ? rest[variantIdx + 1]! : "ra-full"
    const top = topIdx >= 0 ? parseInt(rest[topIdx + 1]!, 10) : 10
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as Parameters<typeof buildWeaknessQueue>[0]
    const queue = buildWeaknessQueue(report, target).slice(0, top)
    if (queue.length === 0) {
        console.log(`No weaknesses found for variant "${target}" (all cells at parity or better).`)
        process.exit(0)
    }
    console.log(`Weakness queue for ${target} (severity = gap*0.5 + failures*0.3 + dishonesty*0.2):\n`)
    for (const w of queue) {
        console.log(
            `  ${w.severity.toFixed(2)}  ${w.taskId} @ ${w.model} — acc ${(w.accuracy * 100).toFixed(0)}% vs best ${w.bestVariant} ${(w.bestAccuracy * 100).toFixed(0)}%` +
            (w.failureRate ? ` | failures ${(w.failureRate * 100).toFixed(0)}%` : "") +
            (w.dishonestyRate ? ` | dishonest ${(w.dishonestyRate * 100).toFixed(0)}%` : ""),
        )
        for (const fm of w.failureModes) console.log(`        fm: ${fm}`)
        for (const e of w.evidence.slice(0, 2)) console.log(`        ev: ${e}`)
        for (const t of w.traceIds.slice(0, 2)) console.log(`        trace: ${t}`)
        console.log(`        probe: bun run src/run.ts --session <session> --task ${w.taskId} --variant ${"ra-full"} --runs 1 --output /tmp/claude-1000/${w.taskId}-verify.json`)
    }
}
