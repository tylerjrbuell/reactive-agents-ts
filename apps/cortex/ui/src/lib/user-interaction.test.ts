import { describe, expect, test } from "bun:test";
import { askModeOf, withAskMode } from "./user-interaction.js";

describe("ask mode", () => {
  test("reads unset, false and anything else", () => {
    expect(askModeOf(undefined)).toBe("default");
    expect(askModeOf({})).toBe("default");
    expect(askModeOf({ userInteraction: false })).toBe("no");
    expect(askModeOf({ userInteraction: true })).toBe("yes");
    expect(askModeOf({ userInteraction: { timeoutMs: 5000 } })).toBe("yes");
  });

  test("writes keep other keys; default removes; yes keeps a timeout object", () => {
    expect(withAskMode({ profile: "lean" }, "yes")).toEqual({ profile: "lean", userInteraction: true });
    expect(withAskMode({ profile: "lean", userInteraction: true }, "default")).toEqual({ profile: "lean" });
    expect(withAskMode({}, "no")).toEqual({ userInteraction: false });
    expect(withAskMode({ userInteraction: { timeoutMs: 5000 } }, "yes")).toEqual({ userInteraction: { timeoutMs: 5000 } });
  });
});
