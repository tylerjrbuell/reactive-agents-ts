<script lang="ts">
  /** Call the selected tool: request JSON on the left, the response and its time on the right. */
  import Button from "$lib/components/kit/Button.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";

  interface Props {
    /** The tool can be invoked from the desk. */
    executable: boolean;
    /** Request arguments as JSON text. */
    requestJson?: string;
    responseJson: string;
    responseMs: number | null;
    responseOk: boolean | null;
    running: boolean;
    onRun: () => void | Promise<void>;
    onCopyRequest: () => void | Promise<void>;
    onCopyResponse: () => void | Promise<void>;
  }
  let { executable, requestJson = $bindable("{}"), responseJson, responseMs, responseOk, running, onRun, onCopyRequest, onCopyResponse }: Props = $props();
</script>

<div class="runner">
  <div class="pane">
    <div class="pane-h">
      <label for="tw-request">Request</label>
      <span class="grow"></span>
      <Button size="sm" variant="ghost" icon="copy" disabled={!executable} onclick={onCopyRequest}>Copy</Button>
      <Button size="sm" variant="primary" icon="play" disabled={!executable || running} onclick={onRun}>{running ? "Running…" : "Run test"}</Button>
    </div>
    <textarea id="tw-request" bind:value={requestJson} disabled={!executable} spellcheck="false"></textarea>
    {#if !executable}<p class="note">This tool cannot be called from Cortex.</p>{/if}
  </div>
  <div class="pane">
    <div class="pane-h">
      <span class="lbl" id="tw-response-label">Response</span>
      <span class="grow"></span>
      {#if responseMs != null}
        <span class="time" class:ok={responseOk === true} class:bad={responseOk === false}>
          {#if responseOk === true}<Icon name="check-circle" size="sm" />{:else if responseOk === false}<Icon name="alert-circle" size="sm" />{/if}
          {responseMs} ms
        </span>
      {/if}
      {#if responseJson}<Button size="sm" variant="ghost" icon="copy" onclick={onCopyResponse}>Copy</Button>{/if}
    </div>
    <pre aria-labelledby="tw-response-label">{responseJson || "No response yet. Run the test."}</pre>
  </div>
</div>

<style>
  .runner { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid var(--cortex-line); }
  .pane { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
  .pane + .pane { border-left: 1px solid var(--cortex-line); }
  .pane-h { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--cortex-line); flex: none; }
  .pane-h label, .lbl { font-size: var(--cortex-t-xs); font-weight: 500; color: var(--cortex-text-2); }
  .grow { flex: 1; }
  textarea, pre {
    flex: 1;
    min-height: 160px;
    margin: 0;
    padding: 12px;
    border: 0;
    background: var(--cortex-canvas);
    color: var(--cortex-text);
    font-family: var(--cortex-font-data);
    font-size: var(--cortex-t-xs);
    line-height: 1.5;
    resize: none;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }
  textarea:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: -2px; }
  textarea:disabled { opacity: 0.5; }
  .note { margin: 0; padding: 6px 12px; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .time { display: inline-flex; align-items: center; gap: 4px; font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-2); }
  .time.ok { color: var(--cortex-ok); }
  .time.bad { color: var(--cortex-bad); }
  @media (max-width: 900px) { .runner { grid-template-columns: 1fr; } .pane + .pane { border-left: 0; border-top: 1px solid var(--cortex-line); } }
</style>
