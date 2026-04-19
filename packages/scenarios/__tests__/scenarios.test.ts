import { test, expect } from "bun:test"
import { allScenarios, loopProneHaiku, schemaDriftSql } from "../src/index"

test("all scenarios have required fields", () => {
  for (const s of allScenarios) {
    expect(s.id).toBeTruthy()
    expect(s.task.length).toBeGreaterThan(10)
    expect(s.tags.length).toBeGreaterThan(0)
    expect(s.preferredModels.length).toBeGreaterThan(0)
  }
})

test("loopProneHaiku successCriteria detects 3-line output", () => {
  expect(loopProneHaiku.successCriteria("waves crash\nsilent shore awaits\nocean breathes")).toBe(true)
  expect(loopProneHaiku.successCriteria("not a haiku")).toBe(false)
})

test("schemaDriftSql successCriteria detects valid SQL", () => {
  expect(schemaDriftSql.successCriteria("SELECT * FROM users WHERE created_at > NOW() - INTERVAL 7 DAY")).toBe(true)
  expect(schemaDriftSql.successCriteria("I don't know SQL")).toBe(false)
})
