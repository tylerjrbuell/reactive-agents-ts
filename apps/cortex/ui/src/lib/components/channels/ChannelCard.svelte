<script lang="ts">
  /**
   * One messaging channel of a gateway agent: name, on/off, its non-secret settings, its
   * credential, and a connection test. The credential is write-only: typed here, sent once
   * (`PUT`), and from then on only its mask is shown; it never enters the agent config.
   * Rules: `lib/channels.ts`. Calls: `lib/gateway-api.ts`.
   */
  import { onMount } from "svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { confirmAction } from "$lib/stores/confirm-store.js";
  import { channelIssues, channelKindInfo, channelName, webhookRoute, type ChannelEntry, type ChannelSettings } from "$lib/channels.js";
  import { deleteCredential, fetchCredentials, saveCredential, testChannel, type CredentialField } from "$lib/gateway-api.js";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Field from "$lib/components/kit/Field.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import Switch from "$lib/components/kit/Switch.svelte";

  interface Props {
    channel: ChannelEntry;
    onChange: (patch: { label?: string; enabled?: boolean; settings?: Partial<Record<keyof ChannelSettings, ChannelSettings[keyof ChannelSettings] | undefined>> }) => void;
    /** The channel is being removed; the parent drops it from the config after the credentials are gone. */
    onRemove: () => void;
  }
  let { channel, onChange, onRemove }: Props = $props();

  const info = $derived(channelKindInfo(channel.kind));
  const cred = $derived(info.credential);
  const fid = (name: string) => `ch-${channel.id}-${name}`;

  let saved = $state<CredentialField | null>(null);
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let editing = $state(false);
  let draft = $state("");
  let busy = $state(false);
  let result = $state<{ tone: "ok" | "bad"; text: string } | null>(null);

  const issues = $derived(channelIssues(channel, saved?.masked != null));
  /** The credential input shows when none is saved, or while replacing. A value typed there can be tested before it is saved. */
  const showForm = $derived(editing || !saved?.masked);

  async function load() {
    loading = true;
    const r = await fetchCredentials(CORTEX_SERVER_URL, fetch, channel.id, channel.kind);
    loading = false;
    if (r.ok) {
      saved = r.value.find((f) => f.field === cred.field) ?? null;
      loadError = null;
    } else {
      loadError = r.error;
    }
  }
  onMount(() => void load());

  async function save() {
    const value = draft.trim();
    if (!value) return;
    busy = true;
    const r = await saveCredential(CORTEX_SERVER_URL, fetch, channel.id, channel.kind, cred.field, value);
    busy = false;
    if (!r.ok) {
      toast.error(`${cred.label} not saved`, r.error);
      return;
    }
    saved = r.value;
    draft = "";
    editing = false;
    result = null;
    toast.success(`${cred.label} saved`, "Stored encrypted on the Cortex server.");
  }

  async function clearCredential() {
    const ok = await confirmAction({
      title: `Remove the saved ${cred.label.toLowerCase()}?`,
      message: "The channel stops connecting until you save a new one.",
      confirmLabel: "Remove",
    });
    if (!ok) return;
    busy = true;
    const r = await deleteCredential(CORTEX_SERVER_URL, fetch, channel.id, channel.kind, cred.field);
    busy = false;
    if (!r.ok) {
      toast.error("Not removed", r.error);
      return;
    }
    saved = r.value.find((f) => f.field === cred.field) ?? null;
    result = null;
  }

  async function test() {
    busy = true;
    const typed = showForm ? draft.trim() : "";
    const r = await testChannel(CORTEX_SERVER_URL, fetch, {
      channelId: channel.id,
      kind: channel.kind,
      settings: channel.settings,
      ...(typed ? { credentials: { [cred.field]: typed } } : {}),
    });
    busy = false;
    result = r.ok ? { tone: r.value.ok ? "ok" : "bad", text: r.value.detail } : { tone: "bad", text: r.error };
  }

  async function remove() {
    const ok = await confirmAction({
      title: `Remove ${channelName(channel)}?`,
      message: "Its saved credential is deleted too.",
      confirmLabel: "Remove channel",
    });
    if (ok) onRemove();
  }

  const num = (v: string): number | undefined => {
    const n = Number(v);
    return v.trim() !== "" && Number.isFinite(n) ? n : undefined;
  };
