<script lang="ts">
  /**
   * Edit or create one route (a drawer): which channel and conversations it listens to, which
   * agent answers, who may talk (owners, allow, deny, open), what non-owner senders may do, caps,
   * and the turn acknowledgement. Saving a change that WIDENS access (an added owner, `open`, full
   * agent tools) first asks through the audited confirm dialog, which names the risk; the request
   * then carries the confirm tokens and the server records them. The server stays the authority:
   * a 409 asking for confirmation opens the same dialog. Rules: `lib/channel-hub.ts`; calls:
   * `lib/channel-hub-api.ts`.
   */
  import { untrack } from "svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { confirmAction } from "$lib/stores/confirm-store.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { channelKindInfo } from "$lib/channels.js";
  import {
    DEFAULT_PER_SENDER_PER_HOUR,
    draftFromRoute,
    draftProblems,
    newDraft,
    routeFromDraft,
    widenConfirmCopy,
    wideningTokens,
    type HubRouteWire,
    type RouteDraft,
  } from "$lib/channel-hub.js";
  import { saveHubRoute, type AgentChoice, type HubChannelRow } from "$lib/channel-hub-api.js";
  import AckFields from "./AckFields.svelte";
  import ResetFields from "./ResetFields.svelte";
  import TurnLimitFields from "./TurnLimitFields.svelte";
  import BatchingFields from "./BatchingFields.svelte";
  import PacingFields from "./PacingFields.svelte";
  import SenderChips from "./SenderChips.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Field from "$lib/components/kit/Field.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import Overlay from "$lib/components/kit/Overlay.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import Switch from "$lib/components/kit/Switch.svelte";
  import Textarea from "$lib/components/kit/Textarea.svelte";

  interface Props {
    /** The saved route being edited; absent = a new route. */
    saved?: HubRouteWire;
    channels: readonly HubChannelRow[];
    agents: readonly AgentChoice[];
    /** Pre-fill for a new route. */
    initial?: { channelId?: string; agentId?: string };
    onsaved: () => void;
    onclose: () => void;
  }
  let { saved, channels, agents, initial, onsaved, onclose }: Props = $props();

  // The editor is keyed per route by its parent: props are read once, as the starting point of the edit.
  const creating = untrack(() => !saved);
  let draft = $state<RouteDraft>(
    untrack(() => {
      if (saved) return draftFromRoute(saved);
      const channelId = initial?.channelId ?? channels[0]?.id ?? "";
      return newDraft(channelId, initial?.agentId ?? agents[0]?.agentId ?? "", channels.find((c) => c.id === channelId)?.platform);
    }),
  );
  let busy = $state(false);
  let serverError = $state<string | null>(null);
  let showProblems = $state(false);

  const problems = $derived(draftProblems(draft, creating));
  const platform = $derived(channels.find((c) => c.id === draft.channelId)?.platform);
  /** A webhook route's access is its signing secret; sender lists, open and sender tools do not apply. */
  const isWebhook = $derived(platform === "webhook");
  const channelOptions = $derived(channels.map((c) => ({ value: c.id, label: c.label ?? channelKindInfo(c.platform).label, description: `${channelKindInfo(c.platform).label} · ${c.id}` })));
  const agentOptions = $derived(agents.map((a) => ({ value: a.agentId, label: a.name, description: a.agentId })));

  async function save() {
    showProblems = true;
    serverError = null;
    if (problems.length > 0) return;
    const next = routeFromDraft(draft, saved, platform);
    let confirm: string[] = [];
    const needed = wideningTokens(saved, next);
    if (needed.length > 0) {
      const copy = widenConfirmCopy(next.id, needed);
      if (!(await confirmAction({ ...copy, confirmLabel: "Widen access", variant: "danger" }))) return;
      confirm = needed;
    }
    busy = true;
    let r = await saveHubRoute(CORTEX_SERVER_URL, fetch, next, saved, confirm);
    // The server found a widening change the editor did not predict: ask, then send it.
    if (!r.ok && "needsConfirm" in r) {
      const copy = widenConfirmCopy(next.id, r.needsConfirm);
      if (await confirmAction({ ...copy, confirmLabel: "Widen access", variant: "danger" })) {
        r = await saveHubRoute(CORTEX_SERVER_URL, fetch, next, saved, [...r.needsConfirm]);
      }
    }
    busy = false;
    if (r.ok) {
      toast.success(creating ? "Route created" : "Route saved", `${next.id} is live.`);
      onsaved();
    } else {
      serverError = r.error;
    }
  }
