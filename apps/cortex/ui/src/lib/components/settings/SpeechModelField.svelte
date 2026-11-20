<script lang="ts">
  /**
   * The Model field of a Settings · Voice endpoint block. When the saved speech server lists its
   * models (Speaches: installed ones, and the ones it can download), this is a searchable pick
   * list; otherwise, or after "Other model id…", a free-text id. `pendingDownload` tells the block
   * the picked model is not installed yet, so saving starts its download. Rules: `lib/voice/speech-models.ts`.
   */
  import { voice } from "$lib/stores/voice.js";
  import Input from "$lib/components/kit/Input.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import { CUSTOM_MODEL, modelSelectOptions, needsDownload, type SpeechModels } from "$lib/voice/speech-models.js";

  interface Props {
    direction: "stt" | "tts";
    value: string;
    pendingDownload?: boolean;
  }
  let { direction, value = $bindable(""), pendingDownload = $bindable(false) }: Props = $props();

  const v = voice();
  const settings = v.settings;
  const savedUrl = $derived($settings[direction].baseUrl);

  let models = $state<SpeechModels>({ installed: [], available: [], listed: false });
  let custom = $state(false);

  // The lists belong to the SAVED endpoint: ask again when it changes (or a model was saved).
  $effect(() => {
    const url = savedUrl;
    void $settings[direction].model;
    if (url === "") {
      models = { installed: [], available: [], listed: false };
      return;
    }
    void v.api.models(direction).then((r) => {
      if (r.ok && url === savedUrl) models = r.value;
    });
  });

  const offered = $derived(models.installed.length + models.available.length > 0);
  const options = $derived(modelSelectOptions(models, value.trim()));
  $effect(() => {
    pendingDownload = needsDownload(models, value.trim());
  });
</script>

{#if offered && !custom}
  <Select
    id="vb-model-{direction}"
    {value}
    {options}
    searchable={true}
    placeholder="Pick a model"
    onchange={(x) => (x === CUSTOM_MODEL ? (custom = true) : (value = x))}
  />
{:else}
  <Input id="vb-model-{direction}" mono autocomplete="off" spellcheck={false} bind:value />
{/if}
