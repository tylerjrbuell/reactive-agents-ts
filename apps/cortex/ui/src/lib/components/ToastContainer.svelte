<script lang="ts">
  import { toast } from "$lib/stores/toast-store.js";
  import { tooltip } from "$lib/actions/tooltip.js";
  import type { Toast, ToastButton } from "$lib/stores/toast-store.js";
  import Icon from "$lib/components/kit/Icon.svelte";
  import type { IconName } from "$lib/icons.js";
  import { toastBottom } from "$lib/toast-clearance.js";

  let busyId = $state<string | null>(null);

  async function runButton(t: Toast, b: ToastButton) {
    busyId = t.id;
    try {
      await b.onClick();
      if (b.closeOnClick !== false) toast.remove(t.id);
    } finally {
      busyId = null;
    }
  }

  const BTN_VARIANT: Record<NonNullable<ToastButton["variant"]>, string> = {
    primary: "bg-accent-fill text-white border-accent-fill",
    danger: "bg-transparent text-bad border-bad",
    ghost: "bg-transparent text-text-2 border-[var(--cortex-line)]",
  };

  const KIND_CONFIG: Record<Toast["kind"], { icon: IconName; border: string; accent: string; label: string }> = {
    success:    { icon: "check-circle",   border: "border-io/40",  accent: "bg-io",  label: "text-io"  },
    error:      { icon: "alert-circle",   border: "border-bad/40",      accent: "bg-bad",      label: "text-bad"      },
    warning:    { icon: "alert",          border: "border-warn/40",   accent: "bg-warn",   label: "text-warn"   },
    info:       { icon: "info",           border: "border-accent-fill/40",    accent: "bg-accent-fill",    label: "text-accent"    },
    connection: { icon: "bolt",           border: "border-accent-fill/30",    accent: "bg-accent-fill",    label: "text-accent"    },
  };
</script>

<!-- Fixed bottom-right toast stack; sits above any bottom bar that registered
     with `toastKeepClear` (Beacon's prompt bar), so it never covers Run. -->
<div class="fixed right-6 z-toast flex flex-col gap-2 pointer-events-none" style="bottom: {$toastBottom}px" aria-live="polite">
  {#each $toast as t (t.id)}
    {@const cfg = KIND_CONFIG[t.kind]}
    <div
      class="pointer-events-auto flex items-start gap-3 min-w-[280px] max-w-[360px]
             bg-surface-3 border {cfg.border}
             rounded-lg shadow-neural-strong p-4 relative overflow-hidden
             animate-slide-right"
      role="alert"
    >
      <!-- Left accent bar -->
      <div class="absolute top-0 left-0 w-1 h-full {cfg.accent} rounded-l-lg opacity-80"></div>

      <!-- Icon -->
      <span class="flex-shrink-0 mt-0.5 {cfg.label}"><Icon name={cfg.icon} /></span>

      <!-- Content -->
      <div class="flex-1 min-w-0 pl-1">
        <div class="text-[13px] font-semibold text-text">
          {t.title}
        </div>
        {#if t.message}
          <p class="text-xs text-text-2 mt-0.5 leading-relaxed break-words">
            {t.message}
          </p>
        {/if}
        {#if t.action}
          <a
            href={t.action.href}
            class="inline-block mt-1.5 text-xs font-medium {cfg.label} hover:underline no-underline"
            onclick={() => toast.remove(t.id)}
          >
            {t.action.label}
          </a>
        {/if}
        {#if t.buttons && t.buttons.length > 0}
          <div class="mt-2 flex flex-wrap gap-1.5">
            {#each t.buttons as b (b.label)}
              <button
                type="button"
                disabled={busyId === t.id}
                onclick={() => runButton(t, b)}
                class="rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50
                       {BTN_VARIANT[b.variant ?? 'ghost']}"
              >
                {b.label}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Dismiss -->
      <button
        type="button"
        class="flex-shrink-0 text-text-3/60
               hover:text-text-3 transition-colors bg-transparent border-0 cursor-pointer p-0 leading-none"
        onclick={() => toast.remove(t.id)}
        aria-label="Dismiss"
        use:tooltip={"Dismiss"}
      >
        <Icon name="x" size="sm" />
      </button>
    </div>
  {/each}
</div>
