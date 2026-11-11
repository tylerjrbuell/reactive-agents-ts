<script lang="ts">
  import ConfirmModal from "$lib/components/ConfirmModal.svelte";
  import { pendingConfirm, settleConfirm } from "$lib/stores/confirm-store.js";

  // Escape cancels the open dialog, matching the backdrop click.
  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && $pendingConfirm) {
      e.preventDefault();
      settleConfirm(false);
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if $pendingConfirm}
  <ConfirmModal
    title={$pendingConfirm.title}
    message={$pendingConfirm.message}
    confirmLabel={$pendingConfirm.confirmLabel ?? "Confirm"}
    cancelLabel={$pendingConfirm.cancelLabel ?? "Cancel"}
    confirmVariant={$pendingConfirm.variant ?? "danger"}
    onConfirm={() => settleConfirm(true)}
    onCancel={() => settleConfirm(false)}
  />
{/if}
