/**
 * Provider API keys saved through Settings · Providers.
 *
 * Keys live only on the server, encrypted at rest with AES-256-GCM (`node:crypto`):
 * - `secret.key`: 32 random bytes, created once with mode 0600 (never overwritten:
 *   replacing it would make every stored key unreadable).
 * - `provider-keys.json`: one sealed entry per provider (iv, auth tag, ciphertext,
 *   the provider id as AAD so an entry cannot be moved to another provider), mode
 *   0600, written atomically (temp file + rename).
 *
 * Both files sit in the Cortex data dir (the directory of the SQLite DB, by default
 * `.cortex/` under the server's cwd). The API never returns a key: only a mask
 * (`••••last4`) and where the key the agent will use comes from.
 *
 * Precedence: a key in the server environment wins; a stored key is used when the
 * environment has none, or when the user chose "use stored key" (`preferStored`).
 * The key reaches the agent as `.withProvider(provider, { apiKey })` at build time
 * (`buildCortexAgent`); `process.env` is never written.
 *
 * Nothing here throws: every operation returns a tagged result.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { effectiveOllamaEndpoint, ollamaKeyApplies } from "./ollama-cloud.js";

/** File holding the 32-byte AES key. */
export const SECRET_KEY_FILE = "secret.key";
/** File holding the sealed provider keys. */
export const PROVIDER_KEYS_FILE = "provider-keys.json";

/** Key-store id of the speech-to-text endpoint's API key (Settings · Voice). */
export const VOICE_STT_KEY_ID = "voice-stt";
/** Key-store id of the text-to-speech endpoint's API key (Settings · Voice). */
export const VOICE_TTS_KEY_ID = "voice-tts";

/**
 * Providers whose key Settings can store, with the env variables Cortex treats as
 * that provider's key (first one is the name shown in the UI). Same names as the
 * framework reads (`readLLMConfigFromEnv`); `GEMINI_API_KEY` is the Cortex alias
 * Settings already reported for Gemini.
 */
export const KEYED_PROVIDER_ENV: Readonly<Record<string, readonly string[]>> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  gemini: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  groq: ["GROQ_API_KEY"],
  xai: ["XAI_API_KEY"],
  litellm: ["LITELLM_API_KEY"],
  // Ollama Cloud / an authenticated remote Ollama. A local server needs none: the key is sent
  // only when the endpoint is not loopback (`ollama-cloud.ts` `ollamaKeyApplies`).
  ollama: ["OLLAMA_API_KEY"],
  // Not an LLM provider: the TypeSafe (Jev) judgment backend's key. It reaches the agent as
  // `.withJudgment({ apiKey })` (`cortexAgentBuilder`), never `.withProvider`.
  typesafe: ["TYPESAFE_API_KEY"],
  // Not LLM providers: the API keys of the Settings · Voice endpoints (speech to text, text to
  // speech). They never reach an agent (`AGENT_APPLIES` leaves them out) and are used only by
  // `api/voice.ts`; the Providers panel hides them (`isVoiceKeyId`, UI `provider-keys.ts`).
  [VOICE_STT_KEY_ID]: ["CORTEX_VOICE_STT_API_KEY"],
  [VOICE_TTS_KEY_ID]: ["CORTEX_VOICE_TTS_API_KEY"],
};

/**
 * Providers whose framework adapter reads `.withProvider(p, { apiKey })`. Since
 * llm-provider d1955526c every adapter honours a passed key (anthropic and gemini
 * included), so this is every provider Settings can store a key for. Ollama's key is
 * for Ollama Cloud or an authenticated remote server and is gated by the endpoint
 * (`ollamaKeyApplies`). A provider added to {@link KEYED_PROVIDER_ENV} whose adapter
 * ignores a passed key must be left out here.
 */
const AGENT_APPLIES: ReadonlySet<string> = new Set(["anthropic", "openai", "gemini", "groq", "xai", "litellm", "ollama", "typesafe"]);

