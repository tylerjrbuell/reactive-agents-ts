// Seam pin: shell-execute carries its allowed commands as typed metadata
// derived from the real allowlist, and PATH availability is computed by the
// framework (cached, no model, no spawn) instead of a planner step.
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";

import { shellExecuteToolFor } from "../../src/skills/shell-execute-definition.js";
import { DEFAULT_ALLOWED_COMMANDS, OPT_IN_COMMANDS } from "../../src/skills/shell-command-catalog.js";
import {
  clearCommandAvailabilityCache,
  isCommandOnPath,
  shellCommandAvailability,
} from "../../src/skills/shell-command-availability.js";
import { validateToolInput } from "../../src/validation/input-validator.js";

const prevSandbox = process.env.RA_SANDBOX;
afterEach(() => {
  if (prevSandbox === undefined) delete process.env.RA_SANDBOX;
  else process.env.RA_SANDBOX = prevSandbox;
  clearCommandAvailabilityCache();
});

describe("shell-execute commandPolicy", () => {
  test("default config: allowed = DEFAULT_ALLOWED_COMMANDS, opt-ins listed as not enabled", () => {
    delete process.env.RA_SANDBOX;
    const policy = shellExecuteToolFor().commandPolicy;
    expect(policy?.allowedCommands).toEqual([...DEFAULT_ALLOWED_COMMANDS]);
    expect(policy?.notEnabledCommands).toEqual([...OPT_IN_COMMANDS]);
    expect(policy?.sandbox).toBe("host");
  });

  test("granted commands move from notEnabled to allowed, same as the description", () => {
    delete process.env.RA_SANDBOX;
    const def = shellExecuteToolFor({ additionalCommands: ["gh", "node"] });
    expect(def.commandPolicy?.allowedCommands).toContain("gh");
    expect(def.commandPolicy?.allowedCommands).toContain("node");
    expect(def.commandPolicy?.notEnabledCommands).not.toContain("node");
    for (const c of def.commandPolicy?.allowedCommands ?? []) {
      expect(def.description).toContain(c);
    }
  });

  test("docker sandbox is reported and workingDirectory states the location", () => {
    const def = shellExecuteToolFor({ sandbox: "docker" });
    expect(def.commandPolicy?.sandbox).toBe("docker");
    expect(def.commandPolicy?.workingDirectory).toContain("Docker");
  });
});

describe("shell command availability", () => {
  test("splits allowed commands by PATH presence, and caches the answer", () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-avail-"));
    const bin = join(dir, "fakegh");
    writeFileSync(bin, "#!/bin/sh\n");
    chmodSync(bin, 0o755);
    const policy = { allowedCommands: ["fakegh", "definitely-not-installed-xyz"] };
    const r = shellCommandAvailability(policy, dir);
    expect(r.available).toEqual(["fakegh"]);
    expect(r.missing).toEqual(["definitely-not-installed-xyz"]);

    // cached: removing exec permission does not change the memoized answer
    chmodSync(bin, 0o644);
    expect(isCommandOnPath("fakegh", dir)).toBe(true);
    clearCommandAvailabilityCache();
    expect(isCommandOnPath("fakegh", dir)).toBe(false);
  });

  test("no command policy yields empty lists", () => {
    expect(shellCommandAvailability(undefined)).toEqual({ available: [], missing: [] });
  });
});

describe("missing-parameter error text", () => {
  test("shell-execute with {} names the parameter and shows a valid example call", async () => {
    const def = shellExecuteToolFor();
    const err = await Effect.runPromise(Effect.flip(validateToolInput(def, {})));
    expect(err.message).toContain('Missing required parameter "command"');
    expect(err.message).toContain('Valid call: shell-execute({"command":"git log --oneline -5"})');
  });

  test("tool without a literal example falls back to a placeholder", async () => {
    const err = await Effect.runPromise(
      Effect.flip(
        validateToolInput(
          {
            name: "t",
            description: "d",
            parameters: [
              { name: "query", type: "string", description: "q", required: true },
              { name: "limit", type: "number", description: "n", required: false },
            ],
            riskLevel: "low",
            timeoutMs: 1,
            requiresApproval: false,
            source: "function",
          },
          {},
        ),
      ),
    );
    expect(err.message).toContain('Valid call: t({"query":"<query>"})');
  });
});