</script>

<Overlay open kind="drawer" width={560} title={creating ? "New route" : `Route ${saved?.id}`} {onclose}>
  <form class="re" onsubmit={(e) => { e.preventDefault(); void save(); }}>
    {#if creating}
      <Field id="re-id" label="Route id" hint="A short name, like support-dm. It cannot change later.">
        <Input id="re-id" mono bind:value={draft.id} placeholder="support-dm" describedBy="re-id-hint" />
      </Field>
    {/if}
    <Switch id="re-on" label="Route is on" bind:checked={draft.enabled} />

    <div class="re-grid">
      <Field id="re-channel" label="Channel" hint="The account the message arrives on.">
        <Select id="re-channel" bind:value={draft.channelId} options={channelOptions} placeholder="Pick a channel" onchange={(v) => (draft.channelId = v)} describedBy="re-channel-hint" />
      </Field>
      <Field id="re-agent" label="Agent" hint="The saved agent that answers.">
        <Select id="re-agent" bind:value={draft.agentId} options={agentOptions} placeholder="Pick an agent" onchange={(v) => (draft.agentId = v)} describedBy="re-agent-hint" />
      </Field>
      <Field id="re-conv" label="Conversation" hint="Direct messages, groups, or both.">
        <Select id="re-conv" value={draft.conversation} options={[{ value: "any", label: "Any" }, { value: "dm", label: "Direct messages" }, { value: "group", label: "Groups" }]} onchange={(v) => (draft.conversation = v === "dm" ? "dm" : v === "group" ? "group" : "any")} describedBy="re-conv-hint" />
      </Field>
      <Field id="re-when" label="Only when" hint="Narrow which messages this route takes.">
        <Select id="re-when" value={draft.when} options={[{ value: "any", label: "Every message" }, { value: "mention", label: "The agent is mentioned" }, { value: "command", label: "A command" }, { value: "keyword", label: "A keyword" }]} onchange={(v) => (draft.when = v === "mention" ? "mention" : v === "command" ? "command" : v === "keyword" ? "keyword" : "any")} describedBy="re-when-hint" />
      </Field>
    </div>
    {#if draft.when === "command"}
      <Field id="re-cmd" label="Command" hint="Without the slash, for example start.">
        <Input id="re-cmd" mono bind:value={draft.whenValue} placeholder="ask" describedBy="re-cmd-hint" />
      </Field>
    {:else if draft.when === "keyword"}
      <Field id="re-kw" label="Keywords" hint="One per line. A message containing any of them matches.">
        <Textarea id="re-kw" rows={3} bind:value={draft.whenValue} describedBy="re-kw-hint" />
      </Field>
    {/if}
    <Field id="re-session" label="Memory between messages" hint={draft.session === "per-conversation" ? "The agent remembers each conversation." : "Every message is a fresh run."}>
      <Select id="re-session" value={draft.session} options={[{ value: "per-conversation", label: "Keep each conversation" }, { value: "stateless", label: "Fresh run per message" }]} onchange={(v) => (draft.session = v === "stateless" ? "stateless" : "per-conversation")} describedBy="re-session-hint" />
    </Field>

    {#if isWebhook}
      <p class="re-note">A webhook route is authorised by the channel's signing secret. Sender lists, open access and sender tools do not apply.</p>
    {:else}
      <fieldset class="re-box">
        <legend>Who can talk</legend>
        <SenderChips id="re-owners" label="Owners" hint="Run the agent with all its tools and approve risky ones. Adding one asks you to confirm." bind:list={draft.owners} />
        <SenderChips id="re-allow" label="Allowed senders" hint="May talk to the agent with the sender tools below. Owners are always allowed." bind:list={draft.allow} />
        <SenderChips id="re-deny" label="Blocked senders" hint="Never answered, even on an open route." bind:list={draft.deny} />
        <Switch id="re-open" label="Open to anyone" hint="Any sender on this channel can talk to the agent. Needs all three caps below, and asks you to confirm." bind:checked={draft.open} />
        {#if draft.open}<p class="re-risk" role="alert">Anyone who finds this account can run the agent and spend its budget. The caps below are the only limit.</p>{/if}
      </fieldset>

      <fieldset class="re-box">
        <legend>What non-owners can do</legend>
        <Field id="re-tools" label="Sender tools" hint={draft.senderTools === "ReadOnly" ? "Read-only: no file writes, shell, code execution, memory or sub-agents. The default." : draft.senderTools === "AgentDefault" ? "Everything the agent was built with. Needs an owner, and asks you to confirm." : "Only the tools you list."}>
          <Select id="re-tools" value={draft.senderTools} options={[{ value: "ReadOnly", label: "Read-only (default)" }, { value: "Allowlist", label: "Only these tools" }, { value: "AgentDefault", label: "The agent's full tools" }]} onchange={(v) => (draft.senderTools = v === "AgentDefault" ? "AgentDefault" : v === "Allowlist" ? "Allowlist" : "ReadOnly")} describedBy="re-tools-hint" />
        </Field>
        {#if draft.senderTools === "Allowlist"}
          <Field id="re-toollist" label="Tool names" hint="One per line, for example web-search. An empty list means no tools.">
            <Textarea id="re-toollist" rows={3} mono value={draft.senderToolList.join("\n")} oninput={(e) => (draft.senderToolList = e.currentTarget.value.split("\n").map((l) => l.trim()).filter((l) => l !== ""))} describedBy="re-toollist-hint" />
          </Field>
        {/if}
      </fieldset>
    {/if}

    <fieldset class="re-box">
      <legend>Caps</legend>
      <div class="re-grid">
        <Field id="re-cost" label="Cost per day (USD)" hint={draft.open ? "Required for an open route." : "Optional."}>
          <Input id="re-cost" mono inputmode="decimal" bind:value={draft.maxCostPerDayUsd} placeholder="5" describedBy="re-cost-hint" />
        </Field>
        <Field id="re-turns" label="Turns per hour" hint={draft.open ? "Required: the whole route." : "Optional: the whole route."}>
          <Input id="re-turns" mono inputmode="numeric" bind:value={draft.maxTurnsPerHour} placeholder="60" describedBy="re-turns-hint" />
        </Field>
        <Field id="re-sender" label="Turns per sender per hour" hint={draft.open ? "Required." : `Default ${DEFAULT_PER_SENDER_PER_HOUR} when empty.`}>
          <Input id="re-sender" mono inputmode="numeric" bind:value={draft.maxTurnsPerSenderPerHour} placeholder={String(DEFAULT_PER_SENDER_PER_HOUR)} describedBy="re-sender-hint" />
        </Field>
        <Field id="re-iter" label="Max iterations" hint="Per turn. Empty uses the agent's own limit.">
          <Input id="re-iter" mono inputmode="numeric" bind:value={draft.maxIterations} describedBy="re-iter-hint" />
        </Field>
      </div>
    </fieldset>

    {#if !isWebhook}<AckFields bind:draft />{/if}
    <TurnLimitFields bind:draft showNotice={!isWebhook} />
    {#if !isWebhook}<BatchingFields bind:draft />{/if}
    {#if !isWebhook}<PacingFields bind:draft />{/if}
    {#if !isWebhook && draft.session === "per-conversation"}<ResetFields bind:draft />{/if}

    {#if showProblems && problems.length > 0}
      <ul class="re-problems" role="alert">{#each problems as p (p)}<li>{p}</li>{/each}</ul>
    {/if}
    {#if serverError}<p class="re-problems" role="alert">{serverError}</p>{/if}
    <button type="submit" class="re-submit" tabindex="-1" aria-hidden="true">Save</button>
  </form>
  {#snippet actions()}
    <Button variant="ghost" onclick={onclose}>Cancel</Button>
    <Button variant="primary" onclick={() => void save()} disabled={busy}>{busy ? "Saving…" : creating ? "Create route" : "Save route"}</Button>
  {/snippet}
</Overlay>

<style>
  .re { display: grid; gap: 14px; }
  .re-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
  .re-box { display: grid; gap: 12px; margin: 0; padding: 12px 14px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); min-width: 0; }
  .re-box legend { padding: 0 6px; font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-text); }
  .re-note, .re-risk { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .re-risk { padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--cortex-warn) 35%, transparent); border-radius: var(--cortex-r-ctl); background: var(--cortex-warn-tint); color: var(--cortex-text); }
  .re-problems { margin: 0; padding-left: 18px; font-size: var(--cortex-t-xs); color: var(--cortex-bad); }
  .re-submit { display: none; }
</style>