/** True when a stored key for `provider` reaches the agent's provider adapter. */
export const storedKeyAppliesToAgents = (provider: string): boolean => AGENT_APPLIES.has(provider);

/** True when Settings can store a key for `provider`. */
export const isKeyedProvider = (provider: string): boolean =>
  Object.prototype.hasOwnProperty.call(KEYED_PROVIDER_ENV, provider);

/** Where the key an agent gets for a provider comes from. */
export type ProviderKeySource = "stored" | "env" | "none";

/** One provider's key state as the API reports it. Never carries a key. */
export interface ProviderKeyStatus {
  readonly provider: string;
  /** Env variables read for this provider (first is the canonical name). */
  readonly env: readonly string[];
  /** True when one of `env` is set in the server environment. */
  readonly envSet: boolean;
  /** The stored key, masked, or null when none is stored. */
  readonly stored: {
    readonly masked: string;
    readonly updatedAt: number;
    /** Use the stored key even when the environment has one. */
    readonly preferStored: boolean;
  } | null;
  /** A stored entry exists but cannot be decrypted (secret key replaced or file edited). */
  readonly unreadable: boolean;
  /** The key agents use: `stored`, `env`, or `none`. */
  readonly source: ProviderKeySource;
  /** False while the framework adapter ignores a passed key (see {@link storedKeyAppliesToAgents}). */
  readonly appliesToAgents: boolean;
}

/** A failed store operation; `message` never contains a key. */
export interface ProviderKeyStoreError {
  readonly _tag: "ProviderKeyStoreError";
  readonly reason: "unknown-provider" | "empty-key" | "io" | "corrupt" | "not-found";
  readonly message: string;
}

export type StoreResult<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly error: ProviderKeyStoreError };

interface SealedEntry {
  readonly iv: string;
  readonly tag: string;
  readonly data: string;
  /** First 8 hex chars of sha256(secret key): which key sealed the entry. */
  readonly kid: string;
  readonly updatedAt: number;
  readonly preferStored: boolean;
}

interface KeysFile {
  readonly v: 1;
  readonly keys: Readonly<Record<string, SealedEntry>>;
}

const FILE_MODE = 0o600;
const ok = <A>(value: A): StoreResult<A> => ({ ok: true, value });
const err = <A>(reason: ProviderKeyStoreError["reason"], message: string): StoreResult<A> => ({
  ok: false,
  error: { _tag: "ProviderKeyStoreError", reason, message },
});
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** `••••` plus the last 4 characters (all bullets for keys shorter than 12). */
export function maskKey(key: string): string {
  return key.length >= 12 ? `••••${key.slice(-4)}` : "••••";
}

/** Replace every occurrence of `secret` in `text` with its mask. */
export function redactKey(text: string, secret: string | undefined): string {
  if (!secret || secret.length < 4) return text;
  return text.split(secret).join(maskKey(secret));
}

/** Options for {@link ProviderKeyStore}. */
export interface ProviderKeyStoreOptions {
  /** Directory for `secret.key` and `provider-keys.json` (the Cortex data dir). */
  readonly dir: string;
  /** Environment read for env keys (default `process.env`; read on every call). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Clock for `updatedAt` (tests). */
  readonly now?: () => number;
}

/** File-backed, encrypted store of provider API keys. One instance per Cortex server. */
export class ProviderKeyStore {
  readonly dir: string;
  private readonly envOf: () => Readonly<Record<string, string | undefined>>;
  private readonly now: () => number;

  constructor(opts: ProviderKeyStoreOptions) {
    this.dir = opts.dir;
    this.envOf = () => opts.env ?? process.env;
    this.now = opts.now ?? Date.now;
  }

  /** Path of the AES key file. */
  get secretKeyPath(): string {
    return join(this.dir, SECRET_KEY_FILE);
  }

  /** Path of the sealed keys file. */
  get keysPath(): string {
    return join(this.dir, PROVIDER_KEYS_FILE);
  }

