// Run: bun run repo test apps/cortex/server/tests/cortex-judgment.test.ts
//
// Lab · Judgment on the server: the stored shape, the `.withJudgment()` overlay in the one
// build funnel (with the saved TypeSafe key, never in a config), the key API (never echoes a
// key, tests through the catalog) and `GET /api/judgment/models`.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JudgmentBuilderOptions } from "@reactive-agents/runtime";
import {
  judgmentBuilderOptionsOf,
  parseCortexJudgmentConfig,
  TYPESAFE_KEY_ID,
  type ListJudgmentCatalog,
} from "../services/cortex-judgment.js";
import { cortexAgentBuilder } from "../services/build-cortex-agent.js";
import { cortexOnlySettings } from "../services/cortex-agent-source.js";
import { normalizeCortexAgentConfig } from "../services/cortex-agent-config.js";
import { installProviderKeyStore, ProviderKeyStore, PROVIDER_KEYS_FILE } from "../services/provider-key-store.js";
import { providerKeysRouter } from "../api/provider-keys.js";
import { judgmentRouter } from "../api/judgment.js";

const KEY = "ts-fake-judgment-0123456789WXYZ";
let dir: string;
let env: Record<string, string | undefined>;
let store: ProviderKeyStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cortex-judgment-"));
  env = {};
  store = new ProviderKeyStore({ dir, env, now: () => 1_000 });
});
afterEach(() => {
  installProviderKeyStore(null);
  rmSync(dir, { recursive: true, force: true });
});

/** The options the builder holds for `.withJudgment()` (private field; the only observable). */
const judgmentOf = (b: unknown): JudgmentBuilderOptions | undefined =>
  (b as { _judgmentOptions?: JudgmentBuilderOptions })._judgmentOptions;

describe("parseCortexJudgmentConfig", () => {
  it("is off unless enabled is true", () => {
    expect(parseCortexJudgmentConfig(undefined)).toBeUndefined();
    expect(parseCortexJudgmentConfig({ backend: "jev" })).toBeUndefined();
    expect(parseCortexJudgmentConfig({ enabled: false, backend: "jev" })).toBeUndefined();
    expect(parseCortexJudgmentConfig("on")).toBeUndefined();
  });

  it("keeps the framework fields and drops unknown or bad values", () => {
    expect(
      parseCortexJudgmentConfig({ enabled: true, backend: "ollama", model: " nimble ", timeoutMs: 20000, baseUrl: "http://h:11434", keepAlive: "5m" }),
    ).toEqual({ enabled: true, backend: "ollama", model: "nimble", timeoutMs: 20000, baseUrl: "http://h:11434", keepAlive: "5m" });
    expect(parseCortexJudgmentConfig({ enabled: true, backend: "gpt", model: "", timeoutMs: -1 })).toEqual({ enabled: true });
    // keep_alive 0 and -1 are meaningful to Ollama: numeric strings become numbers, 0 survives.
    expect(parseCortexJudgmentConfig({ enabled: true, keepAlive: "-1" })?.keepAlive).toBe(-1);
    expect(parseCortexJudgmentConfig({ enabled: true, keepAlive: 0 })?.keepAlive).toBe(0);
  });

  it("normalizeCortexAgentConfig keeps an enabled judgment and removes a disabled one", () => {
    expect(normalizeCortexAgentConfig({ judgment: { enabled: true, backend: "jev" } }).judgment).toEqual({ enabled: true, backend: "jev" });
    expect("judgment" in normalizeCortexAgentConfig({ judgment: { enabled: false, backend: "jev" } })).toBe(false);
  });
});

describe("judgmentBuilderOptionsOf", () => {
  it("maps to the framework option names; ollama.keepAlive only for the ollama backend", () => {
    expect(judgmentBuilderOptionsOf({ enabled: true, backend: "ollama", model: "nimble", timeoutMs: 9000, keepAlive: "5m" })).toEqual({
      backend: "ollama",
      model: "nimble",
      timeoutMs: 9000,
      ollama: { keepAlive: "5m" },
    });
    expect(judgmentBuilderOptionsOf({ enabled: true, backend: "jev", keepAlive: "5m" }, KEY)).toEqual({ apiKey: KEY, backend: "jev" });
    expect(judgmentBuilderOptionsOf({ enabled: true })).toEqual({});
  });
});

