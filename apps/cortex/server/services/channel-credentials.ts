/**
 * Channel credentials: write-only through the API, sealed at rest.
 *
 * Reuses the provider key store (`provider-key-store.ts`): AES-256-GCM, `secret.key` and the
 * sealed entries file in the Cortex data dir, mode 0600. A credential's key-store id is
 * `channel:<channelId>:<field>`, so it can never collide with a provider id, never shows in the
 * Providers panel, and is bound to its channel by the cipher's AAD.
 *
 * Reads: `status` returns only a mask (`••••last4`) and the save time. The value is read only by
 * {@link ChannelCredentials.value}, called when an adapter is built or tested, and never logged.
 * Nothing here throws: every operation returns a tagged result.
 */
import { CHANNEL_CREDENTIAL_FIELDS, CHANNEL_ID_PATTERN, type ChannelKind } from "./channel-config.js";
import { installedProviderKeyStore, type ProviderKeyStore, type StoreResult } from "./provider-key-store.js";

/** One credential field as the API reports it: never the value. */
export interface ChannelCredentialField {
  readonly field: string;
  /** `••••last4` of the saved value, or null when none is saved. */
  readonly masked: string | null;
  readonly updatedAt: number | null;
}

const keyId = (channelId: string, field: string): string => `channel:${channelId}:${field}`;

const bad = <A>(message: string): StoreResult<A> => ({
  ok: false,
  error: { _tag: "ProviderKeyStoreError", reason: "unknown-provider", message },
});

/** Credential access for channels over one {@link ProviderKeyStore}. */
export class ChannelCredentials {
  constructor(private readonly store: ProviderKeyStore) {}

  /** Whether `field` is a credential of `kind` and `channelId` is a well-formed id. */
  private check(channelId: string, kind: ChannelKind, field: string): string | undefined {
    if (!CHANNEL_ID_PATTERN.test(channelId)) return "invalid channel id";
    if (!CHANNEL_CREDENTIAL_FIELDS[kind].includes(field)) return `"${field}" is not a credential of a ${kind} channel`;
    return undefined;
  }

  /** Every credential field of the channel with its mask (null = not saved). */
  status(channelId: string, kind: ChannelKind): readonly ChannelCredentialField[] {
    return CHANNEL_CREDENTIAL_FIELDS[kind].map((field) => {
      const meta = CHANNEL_ID_PATTERN.test(channelId) ? this.store.secretMeta(keyId(channelId, field)) : null;
      return { field, masked: meta?.masked ?? null, updatedAt: meta?.updatedAt ?? null };
    });
  }

  /** Save (or replace) one credential. Returns its status, not the value. */
  set(channelId: string, kind: ChannelKind, field: string, value: string): StoreResult<ChannelCredentialField> {
    const problem = this.check(channelId, kind, field);
    if (problem) return bad(problem);
    const r = this.store.putSecret(keyId(channelId, field), value);
    return r.ok ? { ok: true, value: { field, masked: r.value.masked, updatedAt: r.value.updatedAt } } : r;
  }

  /** The saved value, for building or probing an adapter. Undefined when none is saved. */
  value(channelId: string, field: string): string | undefined {
    return CHANNEL_ID_PATTERN.test(channelId) ? this.store.getSecret(keyId(channelId, field)) : undefined;
  }

  /** Remove one credential. */
  remove(channelId: string, kind: ChannelKind, field: string): StoreResult<void> {
    const problem = this.check(channelId, kind, field);
    return problem ? bad(problem) : this.store.removeSecret(keyId(channelId, field));
  }

  /** Remove every credential of a channel (the channel was deleted). */
  removeAll(channelId: string): void {
    if (!CHANNEL_ID_PATTERN.test(channelId)) return;
    for (const fields of Object.values(CHANNEL_CREDENTIAL_FIELDS)) {
      for (const f of fields) this.store.removeSecret(keyId(channelId, f));
    }
  }
}

/** Credentials over the installed key store, or null when no server installed one (unit tests). */
export function installedChannelCredentials(): ChannelCredentials | null {
  const store = installedProviderKeyStore();
  return store ? new ChannelCredentials(store) : null;
}