  /** Status of every keyed provider. */
  list(): StoreResult<readonly ProviderKeyStatus[]> {
    const file = this.readFile();
    if (!file.ok) return file;
    return ok(Object.keys(KEYED_PROVIDER_ENV).map((p) => this.statusFrom(p, file.value)));
  }

  /** Status of one provider. */
  status(provider: string): StoreResult<ProviderKeyStatus> {
    if (!isKeyedProvider(provider)) return err("unknown-provider", `no stored key support for provider "${provider}"`);
    const file = this.readFile();
    if (!file.ok) return file;
    return ok(this.statusFrom(provider, file.value));
  }

  /** Save (or replace) a provider's key. `preferStored` defaults to the current choice, else false. */
  set(provider: string, apiKey: string, preferStored?: boolean): StoreResult<ProviderKeyStatus> {
    if (!isKeyedProvider(provider)) return err("unknown-provider", `no stored key support for provider "${provider}"`);
    const key = apiKey.trim();
    if (!key) return err("empty-key", "API key is empty");
    const secret = this.secretKey(true);
    if (!secret.ok) return secret;
    const file = this.readFile();
    if (!file.ok) return file;
    const entry = this.seal(provider, key, secret.value, preferStored ?? file.value.keys[provider]?.preferStored ?? false);
    const written = this.writeFile({ v: 1, keys: { ...file.value.keys, [provider]: entry } });
    if (!written.ok) return written;
    return this.status(provider);
  }

  // ─── generic secrets (channel credentials) ───
  // Same sealing, files and permissions as provider keys, but ids are not providers: they never
  // appear in `list()` / `status()` and never reach `keyForAgent`. Callers namespace the id
  // (`channel:<channelId>:<field>`, see `channel-credentials.ts`).

  /** Seal `value` under `id` (replacing any earlier value). Returns the mask and save time, never the value. */
  putSecret(id: string, value: string): StoreResult<{ readonly masked: string; readonly updatedAt: number }> {
    const plain = value.trim();
    if (!plain) return err("empty-key", "value is empty");
    const secret = this.secretKey(true);
    if (!secret.ok) return secret;
    const file = this.readFile();
    if (!file.ok) return file;
    const entry = this.seal(id, plain, secret.value, false);
    const written = this.writeFile({ v: 1, keys: { ...file.value.keys, [id]: entry } });
    if (!written.ok) return written;
    return ok({ masked: maskKey(plain), updatedAt: entry.updatedAt });
  }

  /** The decrypted secret under `id`, or undefined when none is stored or it cannot be read. */
  getSecret(id: string): string | undefined {
    const file = this.readFile();
    if (!file.ok) return undefined;
    const entry = file.value.keys[id];
    return entry ? this.open(id, entry) : undefined;
  }

  /** Mask and save time of the secret under `id` (never the value), or null when none is readable. */
  secretMeta(id: string): { readonly masked: string; readonly updatedAt: number } | null {
    const file = this.readFile();
    if (!file.ok) return null;
    const entry = file.value.keys[id];
    const plain = entry ? this.open(id, entry) : undefined;
    return entry && plain !== undefined ? { masked: maskKey(plain), updatedAt: entry.updatedAt } : null;
  }

  /** Remove the secret under `id` (no-op when none is stored). */
  removeSecret(id: string): StoreResult<void> {
    const file = this.readFile();
    if (!file.ok) return file;
    if (!file.value.keys[id]) return ok(undefined);
    const { [id]: _removed, ...rest } = file.value.keys;
    return this.writeFile({ v: 1, keys: rest });
  }

