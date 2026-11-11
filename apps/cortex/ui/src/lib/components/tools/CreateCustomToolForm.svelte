<script lang="ts">
  /** Create a custom (Lab) tool: name, description and parameters as a JSON array. */
  import Button from "$lib/components/kit/Button.svelte";
  import Field from "$lib/components/kit/Field.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import Textarea from "$lib/components/kit/Textarea.svelte";

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

<div class="ccf">
  <div class="two">
    <Field id="tw-lab-name" label="Name" hint="kebab-case, e.g. my-api-fetcher">
      <Input id="tw-lab-name" bind:value={name} mono placeholder="my-api-fetcher" describedBy="tw-lab-name-hint" />
    </Field>
    <Field id="tw-lab-desc" label="Description">
      <Input id="tw-lab-desc" bind:value={description} placeholder="What this tool does" />
    </Field>
  </div>
  <Field id="tw-lab-params" label="Parameters (JSON array)" hint={'Example: [{"name":"query","type":"string","required":true,"description":"Search phrase"}]'}>
    <Textarea id="tw-lab-params" bind:value={paramsJson} rows={5} mono describedBy="tw-lab-params-hint" />
  </Field>
  <div class="actions">
    <Button variant="ghost" onclick={onCancel}>Cancel</Button>
    <Button variant="primary" icon="plus" disabled={creating || !name.trim()} onclick={onCreate}>{creating ? "Adding…" : "Add to catalog"}</Button>
  </div>
</div>

<style>
  .ccf { display: grid; gap: 12px; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
  @media (max-width: 800px) { .two { grid-template-columns: 1fr; } }
</style>
