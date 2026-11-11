<script lang="ts">
  interface Props {
    name?: string;
    description?: string;
    /** Parameters as a JSON array (raw text until submitted). */
    paramsJson?: string;
    creating: boolean;
    onCancel: () => void;
    onCreate: () => void | Promise<void>;
  }
  let { name = $bindable(""), description = $bindable(""), paramsJson = $bindable(""), creating, onCancel, onCreate }: Props = $props();
</script>

        <div class="space-y-3 pt-1 border-t border-outline-variant/15">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label class="text-[9px] font-mono text-outline/60 uppercase block mb-1" for="tw-lab-name">Name (kebab-case)</label>
              <input
                id="tw-lab-name"
                bind:value={name}
                placeholder="my-api-fetcher"
                class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label class="text-[9px] font-mono text-outline/60 uppercase block mb-1" for="tw-lab-desc">Description</label>
              <input
                id="tw-lab-desc"
                bind:value={description}
                placeholder="What this tool represents"
                class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-sm font-mono"
              />
            </div>
          </div>
          <div>
            <label class="text-[9px] font-mono text-outline/60 uppercase block mb-1" for="tw-lab-params">Parameters (JSON array)</label>
            <textarea
              id="tw-lab-params"
              bind:value={paramsJson}
              rows="5"
              class="w-full bg-surface-container-lowest/60 border border-outline-variant/20 rounded-lg px-3 py-2 text-[11px] font-mono resize-y min-h-[88px]"
            ></textarea>
            <p class="mt-1 font-mono text-[8px] text-outline/45">
              Example: <code>{'[{"name":"query","type":"string","required":true,"description":"Search phrase"}]'}</code>
            </p>
          </div>
          <div class="flex justify-end gap-2">
            <button
              type="button"
              onclick={onCancel}
              class="px-3 py-1.5 text-[10px] font-mono border border-outline-variant/25 rounded bg-transparent text-outline"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={creating || !name.trim()}
              onclick={onCreate}
              class="px-4 py-1.5 text-[10px] font-mono rounded border-0 text-white disabled:opacity-40"
              style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);"
            >
              {creating ? "Creating…" : "Add to catalog"}
            </button>
          </div>
        </div>