  /** Change whether the stored key wins over an env key. */
  setPreferStored(provider: string, preferStored: boolean): StoreResult<ProviderKeyStatus> {
    if (!isKeyedProvider(provider)) return err("unknown-provider", `no stored key support for provider "${provider}"`);
    const file = this.readFile();
    if (!file.ok) return file;
    const entry = file.value.keys[provider];
    if (!entry) return err("not-found", `no stored key for provider "${provider}"`);
    const written = this.writeFile({ v: 1, keys: { ...file.value.keys, [provider]: { ...entry, preferStored } } });
    if (!written.ok) return written;
    return this.status(provider);
  }

  /** Remove a provider's stored key (no-op when none is stored). */
  remove(provider: string): StoreResult<ProviderKeyStatus> {
    if (!isKeyedProvider(provider)) return err("unknown-provider", `no stored key support for provider "${provider}"`);
    const file = this.readFile();
    if (!file.ok) return file;
    if (file.value.keys[provider]) {
      const { [provider]: _removed, ...rest } = file.value.keys;
      const written = this.writeFile({ v: 1, keys: rest });
      if (!written.ok) return written;
    }
    return this.status(provider);
  }

  /** The decrypted stored key, or undefined when none is stored or it cannot be read. */
  storedKey(provider: string): string | undefined {
    if (!isKeyedProvider(provider)) return undefined;
    const file = this.readFile();
    if (!file.ok) return undefined;
    const entry = file.value.keys[provider];
    return entry ? this.open(provider, entry) : undefined;
  }

  /**
   * The key to hand the agent for `provider`: the stored key when it wins the
   * precedence (no env key, or `preferStored`), else undefined (the framework then
   * reads its env variable itself, as before).
   */
  keyForAgent(provider: string): string | undefined {
    if (!isKeyedProvider(provider)) return undefined;
    const file = this.readFile();
    if (!file.ok) return undefined;
    const entry = file.value.keys[provider];
    if (!entry) return undefined;
    if (this.envSet(provider) && !entry.preferStored) return undefined;
    return this.open(provider, entry);
  }

  // ─── internals ───

  private envSet(provider: string): boolean {
    const env = this.envOf();
    return (KEYED_PROVIDER_ENV[provider] ?? []).some((name) => Boolean(env[name]?.trim()));
  }

  private statusFrom(provider: string, file: KeysFile): ProviderKeyStatus {
    const envSet = this.envSet(provider);
    const entry = file.keys[provider];
    const plain = entry ? this.open(provider, entry) : undefined;
    const stored = entry && plain !== undefined
      ? { masked: maskKey(plain), updatedAt: entry.updatedAt, preferStored: entry.preferStored }
      : null;
    const source: ProviderKeySource =
      stored && (stored.preferStored || !envSet) ? "stored" : envSet ? "env" : "none";
    return {
      provider,
      env: KEYED_PROVIDER_ENV[provider] ?? [],
      envSet,
      stored,
      unreadable: entry !== undefined && plain === undefined,
      source,
      appliesToAgents: storedKeyAppliesToAgents(provider),
    };
  }

  private seal(id: string, plain: string, secret: Buffer, preferStored: boolean): SealedEntry {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", secret, iv);
    cipher.setAAD(Buffer.from(id, "utf8"));
    const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return {
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
      kid: kidOf(secret),
      updatedAt: this.now(),
      preferStored,
    };
  }

  private open(provider: string, entry: SealedEntry): string | undefined {
    const secret = this.secretKey(false);
    if (!secret.ok || entry.kid !== kidOf(secret.value)) return undefined;
    try {
      const decipher = createDecipheriv("aes-256-gcm", secret.value, Buffer.from(entry.iv, "base64"));
      decipher.setAAD(Buffer.from(provider, "utf8"));
      decipher.setAuthTag(Buffer.from(entry.tag, "base64"));
      return Buffer.concat([decipher.update(Buffer.from(entry.data, "base64")), decipher.final()]).toString("utf8");
    } catch {
      return undefined;
    }
  }

