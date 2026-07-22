import { afterEach, describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgents } from "../src/index.js";

/**
 * End-to-end pin for the `Logger.none` bug.
 *
 * The execution engine used to provide
 * `Logger.replace(Logger.defaultLogger, Logger.none)`, which DISCARDED every
 * Effect.log* call raised anywhere inside a run — the reasoning kernel's own
 * diagnostics included — while `core/src/errors` instructs authors to prefer
 * exactly those calls over `console.*`.
 *
 * A unit test of the bridge proves the bridge works. Only this proves the
 * ENGINE uses it. If anyone restores `Logger.none`, this goes red.
 */
const captureConsole = () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return {
    lines,
    restore: () => {
      console.log = original;
    },
  };
};

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

describe("Effect logs raised inside a run are captured, not discarded", () => {
  it("an Effect.logWarning from a lifecycle hook reaches the observable logger", async () => {
    const cap = captureConsole();
    restore = cap.restore;

    const agent = await ReactiveAgents.create()
      .withName("effect-log-capture")
      .withProvider("test")
      .withLogging({ level: "debug" })
      .withHook({
        phase: "complete",
        timing: "before",
        handler: (ctx) =>
          Effect.logWarning("canary-from-inside-the-run").pipe(Effect.as(ctx)),
      })
      .withTestScenario([{ text: "Done." }])
      .build();

    await agent.run("hello");
    await agent.dispose();

    cap.restore();
    const joined = cap.lines.join("\n");
    expect(joined).toContain("canary-from-inside-the-run");
  }, 20000);
});
