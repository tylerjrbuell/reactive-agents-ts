// Run: bun test packages/tools/tests/execution/docker-sandbox-seccomp-fail-closed.test.ts --timeout 15000
//
// A missing seccomp profile used to be treated as "no profile": the Docker
// sandbox ran without syscall filtering and nothing said so (every npm install of
// 0.19.0, whose dist lacked sandbox-image/). resolveSeccompProfile now fails
// closed; `useSeccomp: false` stays the explicit opt-out.
//
// RED-ON-CUT: make the missing-file branch return Effect.succeed(null) and the
// fail-closed test fails.
import { describe, it, expect } from "bun:test";
import { Effect, Either } from "effect";
import { join } from "node:path";
import { getSeccompProfilePath, resolveSeccompProfile } from "../../src/execution/docker-sandbox.js";

describe("resolveSeccompProfile (fail closed)", () => {
  it("fails with a ToolExecutionError naming the path when the profile is missing", async () => {
    const missing = join(import.meta.dir, "no-such-dir", "seccomp-sandbox.json");
    const result = await Effect.runPromise(Effect.either(resolveSeccompProfile(true, missing)));
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("ToolExecutionError");
      expect(result.left.message).toContain(missing);
      expect(result.left.message).toContain("useSeccomp: false");
    }
  });

  it("resolves the profile path when the file exists", async () => {
    const path = getSeccompProfilePath();
    expect(await Effect.runPromise(resolveSeccompProfile(true, path))).toBe(path);
  });

  it("useSeccomp: false is the explicit opt-out (no profile, no failure)", async () => {
    const missing = join(import.meta.dir, "no-such-dir", "seccomp-sandbox.json");
    expect(await Effect.runPromise(resolveSeccompProfile(false, missing))).toBeNull();
  });
});
