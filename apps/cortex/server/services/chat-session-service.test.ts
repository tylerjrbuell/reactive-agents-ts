import { describe, it, expect } from "bun:test";
import { disposeCachedSession, type CachedChatSession } from "./chat-session-service.js";

describe("disposeCachedSession", () => {
  it("calls agent.dispose() and swallows errors", async () => {
    let disposed = 0;
    const ok: CachedChatSession = {
      session: {} as CachedChatSession["session"],
      agent: { dispose: async () => { disposed++; } },
    };
    await disposeCachedSession(ok);
    expect(disposed).toBe(1);

    const bad: CachedChatSession = {
      session: {} as CachedChatSession["session"],
      agent: { dispose: async () => { throw new Error("boom"); } },
    };
    await expect(disposeCachedSession(bad)).resolves.toBeUndefined();
  });
});
