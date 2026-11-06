<script lang="ts">
  /**
   * Tool disclosure select for the builder panel's Tools section. Maps to
   * `.withTools({ disclosure })` via `rawConfig.tools.disclosure`; shares
   * `DISCLOSURE_CHOICES` / `disclosurePatch` with the chat `/tools` picker.
   * Empty = the framework's model-tier default (never re-defaulted here).
   */
  import { DISCLOSURE_CHOICES, disclosureChoice, disclosureLabel, disclosurePatch, type DisclosureChoice } from "$lib/chat-quickbar.js";

  let { rawConfig = $bindable() }: { rawConfig: Record<string, unknown> } = $props();

  const current = $derived(disclosureChoice({ rawConfig }) ?? "");
  function set(value: string) {
    const choice = DISCLOSURE_CHOICES.find((c): c is DisclosureChoice => c === value);
    rawConfig = disclosurePatch({ rawConfig }, choice).rawConfig;
  }
</script>

<div class="acp-field">
  <label for="acp-tool-disclosure" class="config-label mb-0 text-[11px]">Tool disclosure</label>
  <select id="acp-tool-disclosure" class="config-input text-[11px]" value={current}
    onchange={(e) => set((e.currentTarget as HTMLSelectElement).value)}>
    <option value="">Tier default (framework picks by model tier)</option>
    {#each DISCLOSURE_CHOICES as c}
      <option value={c}>{c}: {disclosureLabel[c]}</option>
    {/each}
  </select>
  <p class="font-mono text-[10px] text-outline/70 leading-relaxed">
    How permitted tools are shown to the model. It never changes which tools are permitted.
  </p>
</div>
