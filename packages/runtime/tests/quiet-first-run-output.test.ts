/**
 * Quiet first-run output.
 *
 * A piped run, or one set to `verbosity: "minimal"`, prints the answer alone:
 * no build-info line, no live status line. Builder notices print one plain
 * `⚠ ` line on stderr, never Effect's default logfmt
 * (`timestamp=… level=WARN fiber=#N message=…`).
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { ReactiveAgents } from "../src/index.js";
import { logBuildInfo } from "../src/build-validation.js";
import { resolveStatusMode } from "../src/engine/execute-obs-wiring.js";
import { emitBuilderNotice } from "../src/builder/builder-notice.js";
import type { ToolsOptions } from "../src/builder.js";
import { withStdoutTTY } from "./_helpers-tty.js";

const BUILD_INFO = "✓ Provider:";

const captureConsole = () => {
  const out: string[] = [];
  const err: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    out.push(args.map(String).join(" "));
  });
  const warn = spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    err.push(args.map(String).join(" "));
  });
  return {
    out,
    err,
    restore: () => {
      log.mockRestore();
      warn.mockRestore();
    },
  };
};

describe("logBuildInfo follows verbosity and stdout", () => {
  const printed = (verbosity: "minimal" | "normal" | undefined, isTTY: boolean): string[] => {
    const c = captureConsole();
    try {
      logBuildInfo("test", "test-model", undefined, { verbosity, stdoutIsTTY: () => isTTY });
    } finally {
      c.restore();
    }
    return c.out.filter((l) => l.includes(BUILD_INFO));
  };

  test("piped, no verbosity set: silent", () => {
    expect(printed(undefined, false)).toHaveLength(0);
  });
  test("piped, minimal: silent", () => {
    expect(printed("minimal", false)).toHaveLength(0);
  });
  test("terminal, minimal: silent", () => {
    expect(printed("minimal", true)).toHaveLength(0);
  });
  test("terminal, no verbosity set: one line", () => {
    expect(printed(undefined, true)).toHaveLength(1);
  });
  test("piped, explicit normal: one line (explicit verbosity wins)", () => {
    expect(printed("normal", false)).toHaveLength(1);
  });
});

describe("build() prints no build-info line when piped", () => {
  const buildLines = (configure: (b: ReturnType<typeof ReactiveAgents.create>) => typeof b, isTTY: boolean) =>
    withStdoutTTY(isTTY, async () => {
      const c = captureConsole();
      try {
        const agent = await configure(
          ReactiveAgents.create().withTestScenario([{ text: "FINAL ANSWER: ok" }]),
        ).build();
        await agent.dispose();
      } finally {
        c.restore();
      }
      return c.out.filter((l) => l.includes(BUILD_INFO));
    });

  test("default verbosity, piped", async () => {
    expect(await buildLines((b) => b, false)).toHaveLength(0);
  });
  test("verbosity minimal, piped", async () => {
    expect(await buildLines((b) => b.withObservability({ verbosity: "minimal" }), false)).toHaveLength(0);
  });
  test("control: default verbosity on a terminal still prints it", async () => {
    expect(await buildLines((b) => b, true)).toHaveLength(1);
  });
});

describe("resolveStatusMode", () => {
  const env = (isTTY: boolean, disable?: string) => ({ stdoutIsTTY: () => isTTY, disableStatusModeEnv: disable ?? "" });

  test("terminal at normal verbosity: on", () => {
    expect(resolveStatusMode(undefined, "normal", env(true))).toBe(true);
  });
  test("terminal at minimal verbosity: off", () => {
    expect(resolveStatusMode(undefined, "minimal", env(true))).toBe(false);
  });
  test("piped: off", () => {
    expect(resolveStatusMode(undefined, "normal", env(false))).toBe(false);
  });
  test("opt-outs: config flag, env var, stream mode", () => {
    expect(resolveStatusMode({ disableStatusMode: true }, "normal", env(true))).toBe(false);
    expect(resolveStatusMode(undefined, "normal", env(true, "true"))).toBe(false);
    expect(resolveStatusMode({ mode: "stream" }, "normal", env(true))).toBe(false);
  });
  test("explicit status mode always wins", () => {
    expect(resolveStatusMode({ mode: "status" }, "minimal", env(false))).toBe(true);
  });
});

describe("run on a terminal: status line honours verbosity", () => {
  // Real engine path: stdout is a TTY, no opt-out env var. The status
  // renderer clears its line with "\r\x1b[2K"; nothing else in a run writes it.
  const statusWrites = async (verbosity: "minimal" | "normal"): Promise<number> => {
    const savedTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    const savedEnv = process.env["REACTIVE_AGENTS_DISABLE_STATUS_MODE"];
    delete process.env["REACTIVE_AGENTS_DISABLE_STATUS_MODE"];
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true, writable: true });
    const writes: string[] = [];
    const write = spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    const c = captureConsole();
    try {
      const agent = await ReactiveAgents.create()
        .withTestScenario([{ text: "FINAL ANSWER: ok" }])
        .withObservability({ verbosity })
        .build();
      await agent.run("say ok");
      await agent.dispose();
    } finally {
      c.restore();
      write.mockRestore();
      if (savedTTY) Object.defineProperty(process.stdout, "isTTY", savedTTY);
      else delete (process.stdout as { isTTY?: boolean }).isTTY;
      if (savedEnv !== undefined) process.env["REACTIVE_AGENTS_DISABLE_STATUS_MODE"] = savedEnv;
    }
    return writes.filter((w) => w.includes("\r\x1b[2K")).length;
  };

  test("minimal: no status line", async () => {
    expect(await statusWrites("minimal")).toBe(0);
  }, 20000);
  test("control: normal draws the status line", async () => {
    expect(await statusWrites("normal")).toBeGreaterThan(0);
  }, 20000);
});

describe("builder notices print one plain ⚠ line on stderr", () => {
  let c: ReturnType<typeof captureConsole> | undefined;
  afterEach(() => {
    c?.restore();
    c = undefined;
  });
  const assertPlain = (line: string | undefined) => {
    expect(line).toBeDefined();
    expect(line).toStartWith("⚠ ");
    expect(line).not.toContain("level=WARN");
    expect(line).not.toContain("timestamp=");
    expect(line).not.toContain("fiber=");
  };

  test("emitBuilderNotice", () => {
    c = captureConsole();
    emitBuilderNotice("something to fix");
    expect(c.out).toHaveLength(0);
    expect(c.err).toEqual(["⚠ something to fix"]);
  });

  test("withTools unknown option", () => {
    c = captureConsole();
    // An untyped caller's unknown key (TypeScript rejects the literal).
    const options: ToolsOptions & Record<string, unknown> = { include: ["file-read"] };
    ReactiveAgents.create().withTools(options);
    const notices = c.err.filter((l) => l.includes("withTools"));
    expect(notices).toHaveLength(1);
    assertPlain(notices[0]);
    expect(c.out.filter((l) => l.includes("withTools"))).toHaveLength(0);
  });

  test("bare withTools() at build", async () => {
    c = captureConsole();
    const agent = await ReactiveAgents.create()
      .withTestScenario([{ text: "FINAL ANSWER: ok" }])
      .withTools()
      .build();
    await agent.dispose();
    const notices = c.err.filter((l) => l.includes("has no capability tools"));
    expect(notices).toHaveLength(1);
    assertPlain(notices[0]);
  });
});
