// Run: bun test src/lib/stores/toast-store.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { get } from "svelte/store";
import { toast } from "./toast-store.js";

describe("toast store — interactive prompts", () => {
  it("prompt() adds a sticky toast with buttons", () => {
    let clicked = false;
    toast.prompt({ title: "Approval", buttons: [{ label: "Approve", onClick: () => { clicked = true; } }], key: "k1" });
    const ts = get(toast);
    const t = ts.find((x) => x.key === "k1");
    expect(t).toBeDefined();
    expect(t!.durationMs).toBe(0);
    expect(t!.buttons?.[0]?.label).toBe("Approve");
    t!.buttons![0]!.onClick();
    expect(clicked).toBe(true);
    toast.removeByKey("k1");
  });

  it("de-dupes by key (later prompt replaces earlier)", () => {
    toast.prompt({ title: "A", buttons: [{ label: "x", onClick: () => {} }], key: "dup" });
    toast.prompt({ title: "B", buttons: [{ label: "y", onClick: () => {} }], key: "dup" });
    const withKey = get(toast).filter((t) => t.key === "dup");
    expect(withKey.length).toBe(1);
    expect(withKey[0]!.title).toBe("B");
    toast.removeByKey("dup");
  });

  it("removeByKey clears the toast", () => {
    toast.prompt({ title: "C", buttons: [{ label: "z", onClick: () => {} }], key: "gone" });
    toast.removeByKey("gone");
    expect(get(toast).some((t) => t.key === "gone")).toBe(false);
  });
});
