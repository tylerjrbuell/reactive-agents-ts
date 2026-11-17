<script lang="ts">
  /**
   * Try one catalog tool: request JSON in, response and time out (`ToolTestRunner`). A tool that
   * runs code or changes files is refused with 409 until a person approves; the approval goes
   * through the confirm dialog. Mount per tool (`{#key tool.id}`): the request starts from the
   * tool's own parameters (`defaultRequestJson`).
   */
  import { untrack } from "svelte";
  import { toast } from "$lib/stores/toast-store.js";
  import { confirmAction } from "$lib/stores/confirm-store.js";
  import ToolTestRunner from "$lib/components/tools/ToolTestRunner.svelte";
  import { invokeTool, type ApiCtx } from "$lib/tools-page-data.js";
  import { defaultRequestJson, type CatalogEntry } from "$lib/tool-workshop.js";

  interface Props {
    tool: CatalogEntry;
    ctx: ApiCtx;
    /** Called after a run so the catalog's usage numbers refresh. */
    onRan?: () => void | Promise<void>;
  }
  const { tool, ctx, onRan }: Props = $props();

  let requestJson = $state(untrack(() => defaultRequestJson(tool.parameters)));
  let responseJson = $state("");
  let responseMs = $state<number | null>(null);
  let responseOk = $state<boolean | null>(null);
  let running = $state(false);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard refused: nothing to do
    }
  }

  async function run() {
    let args: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(requestJson);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return void toast.error("Invalid JSON", "Request must be a JSON object");
      args = parsed as Record<string, unknown>;
    } catch (e) {
      return void toast.error("Invalid JSON", String(e));
    }
    running = true;
    responseOk = null;
    responseJson = "";
    responseMs = null;
    let reply = await invokeTool(ctx, tool.id, args, false);
    // Tools that run code or change files ask first: the server answers 409 until a person confirms.
    if (reply.ok && reply.value.status === 409 && reply.value.approvalRequired) {
      const approved = await confirmAction({ title: "Run this tool?", message: reply.value.error ?? `${tool.displayName} can change things on this machine.`, confirmLabel: "Run", variant: "primary" });
      if (approved) reply = await invokeTool(ctx, tool.id, args, true);
    }
    running = false;
    if (!reply.ok) {
      responseOk = false;
      responseJson = JSON.stringify({ error: reply.error }, null, 2);
    } else if (reply.value.status >= 400 || reply.value.error) {
      responseOk = false;
      responseJson = JSON.stringify({ error: reply.value.error ?? `HTTP ${reply.value.status}` }, null, 2);
    } else {
      responseOk = reply.value.success !== false;
      responseMs = reply.value.executionTimeMs ?? null;
      responseJson = JSON.stringify(reply.value.result ?? {}, null, 2);
    }
    await onRan?.();
  }
</script>

<ToolTestRunner
  executable={tool.executable}
  bind:requestJson
  {responseJson}
  {responseMs}
  {responseOk}
  {running}
  onRun={run}
  onCopyRequest={() => copy(requestJson)}
  onCopyResponse={() => copy(responseJson)}
/>
