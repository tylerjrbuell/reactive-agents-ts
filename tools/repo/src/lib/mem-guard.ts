import { readFileSync, statfsSync } from "node:fs"

/**
 * Memory pressure guard for heavy commands (`repo test`, `repo verify`, `repo ci`). Refuses to start
 * when the machine is already near an OOM kill; warns before that. Thresholds are fixed constants: a
 * knob that lowers them would be a bypass. Linux only (`/proc/meminfo`); elsewhere the guard is silent.
 */

const GB = 1024 ** 3
/** Warn below this MemAvailable. */
export const MEM_WARN_BYTES = 3 * GB
/** Refuse below this MemAvailable. */
export const MEM_REFUSE_BYTES = 1 * GB
/** Warn above this fraction of a tmpfs temp dir in use. */
export const TMP_WARN_FRAC = 0.5
/** Refuse above this fraction of a tmpfs temp dir in use (after the janitor ran). */
export const TMP_REFUSE_FRAC = 0.8
const TMPFS_MAGIC = 0x01021994

/** MemAvailable in bytes from `/proc/meminfo` text, or undefined. */
export function parseMemAvailable(meminfo: string): number | undefined {
  const m = /^MemAvailable:\s+(\d+)\s+kB/m.exec(meminfo)
  return m === null ? undefined : Number(m[1]) * 1024
}

/** Machine readings. `undefined` = not measurable here. */
export interface Pressure {
  memAvailableBytes?: number
  /** Fraction used of the temp dir's filesystem; set only when it is tmpfs (RAM-backed). */
  tmpfsUsedFrac?: number
}

/** Read live pressure for the filesystem holding `tmpDir`. Never throws. */
export function readPressure(tmpDir: string): Pressure {
  const p: Pressure = {}
  try {
    p.memAvailableBytes = parseMemAvailable(readFileSync("/proc/meminfo", "utf8"))
  } catch {
    // not Linux
  }
  try {
    const s = statfsSync(tmpDir)
    if (s.type === TMPFS_MAGIC && s.blocks > 0) p.tmpfsUsedFrac = 1 - s.bavail / s.blocks
  } catch {
    // unreadable: skip
  }
  return p
}

/** Guard verdict. `lines` are printable; `refuse` means do not start. */
export interface Verdict {
  level: "ok" | "warn" | "refuse"
  lines: string[]
}

/** Pure decision over readings. */
export function assessPressure(p: Pressure): Verdict {
  const lines: string[] = []
  let level: Verdict["level"] = "ok"
  const raise = (l: "warn" | "refuse"): void => {
    if (l === "refuse" || level === "ok") level = l
  }
  const gb = (n: number): string => (n / GB).toFixed(1)
  if (p.memAvailableBytes !== undefined) {
    if (p.memAvailableBytes < MEM_REFUSE_BYTES) {
      raise("refuse")
      lines.push(`MemAvailable ${gb(p.memAvailableBytes)} GB < ${gb(MEM_REFUSE_BYTES)} GB`)
    } else if (p.memAvailableBytes < MEM_WARN_BYTES) {
      raise("warn")
      lines.push(`MemAvailable ${gb(p.memAvailableBytes)} GB < ${gb(MEM_WARN_BYTES)} GB`)
    }
  }
  if (p.tmpfsUsedFrac !== undefined) {
    const pct = Math.round(p.tmpfsUsedFrac * 100)
    if (p.tmpfsUsedFrac > TMP_REFUSE_FRAC) {
      raise("refuse")
      lines.push(`RAM-backed temp dir ${pct}% full`)
    } else if (p.tmpfsUsedFrac > TMP_WARN_FRAC) {
      raise("warn")
      lines.push(`RAM-backed temp dir ${pct}% full`)
    }
  }
  return { level, lines }
}
