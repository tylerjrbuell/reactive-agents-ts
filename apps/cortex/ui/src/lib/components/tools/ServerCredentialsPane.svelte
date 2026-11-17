<script lang="ts">
  /**
   * The Credentials tab of a server: environment variables and headers as write-only rows. Values
   * are never read back; typing in a stored row replaces it, removing a row deletes the key. The
   * save body is `secretsPayload` (`lib/tool-workshop.ts`) for `PUT /api/mcp-servers/:id/secrets`.
   */
  import { untrack } from "svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import CredentialList from "$lib/components/tools/CredentialList.svelte";
  import { credentialEdit, credentialRowsOf, secretsPayload, type McpListRow } from "$lib/tool-workshop.js";

  interface Props {
    row: McpListRow;
    saving: boolean;
    /** The request body to send (the page owns the call). */
    onSave: (payload: NonNullable<ReturnType<typeof secretsPayload>>) => void | Promise<void>;
  }
  const { row, saving, onSave }: Props = $props();

  const record = (v: unknown): Record<string, unknown> | undefined => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
  // The pane remounts per server (`{#key}` in ServerDetail), so the rows start from the row once.
  const storedEnv = untrack(() => Object.keys(record(row.config.env) ?? {}));
  const storedHeaders = untrack(() => Object.keys(record(row.config.headers) ?? {}));
  let envRows = $state(untrack(() => credentialRowsOf(record(row.config.env))));
  let headerRows = $state(untrack(() => credentialRowsOf(record(row.config.headers))));

  const payload = $derived(secretsPayload({ env: credentialEdit(storedEnv, envRows), headers: credentialEdit(storedHeaders, headerRows) }));
</script>

<div class="cp" data-testid="server-credentials">
  <p class="cp-lead">Values are write-only: Cortex keeps them sealed and never shows them again. Type in a row to replace it, or remove the row to delete the key.</p>
  <CredentialList label="Environment variables" idBase="cp-env" bind:rows={envRows} hint="Passed to a stdio server's process." />
  <CredentialList label="Headers" idBase="cp-hdr" bind:rows={headerRows} hint="Sent with each request to a URL server, e.g. Authorization." />
  <div class="cp-actions">
    <Button variant="primary" icon="check" disabled={saving || payload === null} onclick={() => payload !== null && onSave(payload)}>{saving ? "Saving…" : "Save credentials"}</Button>
  </div>
</div>

<style>
  .cp { display: grid; gap: 16px; max-width: 640px; }
  .cp-lead { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); line-height: var(--cortex-lh-ui); }
  .cp-actions { display: flex; justify-content: flex-end; }
</style>
