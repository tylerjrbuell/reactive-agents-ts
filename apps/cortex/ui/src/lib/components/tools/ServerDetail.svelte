<script lang="ts">
  /**
   * One server's detail pane: name and state, the actions (Test, Refresh tools, the Enable switch,
   * Edit, Remove), a failed-server card with the scrubbed last error, the inline test result, and
   * the Tools | Options | Credentials tabs. State words: `lib/mcp-servers-view.ts`. The page owns
   * every call; this component only reports what the person did.
   */
  import Button from "$lib/components/kit/Button.svelte";
  import Status from "$lib/components/kit/Status.svelte";
  import Switch from "$lib/components/kit/Switch.svelte";
  import Tabs from "$lib/components/kit/Tabs.svelte";
  import CheckingChip from "$lib/components/tools/CheckingChip.svelte";
  import ServerToolsPane from "$lib/components/tools/ServerToolsPane.svelte";
  import ServerOptionsPane from "$lib/components/tools/ServerOptionsPane.svelte";
  import ServerCredentialsPane from "$lib/components/tools/ServerCredentialsPane.svelte";
  import ServerSignIn from "$lib/components/tools/ServerSignIn.svelte";
  import type { McpServerAuth } from "$lib/mcp-oauth-view.js";
  import { DETAIL_TABS, failureOf, serverListRow, testOutcomeText, type DetailTab, type TestReply } from "$lib/mcp-servers-view.js";
  import { tabPanelId, tabId } from "$lib/tablist.js";
  import type { McpDraft, McpListRow, McpToolDetail, secretsPayload } from "$lib/tool-workshop.js";

  interface Props {
    row: McpListRow;
    /** Cached tools with schemas; null while loading. */
    tools: readonly McpToolDetail[] | null;
    toolsError?: string | null;
    /** The last Test result, shown inline (never persisted as tools). */
    testResult: TestReply | null;
    testing: boolean;
    refreshing: boolean;
    /** An options or credentials save is running. */
    saving: boolean;
    now?: number;
    /** A background check of this server is running. */
    checking?: boolean;
    /** Bumped after each credentials save so typed values clear (the stored ones stay write-only). */
    credentialsVersion?: number;
    onTest: () => void;
    onRefresh: () => void;
    onToggleEnabled: (enabled: boolean) => void;
    onEdit: () => void;
    onRemove: () => void;
    onSaveOptions: (draft: McpDraft) => void | Promise<void>;
    onSaveCredentials: (payload: NonNullable<ReturnType<typeof secretsPayload>>) => void | Promise<void>;
    /** OAuth sign-in state; absent for servers sign-in does not apply to (stdio, machine grants). */
    auth?: McpServerAuth;
    /** A sign-in, cancel or sign-out call is running. */
    authBusy?: boolean;
    onSignIn?: () => void;
    onCancelSignIn?: () => void;
    onSignOut?: () => void;
  }
  const { row, tools, toolsError = null, testResult, testing, refreshing, saving, now = Date.now(), checking = false, credentialsVersion = 0, onTest, onRefresh, onToggleEnabled, onEdit, onRemove, onSaveOptions, onSaveCredentials, auth, authBusy = false, onSignIn = () => undefined, onCancelSignIn = () => undefined, onSignOut = () => undefined }: Props = $props();

  /** The last check or Test said "sign in first", and no login is stored yet. */
  const wantsSignIn = $derived(auth !== undefined && auth.state === "absent" && (auth.authRequired || (testResult !== null && !testResult.ok && testResult.authRequired === true)));

  let tab = $state<DetailTab>("tools");
  const view = $derived(serverListRow(row, now, checking));
  const failure = $derived(failureOf(row));
  const enabled = $derived(row.enabled !== false);
  const keysOf = (v: unknown): string => (v !== null && typeof v === "object" ? Object.keys(v).join(",") : "");
  const credentialKeys = $derived(`${credentialsVersion}|${keysOf(row.config.env)}|${keysOf(row.config.headers)}`);
  const TABS = DETAIL_TABS.map((t) => ({ id: t.id, label: t.label }));
</script>

