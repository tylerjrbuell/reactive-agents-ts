import { readFileSync, statfsSync } from "node:fs"

/**
 * Memory pressure guard for heavy commands (`repo test`, `repo verify`, `repo ci`, `repo guard` before
 * builds, probes and benches). Refuses to start when the machine is already near an OOM kill (low
 * MemAvailable, exhausted swap, full RAM-backed temp); warns before that. Thresholds are fixed constants: a
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

/**
 * Swap rules. MemAvailable alone missed the 2026-11-19 OOM kill: it read ~17 GB while swap (zram, so
 * itself RAM) was 8.0/8.0 GB full, and the next spike went straight to the OOM killer. Swap this full
 * means nothing is left to absorb a spike, whatever MemAvailable says.
 */
/** Warn above this fraction of swap in use when MemAvailable is below `SWAP_WARN_MEM_BYTES`. */
export const SWAP_WARN_FRAC = 0.9
/** MemAvailable below which a mostly-full swap warns. */
export const SWAP_WARN_MEM_BYTES = 6 * GB
/** Above this fraction swap counts as exhausted: warn at any MemAvailable. */
export const SWAP_FULL_FRAC = 0.97
/** Refuse when swap is exhausted and MemAvailable is below this. */
export const SWAP_REFUSE_MEM_BYTES = 3 * GB

/** A `/proc/meminfo` field in bytes, or undefined. */
function meminfoField(meminfo: string, field: string): number | undefined {
  const m = new RegExp(`^${field}:\\s+(\\d+)\\s+kB`, "m").exec(meminfo)
  return m === null ? undefined : Number(m[1]) * 1024
}

/** MemAvailable in bytes from `/proc/meminfo` text, or undefined. */
export function parseMemAvailable(meminfo: string): number | undefined {
  return meminfoField(meminfo, "MemAvailable")
}

/** The memory readings `/proc/meminfo` text gives: MemAvailable and, when swap exists, swap used. */
export function parseMeminfo(meminfo: string): Pick<Pressure, "memAvailableBytes" | "swapUsedFrac"> {
  const p: Pick<Pressure, "memAvailableBytes" | "swapUsedFrac"> = {}
  const avail = parseMemAvailable(meminfo)
  if (avail !== undefined) p.memAvailableBytes = avail
  const total = meminfoField(meminfo, "SwapTotal")
  const free = meminfoField(meminfo, "SwapFree")
  if (total !== undefined && free !== undefined && total > 0) p.swapUsedFrac = 1 - free / total
  return p
}

/** Machine readings. `undefined` = not measurable here. */
export interface Pressure {
  memAvailableBytes?: number
  /** Fraction of swap in use; unset when there is no swap. */
  swapUsedFrac?: number
  /** Fraction used of the temp dir's filesystem; set only when it is tmpfs (RAM-backed). */
  tmpfsUsedFrac?: number
}

/** Read live pressure for the filesystem holding `tmpDir`. Never throws. */
export function readPressure(tmpDir: string): Pressure {
  let p: Pressure = {}
  try {
    p = parseMeminfo(readFileSync("/proc/meminfo", "utf8"))
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
  if (p.swapUsedFrac !== undefined) {
    const swap = `swap ${Math.round(p.swapUsedFrac * 100)}% full`
    const avail = p.memAvailableBytes
    if (p.swapUsedFrac > SWAP_FULL_FRAC && avail !== undefined && avail < SWAP_REFUSE_MEM_BYTES) {
      raise("refuse")
      lines.push(`${swap} and MemAvailable ${gb(avail)} GB < ${gb(SWAP_REFUSE_MEM_BYTES)} GB`)
    } else if (p.swapUsedFrac > SWAP_FULL_FRAC) {
      raise("warn")
      lines.push(`${swap} (exhausted: the next spike goes to the OOM killer)`)
    } else if (p.swapUsedFrac > SWAP_WARN_FRAC && avail !== undefined && avail < SWAP_WARN_MEM_BYTES) {
      raise("warn")
      lines.push(`${swap} and MemAvailable ${gb(avail)} GB < ${gb(SWAP_WARN_MEM_BYTES)} GB`)
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
