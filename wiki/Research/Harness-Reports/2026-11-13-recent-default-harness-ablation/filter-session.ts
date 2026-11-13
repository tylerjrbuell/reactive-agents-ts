// Scratch: keep only the given taskIds in a SessionReport. bun run filter-session.ts <in> <out> <id,id>
import { readFileSync, writeFileSync } from "node:fs"
const [inP, outP, ids] = process.argv.slice(2) as [string, string, string]
const keep = new Set(ids.split(","))
const s = JSON.parse(readFileSync(inP, "utf8")) as { taskReports: Array<{ taskId: string }> }
s.taskReports = s.taskReports.filter((t) => keep.has(t.taskId))
writeFileSync(outP, JSON.stringify(s, null, 2))
console.log("kept", s.taskReports.length)
