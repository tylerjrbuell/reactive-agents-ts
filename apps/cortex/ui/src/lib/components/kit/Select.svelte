<script lang="ts">
  /**
   * Native select with the kit control look. `value` is bindable; `options`
   * are `{ value, label }` pairs.
   */
  import type { HTMLSelectAttributes } from "svelte/elements";

  /** One option. */
  interface SelectOption {
    readonly value: string;
    readonly label: string;
    readonly disabled?: boolean;
  }

  interface Props extends Omit<HTMLSelectAttributes, "class" | "value" | "children"> {
    id: string;
    value?: string;
    options: readonly SelectOption[];
    invalid?: boolean;
    describedBy?: string;
    class?: string;
  }

  let {
    id,
    value = $bindable(""),
    options,
    invalid = false,
    describedBy,
    class: className = "",
    ...rest
  }: Props = $props();
</script>

<select
  {id}
  bind:value
  class="cx-control {className}"
  aria-invalid={invalid || undefined}
  aria-describedby={describedBy}
  {...rest}
>
  {#each options as option (option.value)}
    <option value={option.value} disabled={option.disabled}>{option.label}</option>
  {/each}
</select>
