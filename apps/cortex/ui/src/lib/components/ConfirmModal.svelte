<script lang="ts">
  interface Props {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    confirmVariant?: "danger" | "primary";
    onConfirm: () => void;
    onCancel: () => void;
  }
  const {
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    confirmVariant = "danger",
    onConfirm,
    onCancel,
  } = $props();

  // $derived so it reacts if confirmVariant ever changes
  const confirmClass = $derived(
    confirmVariant === "danger"
      ? "bg-bad/15 border border-bad/40 text-bad hover:bg-bad/25"
      : "bg-accent-fill/15 border border-accent-fill/40 text-accent hover:bg-accent-fill/25",
  );
</script>

<!-- Backdrop — keyboard: Escape handled by buttons inside -->
<div
  class="fixed inset-0 z-modal flex items-center justify-center bg-canvas/70 backdrop-blur-sm"
  role="dialog"
  aria-modal="true"
  aria-labelledby="confirm-modal-title"
>
  <!-- Click outside → cancel via invisible full-size button behind modal -->
  <button
    type="button"
    class="absolute inset-0 w-full h-full bg-transparent border-0 cursor-default"
    onclick={onCancel}
    aria-label="Close dialog"
  ></button>

  <!-- Modal panel -->
  <div
    class="relative z-10 w-full max-w-sm bg-surface-2 border border-line-strong/20
           rounded-xl shadow-neural-strong animate-fade-up mx-4"
  >
    <div class="px-6 pt-5 pb-4">
      <h3 id="confirm-modal-title" class="font-headline text-base font-semibold text-text mb-2">{title}</h3>
      <p class="whitespace-pre-line font-mono text-[11px] text-text-2 leading-relaxed">{message}</p>
    </div>
    <div class="px-6 pb-5 flex items-center justify-end gap-3">
      <button
        type="button"
        class="px-4 py-1.5 border border-line-strong/25 text-text-3 font-mono text-[11px]
               uppercase rounded bg-transparent cursor-pointer hover:text-text transition-colors"
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
