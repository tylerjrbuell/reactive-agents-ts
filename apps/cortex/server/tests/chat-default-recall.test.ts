import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { buildCortexAgent } from "../services/build-cortex-agent.js";
import type { CortexMetaToolsConfig } from "../services/cortex-agent-config.js";

/**
 * Mirror of `chatDefaultConfig().metaTools` in `ui/src/lib/chat-defaults.ts` (pinned there by
 * `chat-defaults.test.ts`). Not imported: the UI module pulls SvelteKit `$lib` aliases the
 * server typecheck cannot resolve.
 */
const CHAT_DEFAULT_META_TOOLS: CortexMetaToolsConfig = {
  enabled: true, brief: false, find: false, pulse: false, recall: true, harnessSkill: false, todo: true,
};

// `recall` is in-run retrieval of oversized tool results (not cross-run memory).
// The framework warns when an exact-set `.withMetaTools({...})` drops it; a default
// chat must keep it on and must not trigger that warning.
// The default logger prints logfmt, which escapes the quotes around "recall".
const droppedRecall = (line: string): boolean => line.includes("NOT included") && line.includes("recall");

const captureLogs = () => {
  const lines: string[] = [];
  const record = (...args: unknown[]) => {
    lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
  const spies = [
    spyOn(console, "log").mockImplementation(record),
    spyOn(console, "warn").mockImplementation(record),
    spyOn(console, "error").mockImplementation(record),
  ];
  return { lines, restore: () => spies.forEach((s) => s.mockRestore()) };
};

describe("chat default keeps recall", () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("building a default chat agent does not warn that recall was dropped", async () => {
    const cap = captureLogs();
    restore = cap.restore;
    const agent = await buildCortexAgent({ provider: "test", metaTools: CHAT_DEFAULT_META_TOOLS }, "chat-recall");
    await agent.dispose();
    expect(cap.lines.some(droppedRecall)).toBe(false);
  });

  it("control: recall: false does warn (the capture sees the notice)", async () => {
    const cap = captureLogs();
    restore = cap.restore;
    const agent = await buildCortexAgent(
      { provider: "test", metaTools: { ...CHAT_DEFAULT_META_TOOLS, recall: false } },
      "chat-recall-off",
    );
    await agent.dispose();
    expect(cap.lines.some(droppedRecall)).toBe(true);
  });
});