  /** Read the AES key; with `create`, make it (0600, exclusive) when absent. */
  private secretKey(create: boolean): StoreResult<Buffer> {
    const path = this.secretKeyPath;
    try {
      if (!existsSync(path)) {
        if (!create) return err("not-found", "no secret key yet");
        mkdirSync(this.dir, { recursive: true });
        const fd = openSync(path, "wx", FILE_MODE);
        try {
          writeSync(fd, randomBytes(32));
        } finally {
          closeSync(fd);
        }
      }
      tighten(path);
      const key = readFileSync(path);
      if (key.length !== 32) return err("corrupt", `${SECRET_KEY_FILE} is not a 32-byte key; stored keys cannot be read`);
      return ok(key);
    } catch (e) {
      return err("io", `cannot read ${SECRET_KEY_FILE}: ${messageOf(e)}`);
    }
  }

  private readFile(): StoreResult<KeysFile> {
    const path = this.keysPath;
    if (!existsSync(path)) return ok({ v: 1, keys: {} });
    try {
      tighten(path);
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (!isKeysFile(parsed)) return err("corrupt", `${PROVIDER_KEYS_FILE} is not a Cortex keys file`);
      return ok(parsed);
    } catch (e) {
      return err("corrupt", `cannot read ${PROVIDER_KEYS_FILE}: ${messageOf(e)}`);
    }
  }

  private writeFile(file: KeysFile): StoreResult<void> {
    const tmp = `${this.keysPath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(tmp, JSON.stringify(file, null, 2), { mode: FILE_MODE, flag: "wx" });
      renameSync(tmp, this.keysPath);
      tighten(this.keysPath);
      return ok(undefined);
    } catch (e) {
      try {
        if (existsSync(tmp)) unlinkSync(tmp);
      } catch {
        /* best effort */
      }
      return err("io", `cannot write ${PROVIDER_KEYS_FILE}: ${messageOf(e)}`);
    }
  }
}

const kidOf = (key: Buffer): string => createHash("sha256").update(key).digest("hex").slice(0, 8);

/** Drop group/other permission bits a file may have picked up (e.g. copied by hand). */
function tighten(path: string): void {
  if (process.platform === "win32") return;
  if ((statSync(path).mode & 0o077) !== 0) chmodSync(path, FILE_MODE);
}

function isKeysFile(v: unknown): v is KeysFile {
  if (typeof v !== "object" || v === null) return false;
  const o = v as { v?: unknown; keys?: unknown };
  if (o.v !== 1 || typeof o.keys !== "object" || o.keys === null) return false;
  return Object.values(o.keys as Record<string, unknown>).every((e) => {
    if (typeof e !== "object" || e === null) return false;
    const s = e as Record<string, unknown>;
    return (
      typeof s.iv === "string" &&
      typeof s.tag === "string" &&
      typeof s.data === "string" &&
      typeof s.kid === "string" &&
      typeof s.updatedAt === "number" &&
      typeof s.preferStored === "boolean"
    );
  });
}

// ─── The server's store ───

let installed: ProviderKeyStore | null = null;

/**
 * Install the server's store (called once by `startCortexServer`). Build paths read
 * it through {@link providerKeyForAgent}, so chat, desk runs and gateway agents get
 * the same key without each path threading it. Pass null to uninstall (tests).
 */
export function installProviderKeyStore(store: ProviderKeyStore | null): void {
  installed = store;
}

/** The installed store, or null (no server started, e.g. unit tests). */
export function installedProviderKeyStore(): ProviderKeyStore | null {
  return installed;
}

/**
 * The stored key the agent for `provider` should get, or undefined (env or none).
 * An Ollama key is withheld while the effective Ollama endpoint is loopback: a local server
 * needs none and the key never goes to localhost.
 */
export function providerKeyForAgent(provider: string | undefined): string | undefined {
  if (!provider || !installed) return undefined;
  const key = installed.keyForAgent(provider);
  if (key !== undefined && provider === "ollama" && !ollamaKeyApplies(effectiveOllamaEndpoint())) return undefined;
  return key;
}
