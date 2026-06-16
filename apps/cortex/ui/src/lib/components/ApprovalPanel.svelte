<script lang="ts">
  // Durable HITL (Phase E) — lists durable runs paused awaiting approval and
  // lets the operator approve/deny. Polls GET /api/runs/pending-approvals;
  // approve/deny POST to /api/runs/:runId/approve|deny. The run resumes durably.
  import { onMount, onDestroy } from "svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";

  interface Pending {
    readonly runId: string;
    readonly agentId: string;
    readonly gateId: string;
    readonly toolName: string;
    readonly args: unknown;
  }

  interface Props {
    /** Poll interval ms (default 2000). */
    pollMs?: number;
  }
  let { pollMs = 2000 }: Props = $props();

  let pending = $state<Pending[]>([]);
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function load() {
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/runs/pending-approvals`);
      if (!res.ok) return;
      const body = (await res.json()) as { approvals?: Pending[] };
      pending = body.approvals ?? [];
      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function decide(runId: string, action: "approve" | "deny") {
    busy = runId;
    try {
      await fetch(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "deny" ? { reason: "Denied from Cortex" } : {}),
      });
      pending = pending.filter((p) => p.runId !== runId);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = null;
      void load();
    }
  }

  function argPreview(args: unknown): string {
    try {
      const s = typeof args === "string" ? args : JSON.stringify(args);
      return s.length > 120 ? `${s.slice(0, 120)}…` : s;
    } catch {
      return String(args);
    }
  }

  onMount(() => {
    void load();
    timer = setInterval(() => void load(), pollMs);
  });
  onDestroy(() => {
    if (timer) clearInterval(timer);
  });
</script>

<section class="approval-panel" aria-label="Pending approvals">
  <header class="approval-panel__head">
    <h3>Pending approvals</h3>
    <span class="approval-panel__count">{pending.length}</span>
  </header>

  {#if error}
    <p class="approval-panel__error">{error}</p>
  {/if}

  {#if pending.length === 0}
    <p class="approval-panel__empty">No runs awaiting approval.</p>
  {:else}
    <ul class="approval-panel__list">
      {#each pending as p (p.runId + p.gateId)}
        <li class="approval-card">
          <div class="approval-card__body">
            <div class="approval-card__tool">{p.toolName || "(tool)"}</div>
            <div class="approval-card__meta">run {p.runId.slice(0, 10)} · agent {p.agentId.slice(0, 16)}</div>
            <code class="approval-card__args">{argPreview(p.args)}</code>
          </div>
          <div class="approval-card__actions">
            <button
              class="btn btn--approve"
              disabled={busy === p.runId}
              onclick={() => decide(p.runId, "approve")}
            >
              Approve
            </button>
            <button
              class="btn btn--deny"
              disabled={busy === p.runId}
              onclick={() => decide(p.runId, "deny")}
            >
              Deny
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .approval-panel { display: flex; flex-direction: column; gap: 0.5rem; }
  .approval-panel__head { display: flex; align-items: center; justify-content: space-between; }
  .approval-panel__head h3 { margin: 0; font-size: 0.9rem; }
  .approval-panel__count {
    font-size: 0.75rem; padding: 0.1rem 0.45rem; border-radius: 999px;
    background: var(--surface-2, #2a2a33); color: var(--text-2, #cbd5e1);
  }
  .approval-panel__empty, .approval-panel__error { font-size: 0.8rem; color: var(--text-2, #94a3b8); margin: 0; }
  .approval-panel__error { color: var(--danger, #f87171); }
  .approval-panel__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .approval-card {
    display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
    padding: 0.5rem 0.6rem; border: 1px solid var(--border, #2a2a33); border-radius: 0.5rem;
    background: var(--surface-1, #1c1c22);
  }
  .approval-card__tool { font-weight: 600; font-size: 0.85rem; }
  .approval-card__meta { font-size: 0.7rem; color: var(--text-2, #94a3b8); }
  .approval-card__args { display: block; margin-top: 0.25rem; font-size: 0.7rem; color: var(--text-2, #cbd5e1); word-break: break-all; }
  .approval-card__actions { display: flex; gap: 0.35rem; flex-shrink: 0; }
  .btn { font-size: 0.75rem; padding: 0.3rem 0.6rem; border-radius: 0.4rem; border: 1px solid transparent; cursor: pointer; }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .btn--approve { background: var(--success, #16a34a); color: white; }
  .btn--deny { background: transparent; color: var(--danger, #f87171); border-color: var(--danger, #f87171); }
</style>
