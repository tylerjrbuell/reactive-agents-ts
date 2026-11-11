import { describe, it, expect } from "bun:test";
import { get } from "svelte/store";
import { confirmAction, pendingConfirm, settleConfirm } from "./confirm-store.js";

describe("confirmAction", () => {
  it("resolves true on confirm and clears the pending request", async () => {
    const p = confirmAction({ title: "t", message: "m" });
    expect(get(pendingConfirm)?.title).toBe("t");
    settleConfirm(true);
    expect(await p).toBe(true);
    expect(get(pendingConfirm)).toBeNull();
  });

  it("resolves false on cancel", async () => {
    const p = confirmAction({ title: "t", message: "m" });
    settleConfirm(false);
    expect(await p).toBe(false);
  });

  it("a second request cancels the first and takes over", async () => {
    const first = confirmAction({ title: "a", message: "m" });
    const second = confirmAction({ title: "b", message: "m" });
    expect(await first).toBe(false);
    expect(get(pendingConfirm)?.title).toBe("b");
    settleConfirm(true);
    expect(await second).toBe(true);
  });

  it("settling with nothing open is a no-op", () => {
    settleConfirm(true);
    expect(get(pendingConfirm)).toBeNull();
  });
});
