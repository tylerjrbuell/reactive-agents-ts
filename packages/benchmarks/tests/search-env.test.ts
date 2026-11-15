import { describe, expect, it } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { applySearchKeysFromEnvFiles, parseEnvFile, searchBackendConfigured } from "../src/search-env.js"

describe("search-env", () => {
  it("parses KEY=value, export, quotes, comments", () => {
    expect(parseEnvFile(`# c\nexport A="x y"\nB=1 # tail\nC='q'\n\nbad line`)).toEqual({ A: "x y", B: "1", C: "q" })
  })

  it("copies only unset search keys, ignores unrelated vars, returns names not values", () => {
    const dir = mkdtempSync(join(tmpdir(), "search-env-"))
    const file = join(dir, ".env")
    writeFileSync(file, "KEENABLE_API_KEY=secret-k\nTAVILY_API_KEY=file-t\nOPENAI_API_KEY=nope\n")
    const env: NodeJS.ProcessEnv = { TAVILY_API_KEY: "already" }
    const names = applySearchKeysFromEnvFiles(env, [file])
    expect(names).toEqual(["KEENABLE_API_KEY"])
    expect(env.KEENABLE_API_KEY).toBe("secret-k")
    expect(env.TAVILY_API_KEY).toBe("already")
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(searchBackendConfigured(env)).toBe(true)
    expect(searchBackendConfigured({})).toBe(false)
  })

  it("missing file is a no-op", () => {
    const env: NodeJS.ProcessEnv = {}
    expect(applySearchKeysFromEnvFiles(env, ["/nonexistent/.env"])).toEqual([])
  })
})
