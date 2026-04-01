<script lang="ts">
  import { toast } from "$lib/stores/toast-store.js";
  import type { Toast } from "$lib/stores/toast-store.js";

  const KIND_CONFIG: Record<Toast["kind"], { icon: string; border: string; accent: string; label: string }> = {
    success:    { icon: "task_alt",       border: "border-secondary/40",  accent: "bg-secondary",  label: "text-secondary"  },
    error:      { icon: "error",          border: "border-error/40",      accent: "bg-error",      label: "text-error"      },
    warning:    { icon: "warning",        border: "border-tertiary/40",   accent: "bg-tertiary",   label: "text-tertiary"   },
    info:       { icon: "info",           border: "border-primary/40",    accent: "bg-primary",    label: "text-primary"    },
    connection: { icon: "cable",          border: "border-primary/30",    accent: "bg-primary",    label: "text-primary"    },
  };
</script>

<!-- Fixed bottom-right toast stack -->
<div class="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none" aria-live="polite">
  {#each $toast as t (t.id)}
    {@const cfg = KIND_CONFIG[t.kind]}
    <div
      class="pointer-events-auto flex items-start gap-3 min-w-[280px] max-w-[360px]
             bg-surface-container-high border {cfg.border}
             rounded-lg shadow-neural-strong p-4 relative overflow-hidden
             animate-slide-right"
      role="alert"
    >
      <!-- Left accent bar -->
      <div class="absolute top-0 left-0 w-1 h-full {cfg.accent} rounded-l-lg opacity-80"></div>

      <!-- Icon -->
      <span
        class="material-symbols-outlined text-base flex-shrink-0 mt-0.5 {cfg.label}"
        style="font-variation-settings: 'FILL' 1;"
      >
        {cfg.icon}
      </span>

      <!-- Content -->
      <div class="flex-1 min-w-0 pl-1">
        <div class="font-mono text-xs font-semibold {cfg.label} uppercase tracking-wide">
          {t.title}
        </div>
        {#if t.message}
          <p class="font-mono text-[10px] text-on-surface-variant mt-0.5 leading-relaxed">
            {t.message}
          </p>
        {/if}
        {#if t.action}
          <a
            href={t.action.href}
            class="inline-block mt-1.5 text-[10px] font-mono {cfg.label} hover:underline no-underline"
            onclick={() => toast.remove(t.id)}
          >
            {t.action.label} →
          </a>
        {/if}
      </div>

      <!-- Dismiss -->
      <button
        type="button"
        class="flex-shrink-0 material-symbols-outlined text-sm text-outline/40
               hover:text-outline transition-colors bg-transparent border-0 cursor-pointer p-0 leading-none"
        onclick={() => toast.remove(t.id)}
        aria-label="Dismiss"
      >
        close
      </button>
    </div>
  {/each}
</div>