<section class="sd" aria-label="Server {row.name}" data-testid="server-detail">
  <header class="sd-h">
    <div class="sd-title">
      <h3>{row.name}</h3>
      {#if view.checking}<CheckingChip />{:else}<Status tone={view.tone} label={view.label} />{/if}
      <span class="sd-meta">{view.toolText}{view.checkedText ? ` · ${view.checkedText}` : ""}</span>
    </div>
    <div class="sd-actions">
      <Switch id="sd-enabled" label={enabled ? "Enabled" : "Disabled"} checked={enabled} onchange={onToggleEnabled} />
      <Button size="sm" icon="play" disabled={testing || !enabled} onclick={onTest}>{testing ? "Testing…" : "Test"}</Button>
      <Button size="sm" icon="retry" disabled={refreshing || !enabled} onclick={onRefresh}>{refreshing ? "Refreshing…" : "Refresh tools"}</Button>
      <Button size="sm" icon="edit" onclick={onEdit}>Edit</Button>
      <Button size="sm" variant="danger" icon="trash" onclick={onRemove}>Remove</Button>
    </div>
  </header>

  {#if testResult}
    <p class="sd-test" class:bad={!testResult.ok} role="status" data-testid="server-test-result">{testOutcomeText(testResult)}</p>
  {/if}

  {#if auth && enabled}
    <ServerSignIn {auth} {now} busy={authBusy} onSignIn={onSignIn} onCancel={onCancelSignIn} onSignOut={onSignOut} />
  {/if}

  {#if !enabled}
    <div class="sd-card" data-testid="server-disabled-card">
      <p>This server is switched off. An agent never starts it, so its tools are not offered anywhere.</p>
      <Button size="sm" onclick={() => onToggleEnabled(true)}>Enable</Button>
    </div>
  {:else if failure}
    <div class="sd-card bad" role="alert" data-testid="server-failed-card">
      <p class="sd-why">{wantsSignIn ? "This server asks you to sign in before it answers. Sign in, then Retry." : failure}</p>
      <div class="sd-card-actions">
        {#if wantsSignIn}<Button size="sm" variant="primary" disabled={authBusy} onclick={onSignIn}>Sign in</Button>{/if}
        <Button size="sm" icon="retry" disabled={testing} onclick={onTest}>Retry</Button>
        <Button size="sm" icon="edit" onclick={onEdit}>Edit config</Button>
      </div>
    </div>
  {/if}

  <Tabs items={TABS} bind:value={tab} label="Server details" idBase="sd" />
  <div class="sd-panel" role="tabpanel" id={tabPanelId("sd", tab)} aria-labelledby={tabId("sd", tab)}>
    {#if tab === "tools"}
      <ServerToolsPane serverName={row.name} config={row.config} {tools} error={toolsError} />
    {:else if tab === "options"}
      <ServerOptionsPane {row} {saving} onSave={onSaveOptions} />
    {:else}
      <!-- Remount when the stored key names change, so a saved row reads "Set" and a removed one is gone. -->
      {#key credentialKeys}
        <ServerCredentialsPane {row} {saving} onSave={onSaveCredentials} />
      {/key}
    {/if}
  </div>
</section>

<style>
  .sd { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  .sd-h { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
  .sd-title { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; min-width: 0; }
  h3 { margin: 0; font-family: var(--cortex-font-data); font-size: var(--cortex-t-md); font-weight: 600; color: var(--cortex-text); }
  .sd-meta { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .sd-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .sd-test { margin: 0; padding: 8px 10px; border-radius: var(--cortex-r-ctl); background: var(--cortex-ok-tint, var(--cortex-surface-2)); color: var(--cortex-ok); font-size: var(--cortex-t-sm); }
  .sd-test.bad { background: var(--cortex-bad-tint); color: var(--cortex-bad); }
  .sd-card { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 12px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-2); }
  .sd-card p { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  .sd-card.bad { border-color: color-mix(in srgb, var(--cortex-bad) 40%, transparent); background: var(--cortex-bad-tint); }
  .sd-card.bad .sd-why { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-bad); overflow-wrap: anywhere; }
  .sd-card-actions { display: flex; gap: 8px; }
  .sd-panel { min-height: 0; }
</style>
