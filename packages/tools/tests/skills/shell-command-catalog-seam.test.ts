/**
 * Seam pin: the shell command catalog is public from the package index, so
 * apps building shell-permission UIs read it instead of copying it.
 */
import { describe, expect, test } from "bun:test";
import {
  COMMAND_CAPABILITY_MAP,
  DEFAULT_ALLOWED_COMMANDS,
  OPT_IN_COMMANDS,
  resolveCommandAccess,
} from "../../src/index.js";
import * as catalog from "../../src/skills/shell-command-catalog.js";
import * as shell from "../../src/skills/shell-execution.js";

describe("shell-command-catalog seam", () => {
  test("package index exports the catalog module's own symbols", () => {
    expect(COMMAND_CAPABILITY_MAP).toBe(catalog.COMMAND_CAPABILITY_MAP);
    expect(DEFAULT_ALLOWED_COMMANDS).toBe(catalog.DEFAULT_ALLOWED_COMMANDS);
    expect(OPT_IN_COMMANDS).toBe(catalog.OPT_IN_COMMANDS);
    expect(resolveCommandAccess).toBe(catalog.resolveCommandAccess);
  });

  test("shell-execution re-exports the same catalog for existing importers", () => {
    expect(shell.COMMAND_CAPABILITY_MAP).toBe(catalog.COMMAND_CAPABILITY_MAP);
    expect(shell.DEFAULT_ALLOWED_COMMANDS).toBe(catalog.DEFAULT_ALLOWED_COMMANDS);
    expect(shell.OPT_IN_COMMANDS).toBe(catalog.OPT_IN_COMMANDS);
    expect(shell.resolveCommandAccess).toBe(catalog.resolveCommandAccess);
  });

  test("resolveCommandAccess expands the javascript group", () => {
    expect(resolveCommandAccess({ capabilities: ["javascript"] })).toEqual([
      "node",
      "bun",
      "npm",
      "npx",
    ]);
  });

  test("resolveCommandAccess dedupes groups and explicit commands; no config grants nothing", () => {
    expect(
      resolveCommandAccess({ capabilities: ["github", "web"], commands: ["gh", "stripe"] }),
    ).toEqual(["gh", "curl", "stripe"]);
    expect(resolveCommandAccess()).toEqual([]);
  });

  test("no capability-group command is already in the default allow-list", () => {
    const defaults = new Set(DEFAULT_ALLOWED_COMMANDS);
    for (const commands of Object.values(COMMAND_CAPABILITY_MAP)) {
      for (const command of commands) expect(defaults.has(command)).toBe(false);
    }
  });
});
