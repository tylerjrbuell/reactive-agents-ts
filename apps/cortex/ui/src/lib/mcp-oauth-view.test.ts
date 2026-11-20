import { describe, expect, test } from "bun:test";
import { authActions, authChip, authDetail, draftFromLogin, loginLabel, loginsReplyOf, serverAuthOf, signInPending, visibleLogins, type McpServerAuth } from "./mcp-oauth-view.js";
import { testOutcomeText } from "./mcp-servers-view.js";

const NOW = 2_000_000_000_000;
const auth = (over: Partial<McpServerAuth> = {}): McpServerAuth => ({ state: "absent", scopes: [], hasRefreshToken: false, authRequired: false, ...over });
const pending = { phase: "pending" as const, authorizationUrl: "http://127.0.0.1:9/authorize?x=1", startedAt: NOW };

describe("authChip", () => {
  test("one chip per state, nothing for a server that never asked; never the running tone", () => {
    expect(authChip(undefined)).toBeNull();
    expect(authChip(auth())).toBeNull();
    expect(authChip(auth({ authRequired: true }))).toEqual({ label: "Sign-in required", tone: "failed" });
    expect(authChip(auth({ state: "signed-in" }))).toEqual({ label: "Signed in", tone: "done" });
    expect(authChip(auth({ state: "expired" }))).toEqual({ label: "Sign-in expired", tone: "attention" });
    expect(authChip(auth({ signIn: pending }))).toEqual({ label: "Waiting for sign-in", tone: "attention" });
  });
});

describe("authActions / authDetail", () => {
  test("absent: Sign in; signed in: Sign out; pending: Cancel only; expired: both", () => {
    expect(authActions(auth())).toEqual({ signIn: true, cancel: false, signOut: false });
    expect(authActions(auth({ state: "signed-in" }))).toEqual({ signIn: false, cancel: false, signOut: true });
    expect(authActions(auth({ signIn: pending }))).toEqual({ signIn: false, cancel: true, signOut: false });
    expect(authActions(auth({ state: "expired" }))).toEqual({ signIn: true, cancel: false, signOut: true });
  });

  test("detail words: pending points at the browser, a failure shows its reason, expired says whether it renews", () => {
    expect(authDetail(auth({ signIn: pending }), NOW)).toContain("browser");
    expect(authDetail(auth({ signIn: { phase: "failed", error: "MCP login failed: denied", at: NOW } }), NOW)).toBe("MCP login failed: denied");
    expect(authDetail(auth({ state: "expired", hasRefreshToken: true }), NOW)).toContain("renews");
    expect(authDetail(auth({ state: "signed-in", scopes: ["read"] }), NOW)).toContain("Scopes: read");
    expect(signInPending(auth({ signIn: pending }))).toBe(true);
    expect(signInPending(auth())).toBe(false);
  });
});

describe("rax logins", () => {
  test("Add prefill: name, URL and transport only; a nameless login is named by host", () => {
    const d = draftFromLogin({ resourceKey: "k", url: "https://mcp.example.com/mcp", transport: "sse", status: "signed-in", scopes: [], hasRefreshToken: true });
    expect(d).toMatchObject({ name: "mcp-example-com", transport: "sse", endpoint: "https://mcp.example.com/mcp", headers: "", auth: "" });
    expect(loginLabel({ url: "https://mcp.example.com/mcp", name: "docs" })).toBe("docs");
    expect(draftFromLogin({ resourceKey: "k", url: "https://x.dev/mcp", status: "signed-in", scopes: [], hasRefreshToken: false }).transport).toBe("streamable-http");
  });

  test("the list shows signed-in logins first and at most five until expanded", () => {
    const mk = (i: number, status: "signed-in" | "expired") => ({ resourceKey: `k${i}`, url: `http://127.0.0.1:${i}/mcp`, status, scopes: [], hasRefreshToken: false });
    const logins = [mk(1, "expired"), mk(2, "expired"), mk(3, "expired"), mk(4, "expired"), mk(5, "expired"), mk(6, "signed-in"), mk(7, "expired")];
    const v = visibleLogins(logins, false);
    expect(v.rows).toHaveLength(5);
    expect(v.hidden).toBe(2);
    expect(v.rows[0]?.resourceKey).toBe("k6");
    expect(visibleLogins(logins, true)).toMatchObject({ hidden: 0 });
    expect(visibleLogins(logins.slice(0, 3), false).hidden).toBe(0);
  });

  test("wire readers keep only known fields", () => {
    const reply = loginsReplyOf({
      servers: { s1: { state: "signed-in", scopes: ["a"], hasRefreshToken: true, authRequired: false, access_token: "leak" }, bad: { state: "?" } },
      unused: [{ resourceKey: "k", url: "https://x.dev/mcp", status: "expired", scopes: [], hasRefreshToken: false, refresh_token: "leak" }, { nope: 1 }],
    });
    expect(Object.keys(reply.servers)).toEqual(["s1"]);
    expect(JSON.stringify(reply)).not.toContain("leak");
    expect(reply.unused).toHaveLength(1);
    expect(reply.unused[0]?.status).toBe("expired");
    expect(serverAuthOf({ state: "absent", signIn: pending })?.signIn).toEqual(pending);
  });
});

test("a Test refused for lack of a login reads as Sign-in required, not the raw error", () => {
  expect(testOutcomeText({ ok: false, error: "Sign-in required (HTTP 401): Streamable HTTP error", authRequired: true })).toContain("Sign in");
  expect(testOutcomeText({ ok: false, error: "boom" })).toBe("Failed: boom");
});
