/**
 * Settings · Providers API keys: the server's key status (`GET /api/settings/keys`),
 * what each row says, and the calls Add / Replace / Test / Remove make. The server
 * never sends a key back; rows show only its mask. Rendering lives in
 * `components/settings/ProviderKeysPanel.svelte`.
 */

/** Where the key an agent gets comes from. */
export type ProviderKeySource = "stored" | "env" | "none";

/** One provider's key state, as the server reports it (never the key). */
export interface ProviderKeyStatus {
  readonly provider: string;
  readonly env: readonly string[];
  readonly envSet: boolean;
  readonly stored: { readonly masked: string; readonly updatedAt: number; readonly preferStored: boolean } | null;
  readonly unreadable: boolean;
  readonly source: ProviderKeySource;
  /**
   * False when the provider's framework adapter would ignore a key Cortex passes.
   * Every keyed provider takes one today (llm-provider d1955526c), so rows no longer warn on it.
   */
  readonly appliesToAgents: boolean;
}

/** `GET /api/settings/keys`. */
export interface ProviderKeysResponse {
  readonly providers: readonly ProviderKeyStatus[];
  /** Directory holding the encrypted key files. */
  readonly dir: string;
}

/** `POST /api/settings/keys/:provider/test`. */
export interface ProviderKeyTestResult {
  readonly ok: boolean;
  readonly tried: "typed" | "stored" | "env" | "none";
  readonly models?: number;
  readonly error?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** One status from untrusted JSON, or null. */
export function parseKeyStatus(v: unknown): ProviderKeyStatus | null {
  if (!isRecord(v) || typeof v.provider !== "string") return null;
  const source = v.source === "stored" || v.source === "env" ? v.source : "none";
  const s = v.stored;
  const stored =
    isRecord(s) && typeof s.masked === "string"
      ? {
          masked: s.masked,
          updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : 0,
          preferStored: s.preferStored === true,
        }
      : null;
  return {
    provider: v.provider,
    env: Array.isArray(v.env) ? v.env.filter((e): e is string => typeof e === "string") : [],
    envSet: v.envSet === true,
    stored,
    unreadable: v.unreadable === true,
    source,
    appliesToAgents: v.appliesToAgents !== false,
  };
}

/**
 * Key-store ids of the Settings · Voice endpoint keys. They share the encrypted store
 * but are not providers, so the Providers panel never lists them (Voice owns them).
 */
export const VOICE_KEY_IDS: readonly string[] = ["voice-stt", "voice-tts"];

/** `GET /api/settings/keys` body from untrusted JSON (voice endpoint keys left out). */
export function parseKeysResponse(v: unknown): ProviderKeysResponse {
  if (!isRecord(v) || !Array.isArray(v.providers)) return { providers: [], dir: "" };
  return {
    providers: v.providers
      .map(parseKeyStatus)
      .filter((p): p is ProviderKeyStatus => p !== null && !VOICE_KEY_IDS.includes(p.provider)),
    dir: typeof v.dir === "string" ? v.dir : "",
  };
}

/** What one row shows. */
export interface KeyRowView {
  /** The env variable named in copy. */
  readonly envName: string;
  readonly badge: { readonly tone: "ok" | "warn" | "bad" | "neutral"; readonly text: string };
  /** One line: which key agents use. */
  readonly summary: string;
  /** Extra line (a warning), or null. */
  readonly note: string | null;
  /** Show "Use saved key instead of the environment's" (both exist). */
  readonly showPrefer: boolean;
}

const ROW_LABELS: Readonly<Record<string, string>> = {
  ollama: "Ollama Cloud (API key)",
  typesafe: "TypeSafe (Jev judgment)",
};

/** A row's display name for the entries that are not an LLM provider's key (or need a clearer name); else undefined. */
export function keyRowLabelOf(provider: string): string | undefined {
  return ROW_LABELS[provider];
}

const ROW_HINTS: Readonly<Record<string, string>> = {
  ollama:
    "For Ollama Cloud or an authenticated remote server. Set the endpoint below (Ollama Cloud preset); the key is sent to that host only and never to a local server.",
  typesafe: "Used by Lab · Judgment when the TypeSafe backend runs. Test reads your model list; it asks no judgment, so nothing is billed.",
};

/** One line of context under a row (what the key is for), or null. */
export function keyRowHintOf(provider: string): string | null {
  return ROW_HINTS[provider] ?? null;
}

/** The row text for one provider. */
export function keyRowOf(s: ProviderKeyStatus): KeyRowView {
  const envName = s.env[0] ?? `${s.provider.toUpperCase()}_API_KEY`;
  const showPrefer = s.stored !== null && s.envSet;
  let note: string | null = null;
  if (s.unreadable) {
    note = "A saved key could not be decrypted (the key file was replaced). Save the key again.";
  }
  if (s.source === "stored" && s.stored) {
    return {
      envName,
      badge: { tone: "ok", text: "Saved key" },
      summary: s.envSet
        ? `Agents use the saved key ${s.stored.masked}, not ${envName}.`
        : `Agents use the saved key ${s.stored.masked}.`,
      note,
      showPrefer,
    };
  }
  if (s.source === "env") {
    return {
      envName,
      badge: { tone: "ok", text: "Environment" },
      summary: s.stored
        ? `Agents use ${envName}. Saved key ${s.stored.masked} is kept as a spare.`
        : `Agents use ${envName} from the server's environment.`,
      note,
      showPrefer,
    };
  }
  return {
    envName,
    badge: { tone: "bad", text: "No key" },
    summary: `Save a key, or set ${envName} in the server's environment.`,
    note,
    showPrefer,
  };
}

/** The line shown after Test. */
export function testResultLine(r: ProviderKeyTestResult): { readonly tone: "ok" | "bad"; readonly text: string } {
  if (r.ok) {
    const what = r.tried === "typed" ? "This key" : r.tried === "stored" ? "The saved key" : "The environment key";
    const n = r.models ?? 0;
    return { tone: "ok", text: `${what} works: ${n} model${n === 1 ? "" : "s"} listed.` };
  }
  return { tone: "bad", text: r.error?.trim() || "The provider refused the key." };
}

/** Thrown-free result of a key call. */
export type KeyCallResult<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly error: string };

