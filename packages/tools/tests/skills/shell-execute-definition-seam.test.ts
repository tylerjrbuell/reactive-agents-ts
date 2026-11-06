// Seam pin: the shell-execute definition the model sees is built from the
// resolved shell config, so it states where commands really run and which
// commands are really allowed (owner report 2026-11-06: a workspace-mode shell
// was described to the model as "a sandboxed /tmp directory").
import { afterEach, describe, expect, test } from "bun:test";
import {
  shellExecuteToolFor,
  shellExecuteTool,
} from "../../src/skills/shell-execute-definition.js";
import { shellExecuteTool as publicShellExecuteTool } from "../../src/index.js";

const prevSandbox = process.env.RA_SANDBOX;
afterEach(() => {
  if (prevSandbox === undefined) delete process.env.RA_SANDBOX;
  else process.env.RA_SANDBOX = prevSandbox;
});

describe("shellExecuteToolFor — location", () => {
  test("(a) default: private temp sandbox under /tmp", () => {
    delete process.env.RA_SANDBOX;
    const d = shellExecuteToolFor().description;
    expect(d).toContain("private temporary directory under /tmp");
    expect(d).not.toContain("workspace");
    expect(d).not.toContain("Docker");
  });

  test("(b) run-workspace mode names the workspace, not a /tmp sandbox", () => {
    delete process.env.RA_SANDBOX;
    const d = shellExecuteToolFor(undefined, { runWorkspace: true }).description;
    expect(d).toContain("the run's workspace directory");
    expect(d).toContain("same root file-read and file-write use");
    expect(d).not.toContain("sandboxed /tmp directory");
    expect(d).not.toContain("confined to a temporary sandbox");
  });

  test("(b) workspace mode with a configured cwd states it relative to the workspace", () => {
    const d = shellExecuteToolFor({ cwd: "packages/app" }, { runWorkspace: true }).description;
    expect(d).toContain('"packages/app" inside the run\'s workspace directory');
  });

  test("(b) host cwd with allowUnsafeCwd states the real directory", () => {
    const d = shellExecuteToolFor({ cwd: "/home/me/project", allowUnsafeCwd: true }).description;
    expect(d).toContain("Runs in /home/me/project");
    expect(d).not.toContain("under /tmp");
  });

  test("host cwd outside /tmp without allowUnsafeCwd says every call is refused", () => {
    const d = shellExecuteToolFor({ cwd: "/home/me/project" }).description;
    expect(d).toContain("every call is refused");
  });

  test("(c) docker sandbox: throwaway container, no network, nothing persists", () => {
    const d = shellExecuteToolFor({ sandbox: "docker" }).description;
    expect(d).toContain("throwaway Docker container");
    expect(d).toContain("no network");
    expect(d).toContain("nothing persists between calls");
    expect(d).not.toContain("under /tmp");
  });

  test("(c) RA_SANDBOX=docker selects the docker description like the handler does", () => {
    process.env.RA_SANDBOX = "docker";
    expect(shellExecuteToolFor().description).toContain("throwaway Docker container");
    expect(shellExecuteToolFor({ sandbox: "host" }).description).not.toContain(
      "throwaway Docker container",
    );
  });

  test("(c) docker escalation names the interpreters whose inline code runs in a container", () => {
    delete process.env.RA_SANDBOX;
    const d = shellExecuteToolFor({
      additionalCommands: ["node", "python3"],
      dockerEscalation: { enabled: true },
    }).description;
    expect(d).toContain("Inline code for node, python3 (-e/--eval/-c) runs in an isolated Docker container");
    const off = shellExecuteToolFor({ additionalCommands: ["node"] }).description;
    expect(off).not.toContain("Inline code for");
  });
});

describe("shellExecuteToolFor — command policy", () => {
  test("(d) default lists allowed commands and the opt-ins that are NOT enabled", () => {
    const d = shellExecuteToolFor().description;
    expect(d).toContain("Allowed commands: git, ls, cat,");
    expect(d).toMatch(/Not enabled \(developer opt-in required\): node, bun, npm, npx, python, python3, curl, env, xargs, tar\./);
  });

  test("(d) additionalCommands + commandAccess opt-ins appear as allowed, not as not-enabled", () => {
    const d = shellExecuteToolFor({
      additionalCommands: ["gh"],
      commandAccess: { capabilities: ["python"] },
    }).description;
    const allowed = d.slice(d.indexOf("Allowed commands:"), d.indexOf("Not enabled"));
    expect(allowed).toContain("gh");
    expect(allowed).toContain("python3");
    const notEnabled = d.slice(d.indexOf("Not enabled"));
    expect(notEnabled).not.toContain("python");
    expect(notEnabled).toContain("node");
  });

  test("(d) a custom allow-list replaces the default list in the description", () => {
    const d = shellExecuteToolFor({ allowedCommands: ["ls", "cat"] }).description;
    expect(d).toContain("Allowed commands: ls, cat.");
    expect(d).not.toContain("Allowed commands: git");
  });

  test("path confinement is stated for host mode", () => {
    const d = shellExecuteToolFor(undefined, { runWorkspace: true }).description;
    expect(d).toContain("Paths must stay inside the working directory");
    expect(d).toContain("cd does not persist");
  });

  test("custom block-list is described as configured, default as the named set", () => {
    expect(shellExecuteToolFor().description).toContain("Always blocked: rm, sudo");
    const custom = shellExecuteToolFor({ blockedPatterns: [/foo/] }).description;
    expect(custom).toContain("configured block-list");
    expect(custom).not.toContain("Always blocked: rm");
  });
});

describe("shellExecuteTool — default value", () => {
  test("is the default-mode definition and the public export is the same value", () => {
    delete process.env.RA_SANDBOX;
    expect(shellExecuteTool.name).toBe("shell-execute");
    expect(shellExecuteTool.description).toContain("private temporary directory under /tmp");
    expect(publicShellExecuteTool).toBe(shellExecuteTool);
  });

  test("non-description fields are mode-independent", () => {
    const a = shellExecuteToolFor();
    const b = shellExecuteToolFor({ sandbox: "docker" }, { runWorkspace: true });
    expect(b.name).toBe(a.name);
    expect(b.riskLevel).toBe("high");
    expect(b.requiresApproval).toBe(true);
    expect(b.produces).toBe("file");
    expect(b.parameters.map((p) => p.name)).toEqual(["command"]);
  });
});
