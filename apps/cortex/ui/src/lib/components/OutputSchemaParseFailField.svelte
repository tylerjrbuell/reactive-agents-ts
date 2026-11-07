<script lang="ts">
  /**
   * Parse-fail mode for the builder's structured output (`.withOutputSchema(schema, { onParseFail })`).
   * "degrade" is the framework default: the run returns its text with `objectError`.
   * "throw" fails the run when the answer does not fit the schema.
   */
  let { value = $bindable() }: { value: "degrade" | "throw" } = $props();
</script>

<div class="acp-field mt-2">
  <label for="acp-output-parse-fail" class="config-label mb-0 text-[11px]">If the answer does not fit the schema</label>
  <select id="acp-output-parse-fail" class="config-input text-[11px]" bind:value>
    <option value="degrade">Degrade: keep the text answer, report the parse error (default)</option>
    <option value="throw">Throw: fail the run</option>
  </select>
</div>
