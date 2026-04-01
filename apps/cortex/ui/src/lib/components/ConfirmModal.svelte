<script lang="ts">
  interface Props {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    /** Tailwind classes for the confirm button variant */
    confirmVariant?: "danger" | "primary";
    onConfirm: () => void;
    onCancel: () => void;
  }
  let {
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    confirmVariant = "danger",
    onConfirm,
    onCancel,
  }: Props = $props();

  const confirmClass =
    confirmVariant === "danger"
      ? "bg-error/15 border border-error/40 text-error hover:bg-error/25"
      : "bg-primary/15 border border-primary/40 text-primary hover:bg-primary/25";
</script>

<!-- Backdrop -->
<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
<div
  class="fixed inset-0 z-[200] flex items-center justify-center bg-background/70 backdrop-blur-sm"
  onclick={onCancel}
>
  <!-- Modal -->
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div
    class="w-full max-w-sm bg-surface-container border border-outline-variant/20
           rounded-xl shadow-neural-strong animate-fade-up mx-4"
    onclick={(e) => e.stopPropagation()}
  >
    <div class="px-6 pt-5 pb-4">
      <h3 class="font-headline text-base font-semibold text-on-surface mb-2">{title}</h3>
      <p class="font-mono text-[11px] text-on-surface-variant leading-relaxed">{message}</p>
    </div>
    <div class="px-6 pb-5 flex items-center justify-end gap-3">
      <button
        type="button"
        class="px-4 py-1.5 border border-outline-variant/25 text-outline font-mono text-[11px]
               uppercase rounded bg-transparent cursor-pointer hover:text-on-surface transition-colors"
        onclick={onCancel}
      >{cancelLabel}</button>
      <button
        type="button"
        class="px-4 py-1.5 font-mono text-[11px] uppercase rounded cursor-pointer transition-colors {confirmClass}"
        onclick={onConfirm}
      >{confirmLabel}</button>
    </div>
  </div>
</div>
