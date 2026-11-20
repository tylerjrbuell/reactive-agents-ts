<script lang="ts">
  /**
   * One HTTP server's OAuth sign-in: a state chip, one detail line and the actions that apply
   * (Sign in, Cancel, Sign out). While a sign-in waits, the authorization link stays visible so a
   * blocked pop-up never strands the person. The framework does the flow (loopback redirect on the
   * computer running Cortex); rules in `lib/mcp-oauth-view.ts`. The page owns every call.
   */
  import Button from "$lib/components/kit/Button.svelte";
  import Status from "$lib/components/kit/Status.svelte";
  import { authActions, authChip, authDetail, type McpServerAuth } from "$lib/mcp-oauth-view.js";

  interface Props {
    auth: McpServerAuth;
    now?: number;
    /** A sign-in, cancel or sign-out call is running. */
    busy?: boolean;
    onSignIn: () => void;
    onCancel: () => void;
    onSignOut: () => void;
  }
  const { auth, now = Date.now(), busy = false, onSignIn, onCancel, onSignOut }: Props = $props();

  const chip = $derived(authChip(auth));
  const actions = $derived(authActions(auth));
  const failedSignIn = $derived(auth.signIn?.phase === "failed" && auth.state === "absent");
</script>

<div class="ssi" data-testid="server-sign-in">
  <div class="ssi-text">
    <span class="ssi-title">OAuth</span>
    {#if chip}<Status tone={chip.tone} label={chip.label} />{/if}
    <span class="ssi-detail" class:bad={failedSignIn}>{authDetail(auth, now)}</span>
  </div>
  <div class="ssi-actions">
    {#if auth.signIn?.phase === "pending"}
      <a class="ssi-link" href={auth.signIn.authorizationUrl} target="_blank" rel="noopener noreferrer">Open the sign-in page</a>
    {/if}
    {#if actions.signIn}<Button size="sm" variant="primary" disabled={busy} onclick={onSignIn}>{auth.state === "absent" ? "Sign in" : "Sign in again"}</Button>{/if}
    {#if actions.cancel}<Button size="sm" disabled={busy} onclick={onCancel}>Cancel</Button>{/if}
    {#if actions.signOut}<Button size="sm" variant="ghost" disabled={busy} onclick={onSignOut}>Sign out</Button>{/if}
  </div>
</div>

<style>
  .ssi { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-2); }
  .ssi-text { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
  .ssi-title { font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-text); }
  .ssi-detail { font-size: var(--cortex-t-xs); color: var(--cortex-text-2); overflow-wrap: anywhere; }
  .ssi-detail.bad { color: var(--cortex-bad); }
  .ssi-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .ssi-link { font-size: var(--cortex-t-sm); color: var(--cortex-accent); text-decoration: underline; text-underline-offset: 2px; }
  .ssi-link:focus-visible { outline: 2px solid var(--cortex-accent); outline-offset: 2px; border-radius: 2px; }
</style>
