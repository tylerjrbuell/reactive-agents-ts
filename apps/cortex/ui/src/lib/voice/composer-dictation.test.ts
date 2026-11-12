import { describe, expect, test } from "bun:test";
import type { SttEngine, SttHandlers } from "@reactive-agents/ui-core";
import { createComposerDictation } from "./composer-dictation.js";

function setup(opts: { draft?: string; caret?: number; autoSend?: boolean } = {}) {
  let text = opts.draft ?? "";
  let caret = opts.caret ?? text.length;
  let handlers: SttHandlers | null = null;
  let autoSent = 0;
  const engine: SttEngine = {
    id: "fake",
    label: "Fake",
    available: () => ({ ok: true }),
    start: (_o, h) => {
      handlers = h;
      return { stop: () => h.onEnd(), abort: () => h.onEnd() };
    },
  };
  const silenceCalls: number[] = [];
  const d = createComposerDictation({
    engine: () => engine,
    field: { read: () => ({ text, caret }), write: (t, c) => ((text = t), (caret = c)) },
    silenceMs: () => (opts.autoSend ? 1500 : 0),
    autoSend: () => opts.autoSend === true,
    onAutoSend: () => (autoSent += 1),
    clock: {
      now: () => 0,
      setTimeout: (fn, ms) => {
        silenceCalls.push(ms);
        queueMicrotask(fn); // fire the quiet period at once
        return 1;
      },
      clearTimeout: () => undefined,
    },
  });
  return { d, h: () => handlers as SttHandlers, text: () => text, caret: () => caret, autoSent: () => autoSent, silenceCalls };
}

describe("createComposerDictation", () => {
  test("interim words appear at the caret and never overwrite the draft", () => {
    const s = setup({ draft: "Please fix the bug", caret: 6 });
    s.d.start();
    s.h().onInterim?.("quickly");
    expect(s.text()).toBe("Please quickly fix the bug");
    s.h().onInterim?.("quickly and");
    s.h().onFinal?.("quickly and carefully");
    expect(s.text()).toBe("Please quickly and carefully fix the bug");
    expect(s.caret()).toBe("Please quickly and carefully".length);
  });

  test("a second phrase continues after the first", () => {
    const s = setup({ draft: "", caret: 0 });
    s.d.start();
    s.h().onFinal?.("first part");
    s.h().onInterim?.("second");
    expect(s.text()).toBe("first part second");
  });

  test("a later session inserts fresh and keeps the earlier words as typed text", () => {
    const s = setup({ draft: "", caret: 0 });
    s.d.start();
    s.h().onFinal?.("one");
    s.d.stop();
    s.d.start();
    s.h().onFinal?.("two");
    expect(s.text()).toBe("one two");
  });

  test("auto-send fires only when silence ended a session that heard something", async () => {
    const s = setup({ autoSend: true });
    s.d.start();
    s.h().onFinal?.("send this");
    await Promise.resolve();
    await Promise.resolve();
    expect(s.autoSent()).toBe(1);
    expect(s.silenceCalls).toEqual([1500]);
    const manual = setup({ autoSend: true });
    manual.d.start();
    manual.h().onFinal?.("x");
    manual.d.abort();
    expect(manual.autoSent()).toBe(0);
  });

  test("auto-send off never sends and never arms the silence timer", async () => {
    const s = setup({ autoSend: false });
    s.d.start();
    s.h().onFinal?.("hello");
    await Promise.resolve();
    s.d.stop();
    expect(s.autoSent()).toBe(0);
    expect(s.silenceCalls).toEqual([]);
  });
});
