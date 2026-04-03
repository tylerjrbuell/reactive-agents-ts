import { describe, expect, it, beforeEach } from "bun:test";
import { forgetRunChatSession, peekRunChatSession, rememberRunChatSession } from "./run-chat-session-cache.js";

describe("run-chat-session-cache", () => {
  beforeEach(() => {
    forgetRunChatSession("run-a");
    forgetRunChatSession("run-b");
  });

  it("remembers and peeks session id per run", () => {
    expect(peekRunChatSession("run-a")).toBeUndefined();
    rememberRunChatSession("run-a", "sess-1");
    expect(peekRunChatSession("run-a")).toBe("sess-1");
  });

  it("forget removes entry", () => {
    rememberRunChatSession("run-b", "sess-2");
    forgetRunChatSession("run-b");
    expect(peekRunChatSession("run-b")).toBeUndefined();
  });
});