describe("the build funnel", () => {
  it("calls .withJudgment() only when judgment is enabled", async () => {
    expect(judgmentOf(await cortexAgentBuilder({ provider: "test" }))).toBeUndefined();
    const b = await cortexAgentBuilder({ provider: "test", judgment: { enabled: true, backend: "ollama", model: "nimble", keepAlive: 0 } });
    expect(judgmentOf(b)).toEqual({ backend: "ollama", model: "nimble", ollama: { keepAlive: 0 } });
  });

  it("hands the saved TypeSafe key to the builder, not to a config", async () => {
    store.set(TYPESAFE_KEY_ID, KEY);
    installProviderKeyStore(store);
    const b = await cortexAgentBuilder({ provider: "test", judgment: { enabled: true } });
    expect(judgmentOf(b)?.apiKey).toBe(KEY);
    expect(JSON.stringify(b.toConfig())).not.toContain(KEY);
  });

  it("an env key wins over a saved one unless preferStored, as for providers", async () => {
    env.TYPESAFE_API_KEY = "ts-from-env-00000000000";
    store.set(TYPESAFE_KEY_ID, KEY);
    installProviderKeyStore(store);
    expect(judgmentOf(await cortexAgentBuilder({ provider: "test", judgment: { enabled: true } }))?.apiKey).toBeUndefined();
    store.setPreferStored(TYPESAFE_KEY_ID, true);
    expect(judgmentOf(await cortexAgentBuilder({ provider: "test", judgment: { enabled: true } }))?.apiKey).toBe(KEY);
  });

  it("the exported-code note lists the judgment overlay without the key", () => {
    store.set(TYPESAFE_KEY_ID, KEY);
    installProviderKeyStore(store);
    const notes = cortexOnlySettings({ provider: "test", judgment: { enabled: true, backend: "jev" } });
    const n = notes.find((x) => x.call === "withJudgment");
    expect(n?.detail).toContain("TYPESAFE_API_KEY");
    expect(JSON.stringify(notes)).not.toContain(KEY);
  });
});

describe("TypeSafe key API", () => {
  const catalog = (r: Awaited<ReturnType<ListJudgmentCatalog>>): ListJudgmentCatalog => async () => r;
  const call = (a: ReturnType<typeof providerKeysRouter>, method: string, path: string, body?: unknown) =>
    a.handle(
      new Request(`http://localhost/api/settings/keys${path}`, {
        method,
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );

  it("is a keyed entry that never returns the key and stores only ciphertext", async () => {
    const a = providerKeysRouter(store, undefined, catalog({ ok: true, models: [] }));
    const put = await (await call(a, "PUT", `/${TYPESAFE_KEY_ID}`, { apiKey: KEY })).text();
    expect(put).not.toContain(KEY);
    const list = await (await call(a, "GET", "/")).text();
    expect(list).not.toContain(KEY);
    expect(list).toContain('"provider":"typesafe"');
    expect(list).toContain("TYPESAFE_API_KEY");
    expect(readFileSync(join(dir, PROVIDER_KEYS_FILE), "utf8")).not.toContain(KEY);
  });

  it("Test reads the Jev catalog with the typed key and redacts it from a failure", async () => {
    let seen: string | undefined;
    const ok = providerKeysRouter(store, undefined, async (o) => {
      seen = o.apiKey;
      return { ok: true, models: [{ name: "jev-1", description: "d", releaseDate: "2026" }] };
    });
    const good = (await (await call(ok, "POST", `/${TYPESAFE_KEY_ID}/test`, { apiKey: KEY })).json()) as { ok: boolean; models?: number; tried: string };
    expect(good).toEqual({ ok: true, tried: "typed", models: 1 });
    expect(seen).toBe(KEY);

    const bad = providerKeysRouter(store, undefined, catalog({ ok: false, message: `401 for key ${KEY}` }));
    const body = await (await call(bad, "POST", `/${TYPESAFE_KEY_ID}/test`, { apiKey: KEY })).text();
    expect(body).not.toContain(KEY);
    expect(body).toContain('"ok":false');
  });

  it("Test with no key anywhere asks for one without calling the catalog", async () => {
    let called = false;
    const a = providerKeysRouter(store, undefined, async () => ((called = true), { ok: true, models: [] }));
    const r = (await (await call(a, "POST", `/${TYPESAFE_KEY_ID}/test`, {})).json()) as { ok: boolean; tried: string };
    expect(r).toMatchObject({ ok: false, tried: "none" });
    expect(called).toBe(false);
  });
});

describe("GET /api/judgment/models", () => {
  const get = (a: ReturnType<typeof judgmentRouter>) => a.handle(new Request("http://localhost/api/judgment/models"));

  it("reports unavailable without a key, and does not call the catalog", async () => {
    let called = false;
    const a = judgmentRouter(store, async () => ((called = true), { ok: true, models: [] }));
    const r = (await (await get(a)).json()) as { available: boolean; reason?: string };
    expect(r.available).toBe(false);
    expect(r.reason).toContain("TYPESAFE_API_KEY");
    expect(called).toBe(false);
  });

  it("lists the catalog with the key agents would use, and redacts it from errors", async () => {
    store.set(TYPESAFE_KEY_ID, KEY);
    const a = judgmentRouter(store, async (o) => (o.apiKey === KEY ? { ok: true, models: [{ name: "jev-1", description: "fast", releaseDate: "2026" }] } : { ok: false, message: "wrong key" }));
    expect(await (await get(a)).json()).toEqual({ available: true, models: [{ name: "jev-1", description: "fast" }] });

    const failing = judgmentRouter(store, async () => ({ ok: false, message: `bad key ${KEY}` }));
    const txt = await (await get(failing)).text();
    expect(txt).not.toContain(KEY);
    expect(txt).toContain('"available":false');
  });
});
