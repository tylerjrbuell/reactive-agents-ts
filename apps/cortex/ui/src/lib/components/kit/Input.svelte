<script lang="ts">
  /**
   * Text input with the kit control look (`.cx-control` in app.css). `value`
   * is bindable. `mono` sets machine values (paths, ids) in JetBrains Mono.
   * `describedBy` should be the Field's hint or error id.
   */
  import type { HTMLInputAttributes } from "svelte/elements";

  interface Props extends Omit<HTMLInputAttributes, "class" | "value"> {
    id: string;
    value?: string;
    mono?: boolean;
    invalid?: boolean;
    describedBy?: string;
    class?: string;
  }

  let {
    id,
    value = $bindable(""),
    type = "text",
    mono = false,
    invalid = false,
    describedBy,
    class: className = "",
    ...rest
  }: Props = $props();
</script>

<input
  {id}
  {type}
  bind:value
  class="cx-control {className}"
  class:cx-mono={mono}
  aria-invalid={invalid || undefined}
  aria-describedby={describedBy}
  {...rest}
/>
