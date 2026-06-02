import { describe, it, expect } from "bun:test";
import { withConfigEnv } from "../src/runner.js";

describe("withConfigEnv", () => {
  it("sets vars then restores prior values", () => {
    process.env.RA_TESTFLAG = "orig";
    const restore = withConfigEnv({ RA_TESTFLAG: "0", RA_NEWFLAG: "1" });
    expect(process.env.RA_TESTFLAG).toBe("0");
    expect(process.env.RA_NEWFLAG).toBe("1");
    restore();
    expect(process.env.RA_TESTFLAG).toBe("orig");
    expect(process.env.RA_NEWFLAG).toBeUndefined();
    delete process.env.RA_TESTFLAG;
  });
  it("no-op for undefined", () => {
    const restore = withConfigEnv(undefined);
    restore(); // must not throw
    expect(true).toBe(true);
  });
});