</script>

<article class="chan" class:chan-off={!channel.enabled} aria-labelledby={fid("name")}>
  <header class="chan-h">
    <div class="chan-t">
      <h4 id={fid("name")}>{channelName(channel)}</h4>
      <Badge tone="io">{info.label}</Badge>
      {#if !loading && saved?.masked}
        <Badge tone="ok">Credential saved</Badge>
      {:else if !loading}
        <Badge tone="warn">No credential</Badge>
      {/if}
    </div>
    <div class="chan-a">
      <Switch id={fid("on")} label="On" checked={channel.enabled} onchange={(v) => onChange({ enabled: v })} />
      <Button size="sm" variant="ghost" icon="trash" onclick={remove} aria-label="Remove {channelName(channel)}">Remove</Button>
    </div>
  </header>
  <p class="chan-blurb">{info.blurb}</p>

  <div class="chan-grid">
    <Field id={fid("label")} label="Name" hint="Shown in the overview. Optional.">
      <Input id={fid("label")} value={channel.label ?? ""} placeholder={info.label} oninput={(e) => onChange({ label: (e.currentTarget as HTMLInputElement).value })} describedBy="{fid('label')}-hint" />
    </Field>

    {#if channel.kind === "signal"}
      <Field id={fid("transport")} label="signal-cli" hint={channel.settings.transport === "process" ? "Cortex starts signal-cli itself. The number then shows in the host's process list." : "Connect to a running daemon: signal-cli daemon --tcp 127.0.0.1:7583."}>
        <Select
          id={fid("transport")}
          value={channel.settings.transport ?? "socket"}
          options={[
            { value: "socket", label: "Connect to a daemon", description: "Recommended on a shared host" },
            { value: "process", label: "Start signal-cli", description: "Cortex spawns it" },
          ]}
          onchange={(v) => onChange({ settings: { transport: v === "process" ? "process" : "socket" } })}
          describedBy="{fid('transport')}-hint"
        />
      </Field>
      {#if channel.settings.transport !== "process"}
        <Field id={fid("host")} label="Daemon host" hint="Default 127.0.0.1.">
          <Input id={fid("host")} mono value={channel.settings.host ?? ""} placeholder="127.0.0.1" oninput={(e) => onChange({ settings: { host: (e.currentTarget as HTMLInputElement).value.trim() || undefined } })} describedBy="{fid('host')}-hint" />
        </Field>
        <Field id={fid("port")} label="Daemon port" hint="Default 7583.">
          <Input id={fid("port")} mono inputmode="numeric" value={channel.settings.port === undefined ? "" : String(channel.settings.port)} placeholder="7583" oninput={(e) => onChange({ settings: { port: num((e.currentTarget as HTMLInputElement).value) } })} describedBy="{fid('port')}-hint" />
        </Field>
      {/if}
    {:else if channel.kind === "webhook"}
      <Field id={fid("ingress")} label="Listen port" hint="Cortex listens on 127.0.0.1 at this port. Front it with a tunnel or proxy to reach it.">
        <Input id={fid("ingress")} mono inputmode="numeric" value={channel.settings.ingressPort === undefined ? "" : String(channel.settings.ingressPort)} placeholder="7700" oninput={(e) => onChange({ settings: { ingressPort: num((e.currentTarget as HTMLInputElement).value) } })} describedBy="{fid('ingress')}-hint" />
      </Field>
      <Field id={fid("route")} label="Path" hint="Senders POST here: {webhookRoute(channel)}">
        <Input id={fid("route")} mono value={channel.settings.route ?? ""} placeholder="/channels/{channel.id}" oninput={(e) => onChange({ settings: { route: (e.currentTarget as HTMLInputElement).value.trim() || undefined } })} describedBy="{fid('route')}-hint" />
      </Field>
      <Field id={fid("reply")} label="Reply URL" hint="Where the agent's replies are POSTed as JSON. Leave empty to receive only.">
        <Input id={fid("reply")} mono value={channel.settings.replyUrl ?? ""} placeholder="https://example.com/reply" oninput={(e) => onChange({ settings: { replyUrl: (e.currentTarget as HTMLInputElement).value.trim() || undefined } })} describedBy="{fid('reply')}-hint" />
      </Field>
    {/if}
  </div>

  <div class="chan-cred">
    <div class="chan-cred-h">
      <span class="chan-cred-l">{cred.label}</span>
      {#if saved?.masked}<span class="chan-mask" aria-label="Saved, ends in {saved.masked.replace(/•/g, '')}">{saved.masked}</span>{/if}
    </div>
    {#if loadError}
      <p class="chan-bad" role="status">Could not read saved credentials: {loadError}</p>
    {:else if showForm}
      <form class="chan-form" onsubmit={(e) => { e.preventDefault(); void save(); }}>
        <label class="chan-sr" for={fid("cred")}>{cred.label}</label>
        <Input id={fid("cred")} type="password" mono autocomplete="off" spellcheck={false} placeholder={cred.placeholder} bind:value={draft} describedBy="{fid('cred')}-hint" />
        <Button size="sm" variant="primary" type="submit" disabled={!draft.trim() || busy}>Save</Button>
        {#if editing}<Button size="sm" variant="ghost" onclick={() => { editing = false; draft = ""; }}>Cancel</Button>{/if}
      </form>
      <p id="{fid('cred')}-hint" class="chan-hint">{cred.hint}</p>
    {:else}
      <div class="chan-form">
        <Button size="sm" onclick={() => (editing = true)}>Replace</Button>
        <Button size="sm" variant="ghost" disabled={busy} onclick={clearCredential}>Remove</Button>
      </div>
    {/if}
  </div>

  {#if issues.length > 0 && !loading}
    <ul class="chan-issues" aria-label="What stops this channel from starting">
      {#each issues as issue (issue)}<li>{issue}</li>{/each}
    </ul>
  {/if}

  <div class="chan-test">
    <Button size="sm" disabled={busy || (!saved?.masked && !draft.trim())} onclick={test}>Test connection</Button>
    {#if result}
      <p class="chan-result" class:chan-ok={result.tone === "ok"} class:chan-bad={result.tone === "bad"} role="status">{result.text}</p>
    {/if}
  </div>
</article>

<style>
  .chan { display: grid; gap: 12px; padding: 14px 16px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); background: var(--cortex-canvas); }
  .chan-off { opacity: 0.78; }
  .chan-h { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; }
  .chan-t { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
  .chan-t h4 { margin: 0; font-size: var(--cortex-t-md); font-weight: 600; color: var(--cortex-text); }
  .chan-a { display: flex; align-items: center; gap: 12px; }
  .chan-blurb { margin: 0; font-size: var(--cortex-t-xs); line-height: var(--cortex-lh-ui); color: var(--cortex-text-2); }
  .chan-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
  .chan-cred { display: grid; gap: 6px; padding-top: 12px; border-top: 1px solid var(--cortex-line); }
  .chan-cred-h { display: flex; align-items: center; gap: 10px; }
  .chan-cred-l { font-size: var(--cortex-t-xs); font-weight: 500; color: var(--cortex-text-2); }
  .chan-mask { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-2); }
  .chan-form { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .chan-form :global(input) { flex: 1; min-width: 220px; }
  .chan-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .chan-hint { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .chan-issues { margin: 0; padding: 8px 12px 8px 28px; font-size: var(--cortex-t-xs); color: var(--cortex-warn); background: var(--cortex-warn-tint); border-radius: var(--cortex-r-ctl); }
  .chan-test { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .chan-result { margin: 0; font-size: var(--cortex-t-xs); }
  .chan-ok { color: var(--cortex-ok); }
  .chan-bad { color: var(--cortex-bad); }
</style>
