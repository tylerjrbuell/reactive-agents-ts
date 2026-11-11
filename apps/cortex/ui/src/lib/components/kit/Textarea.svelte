<script lang="ts">
  /**
   * Multi-line text input with the kit control look. `value` is bindable;
   * `mono` for code-like content.
   */
  import type { HTMLTextareaAttributes } from "svelte/elements";

  interface Props extends Omit<HTMLTextareaAttributes, "class" | "value"> {
    id: string;
    value?: string;
    rows?: number;
    mono?: boolean;
    invalid?: boolean;
    describedBy?: string;
    class?: string;
  }

  let {
    id,
    value = $bindable(""),
    rows = 4,
    mono = false,
    invalid = false,
    describedBy,
    class: className = "",
    ...rest
  }: Props = $props();
</script>

<textarea
  {id}
  {rows}
  bind:value
  class="cx-control {className}"
  class:cx-mono={mono}
  aria-invalid={invalid || undefined}
  aria-describedby={describedBy}
  {...rest}
></textarea>
