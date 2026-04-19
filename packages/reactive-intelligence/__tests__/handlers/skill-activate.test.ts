import { test, expect } from "bun:test"
import { Effect } from "effect"
import { skillActivateHandler } from "../../src/controller/handlers/skill-activate"

test("skips when skill is already active", async () => {
  const outcome = await Effect.runPromise(
    skillActivateHandler.execute(
      { decision: "skill-activate", skillName: "web-research", trigger: "entropy-match", confidence: "trusted" },
      { activatedSkills: [{ id: "web-research", content: "..." }] } as any,
      { iteration: 3 } as any
    )
  )
  expect(outcome.applied).toBe(false)
  expect(outcome.reason).toBe("already-active")
})

test("skips when skill content not found", async () => {
  const outcome = await Effect.runPromise(
    skillActivateHandler.execute(
      { decision: "skill-activate", skillName: "nonexistent-skill-xyz", trigger: "entropy-match", confidence: "trusted" },
      { activatedSkills: [] } as any,
      { iteration: 3 } as any
    )
  )
  expect(outcome.applied).toBe(false)
  expect(outcome.reason).toBe("skill-not-found")
})

test("injects skill content patch when skill found", async () => {
  // Write a temporary skill file, run, then clean up
  const { mkdtemp, writeFile, mkdir, rm } = await import("node:fs/promises")
  const { join } = await import("node:path")
  const { tmpdir } = await import("node:os")

  const tmp = await mkdtemp(join(tmpdir(), "rax-skill-test-"))
  const skillDir = join(tmp, ".agents", "skills", "my-skill")
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, "SKILL.md"), "# My Skill\nDo something useful.")

  const origCwd = process.cwd
  process.cwd = () => tmp

  try {
    const outcome = await Effect.runPromise(
      skillActivateHandler.execute(
        { decision: "skill-activate", skillName: "my-skill", trigger: "task-match", confidence: "expert" },
        { activatedSkills: [] } as any,
        { iteration: 2 } as any
      )
    )
    expect(outcome.applied).toBe(true)
    expect(outcome.reason).toBe("fired")
    expect(outcome.patches).toHaveLength(1)
    const patch = outcome.patches[0] as any
    expect(patch.kind).toBe("inject-skill-content")
    expect(patch.skillId).toBe("my-skill")
    expect(patch.content).toContain("My Skill")
    expect(outcome.cost.tokensEstimated).toBeGreaterThan(0)
  } finally {
    process.cwd = origCwd
    await rm(tmp, { recursive: true, force: true })
  }
})
