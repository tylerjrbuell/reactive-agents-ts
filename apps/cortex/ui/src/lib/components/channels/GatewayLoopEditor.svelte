<script lang="ts">
  /**
   * The gateway loop's schedules (`gateway.crons`) and inbound queue (`gateway.queue`).
   * A schedule fires its instruction while the agent's channels are up; the Gateway overview
   * shows its next fire and history. The queue holds messages that arrive while the agent is
   * busy; the defaults apply until a bound is set. Rules: `lib/gateway-schedules.ts`.
   */
  import type { GatewayBlock } from "$lib/channel-access.js";
  import { addCron, removeCron, setCronEnabled, withQueue } from "$lib/gateway-schedules.js";
  import Button from "$lib/components/kit/Button.svelte";
  import Field from "$lib/components/kit/Field.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import Switch from "$lib/components/kit/Switch.svelte";

  interface Props {
    gateway: GatewayBlock | undefined;
    onChange: (next: GatewayBlock | undefined) => void;
  }
  let { gateway, onChange }: Props = $props();

  const crons = $derived(gateway?.crons ?? []);
  let schedule = $state("");
  let instruction = $state("");
  let problem = $state<string | null>(null);

  function add() {
    const r = addCron(gateway, { schedule, instruction });
    if ("problem" in r) {
      problem = r.problem;
      return;
    }
    problem = null;
    schedule = "";
    instruction = "";
    onChange(r.gateway);
  }

  const queue = $derived(gateway?.queue);
</script>

<section class="loop" aria-labelledby="loop-title">
  <h4 id="loop-title">Schedules</h4>
  <p class="loop-p">Recurring instructions the agent runs while its channels are connected. Next fire and history appear in the Gateway overview.</p>

  {#if crons.length === 0}
    <p class="loop-empty">No schedules. Add one, or leave this agent to answer messages only.</p>
  {:else}
    <ul class="loop-list" aria-label="Schedules">
      {#each crons as c, i (`${c.schedule}|${c.instruction}|${i}`)}
        <li>
          <div class="loop-row">
            <code>{c.schedule}</code>
            <span class="loop-instr">{c.instruction}</span>
          </div>
          <Switch id="loop-on-{i}" label="On" checked={c.enabled !== false} onchange={(v) => onChange(setCronEnabled(gateway, i, v))} />
          <IconButton icon="trash" label="Remove schedule {c.schedule}" onclick={() => onChange(removeCron(gateway, i))} />
        </li>
      {/each}
    </ul>
  {/if}

  <form class="loop-add" onsubmit={(e) => { e.preventDefault(); add(); }}>
    <Field id="loop-cron" label="Cron" error={problem ?? undefined} hint={problem ? undefined : "Minute hour day month weekday, for example 0 9 * * 1 for Mondays at 09:00."}>
      <Input id="loop-cron" mono bind:value={schedule} placeholder="0 9 * * 1" autocomplete="off" spellcheck={false} invalid={problem !== null} describedBy={problem ? "loop-cron-error" : "loop-cron-hint"} />
    </Field>
    <Field id="loop-instr" label="Instruction">
      <Input id="loop-instr" bind:value={instruction} placeholder="Summarise open pull requests" />
    </Field>
    <Button size="sm" type="submit" icon="plus" disabled={!schedule.trim() && !instruction.trim()}>Add schedule</Button>
  </form>

  <h4 id="queue-title" class="loop-sub">Inbound queue</h4>
  <p class="loop-p">Messages that arrive while the agent is busy wait here, one run at a time. Leave blank to use the framework defaults.</p>
  <div class="loop-q">
    <Field id="queue-cap" label="Messages it holds" hint="Framework default 100.">
      <Input id="queue-cap" mono inputmode="numeric" value={queue?.capacity === undefined ? "" : String(queue.capacity)} placeholder="100" oninput={(e) => {
        const raw = (e.currentTarget as HTMLInputElement).value.trim();
        const n = raw === "" ? undefined : Number(raw);
        onChange(withQueue(gateway, { capacity: n, ...(queue?.overflow ? { overflow: queue.overflow } : {}) }));
      }} describedBy="queue-cap-hint" />
    </Field>
    <Field id="queue-over" label="When it is full" hint="Framework default: drop the oldest.">
      <Select
        id="queue-over"
        value={queue?.overflow ?? ""}
        options={[
          { value: "", label: "Framework default (drop the oldest)" },
          { value: "drop-oldest", label: "Drop the oldest waiting message" },
          { value: "drop-newest", label: "Drop the newest message" },
        ]}
        onchange={(v) => onChange(withQueue(gateway, { ...(queue?.capacity !== undefined ? { capacity: queue.capacity } : {}), overflow: v === "drop-oldest" || v === "drop-newest" ? v : undefined }))}
        describedBy="queue-over-hint"
      />
    </Field>
  </div>
</section>

<style>
  .loop { display: grid; gap: 10px; padding: 14px 16px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); background: var(--cortex-canvas); }
  .loop h4 { margin: 0; font-size: var(--cortex-t-md); font-weight: 600; color: var(--cortex-text); }
  .loop-sub { padding-top: 12px; border-top: 1px solid var(--cortex-line); }
  .loop-p { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); line-height: var(--cortex-lh-ui); }
  .loop-empty { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-text-3); }
  .loop-list { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
  .loop-list li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 12px; padding: 8px 10px; border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-2); }
  .loop-row { display: grid; gap: 2px; min-width: 0; }
  .loop-row code { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text); }
  .loop-instr { font-size: var(--cortex-t-xs); color: var(--cortex-text-2); overflow-wrap: anywhere; }
  .loop-add { display: grid; grid-template-columns: minmax(160px, 220px) minmax(0, 1fr) auto; gap: 10px; align-items: end; }
  .loop-q { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
  @media (max-width: 720px) { .loop-add { grid-template-columns: minmax(0, 1fr); } }
</style>
