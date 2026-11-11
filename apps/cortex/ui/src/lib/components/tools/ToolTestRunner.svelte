<script lang="ts">
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

        <div class="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-0 border-t border-outline-variant/15">
          <div class="flex flex-col min-h-0 border-b md:border-b-0 md:border-r border-outline-variant/15">
            <div
              class="flex items-center justify-between px-3 py-2 bg-surface-container-lowest/40 border-b border-outline-variant/10 flex-shrink-0"
            >
              <span class="font-mono text-[8px] uppercase tracking-widest text-outline/50">request_body.json</span>
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  disabled={!executable}
                  onclick={onCopyRequest}
                  class="text-[8px] font-mono text-outline/40 hover:text-primary transition-colors border-0 bg-transparent cursor-pointer disabled:opacity-40"
                  title="Copy request JSON"
                >
                  copy
                </button>
                <button
                  type="button"
                  disabled={!executable || running}
                  onclick={onRun}
                  class="flex items-center gap-1 text-[9px] font-mono uppercase px-2 py-1 rounded border border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-40 bg-transparent"
                >
                  <span class="material-symbols-outlined text-[14px]">play_arrow</span>
                  {running ? "Running…" : "Run test"}
                </button>
              </div>
            </div>
            <textarea
              bind:value={requestJson}
              disabled={!executable}
              class="flex-1 min-h-[140px] w-full bg-transparent border-0 p-3 font-mono text-[10px] text-on-surface/90 resize-none focus:outline-none focus:ring-0 disabled:opacity-40"
              spellcheck="false"
            ></textarea>
          </div>
          <div class="flex flex-col min-h-0">
            <div
              class="flex items-center justify-between px-3 py-2 bg-surface-container-lowest/40 border-b border-outline-variant/10 flex-shrink-0"
            >
              <span class="font-mono text-[8px] uppercase tracking-widest text-outline/50">response_buffer</span>
              <div class="flex items-center gap-2">
                {#if responseJson}
                  <button
                    type="button"
                    onclick={onCopyResponse}
                    class="text-[8px] font-mono text-outline/40 hover:text-primary transition-colors border-0 bg-transparent cursor-pointer"
                    title="Copy response JSON"
                  >
                    copy
                  </button>
                {/if}
                {#if responseMs != null}
                  <span class="flex items-center gap-1 font-mono text-[9px]">
                    {#if responseOk === true}
                      <span class="material-symbols-outlined text-[14px] text-secondary">check_circle</span>
                    {:else if responseOk === false}
                      <span class="material-symbols-outlined text-[14px] text-error">error</span>
                    {/if}
                    <span class="text-outline/60">{responseMs}ms</span>
                  </span>
                {/if}
              </div>
            </div>
            <div class="flex-1 min-h-[140px] relative">
              <pre
                class="absolute inset-0 overflow-auto p-3 font-mono text-[10px] whitespace-pre-wrap break-all text-on-surface/85"
                >{responseJson || "—"}</pre
              >
            </div>
          </div>
        </div>
