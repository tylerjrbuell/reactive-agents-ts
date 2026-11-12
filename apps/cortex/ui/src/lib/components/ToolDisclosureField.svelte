<script lang="ts">
  /**
   * Tool disclosure select for the builder panel's Tools section. Maps to
   * `.withTools({ disclosure })` via `rawConfig.tools.disclosure`; shares
   * `DISCLOSURE_CHOICES` / `disclosurePatch` with the chat `/tools` picker.
   * Empty = the framework's model-tier default (never re-defaulted here).
   * A summary line states what is in force now (`disclosureSummary`, the same words
   * as the chat Config popover) with a one-click explainer.
   */
  import { DISCLOSURE_CHOICES, disclosureChoice, disclosureLabel, disclosurePatch, type DisclosureChoice } from "$lib/chat-quickbar.js";
  import { disclosureSummary } from "$lib/chat-composer-bar.js";
  import Select from "$lib/components/kit/Select.svelte";

  let { rawConfig = $bindable(), tools = [] }: { rawConfig: Record<string, unknown>; tools?: readonly string[] } = $props();

  const current = $derived(disclosureChoice({ rawConfig }) ?? "");
  const summary = $derived(disclosureSummary({ tools: [...tools], rawConfig }));
  function set(value: string) {
    const choice = DISCLOSURE_CHOICES.find((c): c is DisclosureChoice => c === value);
    rawConfig = disclosurePatch({ rawConfig }, choice).rawConfig;
  }
</script>

<div class="acp-field">
  <label for="acp-tool-disclosure" class="config-label mb-0 text-[11px]">Tool disclosure</label>
  <Select id="acp-tool-disclosure" class="config-input text-[11px]" value={current} onchange={set}
    options={[
      { value: "", label: "Tier default", description: "The framework picks by model tier" },
      ...DISCLOSURE_CHOICES.map((c) => ({ value: c, label: c, description: disclosureLabel[c] })),
    ]} />
  <p class="acp-hint leading-relaxed" data-testid="disclosure-summary">{summary.text}</p>
  <details class="acp-hint leading-relaxed">
    <summary class="cursor-pointer">What is tool disclosure?</summary>
    {summary.explain}
  </details>
</div>