async function call<A>(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit,
  parse: (v: unknown) => A,
): Promise<KeyCallResult<A>> {
  try {
    const res = await doFetch(url, init);
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = isRecord(body) && typeof body.error === "string" ? body.error : `Server returned ${res.status}`;
      return { ok: false, error: msg };
    }
    return { ok: true, value: parse(body) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
});

const statusOrThrowFree = (v: unknown): ProviderKeyStatus | null => parseKeyStatus(v);

/** The key calls against `base` (the Cortex server URL). `doFetch` is injectable for tests. */
export function providerKeysApi(base: string, doFetch: typeof fetch = fetch) {
  const url = (p = "") => `${base}/api/settings/keys${p}`;
  const one = (provider: string) => `/${encodeURIComponent(provider)}`;
  return {
    list: () => call(doFetch, url("/"), { method: "GET" }, parseKeysResponse),
    save: (provider: string, apiKey: string) =>
      call(doFetch, url(one(provider)), json("PUT", { apiKey }), statusOrThrowFree),
    remove: (provider: string) => call(doFetch, url(one(provider)), json("DELETE"), statusOrThrowFree),
    preferStored: (provider: string, preferStored: boolean) =>
      call(doFetch, url(one(provider)), json("PATCH", { preferStored }), statusOrThrowFree),
    test: (provider: string, apiKey?: string) =>
      call(doFetch, url(`${one(provider)}/test`), json("POST", apiKey ? { apiKey } : {}), (v): ProviderKeyTestResult =>
        isRecord(v)
          ? {
              ok: v.ok === true,
              tried: v.tried === "typed" || v.tried === "stored" || v.tried === "env" ? v.tried : "none",
              ...(typeof v.models === "number" ? { models: v.models } : {}),
              ...(typeof v.error === "string" ? { error: v.error } : {}),
            }
          : { ok: false, tried: "none", error: "Unexpected reply" },
      ),
  };
}

/** Replace a status in a list (by provider). */
export function withStatus(list: readonly ProviderKeyStatus[], s: ProviderKeyStatus): ProviderKeyStatus[] {
  return list.map((p) => (p.provider === s.provider ? s : p));
}
