// Loads skill content from `.agents/skills/<skillName>/SKILL.md`
// Falls back to null if not found — handler returns applied:false in that case.
import { readFile } from "node:fs/promises"
import { join } from "node:path"

export async function loadSkillContent(skillName: string): Promise<string | null> {
  const base = process.cwd()
  const candidates = [
    join(base, ".agents", "skills", skillName, "SKILL.md"),
    join(base, ".agents", "skills", skillName, "README.md"),
  ]
  for (const path of candidates) {
    try {
      return await readFile(path, "utf8")
    } catch {
      // not found at this path — try next
    }
  }
  return null
}
