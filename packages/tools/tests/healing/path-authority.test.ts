import { describe, it, expect } from "bun:test"
import { Effect } from "effect"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"

import { resolvePaths } from "../../src/healing/path-resolver.js"
import {
  withFileRoot,
  fileReadHandler,
  fileWriteHandler,
} from "../../src/skills/file-operations.js"

// F9 (09-UNIFIED-PROGRAM.md §6.6) — "agent writes and reads the file
// successfully, then the run is reported FAILED". Root cause: the healer ran
// BEFORE file-write/file-read executed and silently rewrote an out-of-root
// absolute path argument to `<root>/<basename>`. The tool then succeeded at
// the REWRITTEN path while terminal verification checked the path the model
// originally referenced, reporting failure next to a correctly-written file.
//
// file-operations.ts's `Path traversal detected:` throw is the sole
// confinement authority now. These tests pin that end-to-end.

describe("F9 — one path authority (healer no longer pre-empts the tool's throw)", () => {
  it("out-of-root absolute path: healer passes it through, and the tool throws (not a silent remap-and-succeed)", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tools-root-"))
    const outside = "/definitely/not/inside/tmp/report.md"

    // Healing stage: must not rewrite the argument.
    const healed = resolvePaths("file-write", { path: outside, content: "hello" }, new Set(["file-write"]), tmp)
    expect(healed.healed.path).toBe(outside)

    // Execution stage: the tool — the sole confinement authority — must throw.
    await withFileRoot(tmp, async () => {
      const result = await Effect.runPromiseExit(
        fileWriteHandler({ path: healed.healed.path, content: "hello" }),
      )
      expect(result._tag).toBe("Failure")
    })

    // No file should have been created inside tmp under the basename — that
    // was exactly the silent-rescue behavior this fix removes.
    const remapped = path.join(tmp, path.basename(outside))
    const remappedExists = await fs.stat(remapped).then(
      () => true,
      () => false,
    )
    expect(remappedExists).toBe(false)

    await fs.rm(tmp, { recursive: true, force: true })
  })

  it("relative path inside root: write then read the SAME path the model referenced — no divergence", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tools-root-"))
    const relativePath = "output/report.md"
    const content = "the deliverable"

    await withFileRoot(tmp, async () => {
      const healedWrite = resolvePaths(
        "file-write",
        { path: relativePath, content },
        new Set(["file-write"]),
        tmp,
      )
      const writeResult = await Effect.runPromise(
        fileWriteHandler({ path: healedWrite.healed.path as string, content }),
      )
      expect((writeResult as { written: boolean }).written).toBe(true)

      // The model's original relative path — unmodified by the write path's
      // own resolution — is the path it will reference again on read.
      const healedRead = resolvePaths(
        "file-read",
        { path: relativePath },
        new Set(["file-read"]),
        tmp,
      )
      const readContent = await Effect.runPromise(
        fileReadHandler({ path: healedRead.healed.path as string }),
      )
      expect(readContent).toBe(content)

      // The path the model referenced (relative) resolves to the same
      // absolute location that was actually written — no silent divergence.
      expect(healedWrite.healed.path).toBe(healedRead.healed.path)
      expect(healedWrite.healed.path).toBe(path.join(tmp, relativePath))
    })

    await fs.rm(tmp, { recursive: true, force: true })
  })

  it("relative traversal escape (`../../etc/passwd`) still throws under the default root", async () => {
    const result = await Effect.runPromiseExit(fileWriteHandler({ path: "../../etc/passwd", content: "x" }))
    expect(result._tag).toBe("Failure")
  })

  it("relative traversal escape still throws under a withFileRoot root", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tools-root-"))
    await withFileRoot(tmp, async () => {
      const result = await Effect.runPromiseExit(
        fileWriteHandler({ path: "../../../etc/passwd", content: "x" }),
      )
      expect(result._tag).toBe("Failure")
    })
    await fs.rm(tmp, { recursive: true, force: true })
  })
})
