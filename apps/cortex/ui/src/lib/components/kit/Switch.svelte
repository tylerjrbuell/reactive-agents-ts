<script lang="ts">
  /**
   * On/off switch: a `role="switch"` button with `aria-checked` and a visible
   * label. `checked` is bindable. The label is the accessible name.
   */
  interface Props {
    id: string;
    label: string;
    checked?: boolean;
    disabled?: boolean;
    /** One line under the label. */
    hint?: string;
    onchange?: (checked: boolean) => void;
    class?: string;
  }

  let { id, label, checked = $bindable(false), disabled = false, hint, onchange, class: className = "" }: Props = $props();

  function toggle() {
    checked = !checked;
    onchange?.(checked);
  }
</script>

<div class="cx-switch-row {className}">
  <button
    {id}
    type="button"
    role="switch"
    class="cx-switch"
    aria-checked={checked}
    aria-labelledby="{id}-label"
    aria-describedby={hint ? `${id}-hint` : undefined}
    {disabled}
    onclick={toggle}
  >
    <span class="cx-switch-thumb" aria-hidden="true"></span>
  </button>
  <span class="cx-switch-text">
    <span id="{id}-label" class="cx-switch-label">{label}</span>
    {#if hint}<span id="{id}-hint" class="cx-switch-hint">{hint}</span>{/if}
  </span>
</div>

<style>
  .cx-switch-row { display: flex; align-items: flex-start; gap: 10px; }
  .cx-switch {
    position: relative;
    flex: none;
    width: 30px;
    height: 18px;
    margin-top: 1px;
    padding: 0;
    border-radius: 999px;
    border: 1px solid var(--cortex-line-strong);
    background: var(--cortex-surface-3);
    cursor: pointer;
    transition: background-color var(--cortex-d-fast) var(--cortex-ease-out);
  }
  .cx-switch-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--cortex-text-2);
    transition: transform var(--cortex-d-fast) var(--cortex-ease-out);
  }
  .cx-switch[aria-checked="true"] { background: var(--cortex-accent-fill); border-color: transparent; }
  .cx-switch[aria-checked="true"] .cx-switch-thumb { transform: translateX(12px); background: #fff; }
  .cx-switch:disabled { opacity: 0.45; cursor: not-allowed; }
  .cx-switch:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
  .cx-switch-text { display: grid; gap: 2px; }
  .cx-switch-label { font-size: var(--cortex-t-sm); color: var(--cortex-text); }
  .cx-switch-hint { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
</style>
