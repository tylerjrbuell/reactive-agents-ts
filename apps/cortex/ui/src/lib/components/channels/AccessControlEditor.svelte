<script lang="ts">
  /**
   * Who may message a gateway agent (`gateway.accessControl`). The framework fails closed:
   * with an empty allowlist nobody is let in, so the editor says that in one sentence and
   * makes "Allow everyone" an explicit, warned switch rather than a default. Entries are
   * `platform:id` sender keys. Rules: `lib/channel-access.ts`.
   */
  import {
    accessModeOf,
    accessSentence,
    addSenders,
    removeSender,
    setAllowEveryone,
    withAccess,
    type AccessControl,
    type GatewayBlock,
  } from "$lib/channel-access.js";
  import { CHANNEL_KINDS } from "$lib/channels.js";
  import Button from "$lib/components/kit/Button.svelte";
  import Field from "$lib/components/kit/Field.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import Switch from "$lib/components/kit/Switch.svelte";

  interface Props {
    gateway: GatewayBlock | undefined;
    onChange: (next: GatewayBlock | undefined) => void;
  }
  let { gateway, onChange }: Props = $props();

  const access = $derived(gateway?.accessControl);
  const mode = $derived(accessModeOf(gateway));
  const allowed = $derived(access?.allowedSenders ?? []);
  const examples = CHANNEL_KINDS.map((k) => k.senderExample).join(", ");

  let draft = $state("");
  let problems = $state<string[]>([]);

  const commit = (next: AccessControl | undefined) => onChange(withAccess(gateway, next));

  function add() {
    if (!draft.trim()) return;
    const r = addSenders(access, draft);
    problems = r.rejected.map((x) => x.reason);
    commit(r.access);
    // Keep only what was refused in the box so it can be fixed in place.
    draft = r.rejected.map((x) => x.entry).join(" ");
  }

  const replyText = $derived(access?.replyToUnknown ?? "");
</script>

<section class="acc" aria-labelledby="acc-title">
  <h4 id="acc-title">Who can message this agent</h4>
  <p class="acc-state" class:acc-warn={mode === "deny-all" || mode === "open"} role="status">
    {accessSentence(mode, allowed.length)}
  </p>

  {#if mode !== "open"}
    <form class="acc-add" onsubmit={(e) => { e.preventDefault(); add(); }}>
      <label class="acc-sr" for="acc-input">Add senders</label>
      <Input id="acc-input" mono bind:value={draft} placeholder="telegram:123456789" autocomplete="off" spellcheck={false} describedBy="acc-hint" invalid={problems.length > 0} />
      <Button size="sm" variant="primary" type="submit" icon="plus" disabled={!draft.trim()}>Add</Button>
    </form>
    <p id="acc-hint" class="acc-hint">One <code>platform:id</code> per sender, for example {examples}. Paste several separated by spaces or new lines.</p>
    {#if problems.length > 0}
      <ul class="acc-problems" role="alert">{#each problems as p (p)}<li>{p}</li>{/each}</ul>
    {/if}

    {#if allowed.length > 0}
      <ul class="acc-list" aria-label="Allowed senders">
        {#each allowed as s (s)}
          <li><code>{s}</code><IconButton icon="x" label="Remove {s}" onclick={() => commit(removeSender(access, s))} /></li>
        {/each}
      </ul>
    {/if}
  {/if}

  <div class="acc-everyone" class:acc-everyone-on={mode === "open"}>
    <Switch
      id="acc-open"
      label="Allow everyone"
      checked={mode === "open"}
      hint="Skips the list: any sender on a connected channel can run this agent and use its tools."
      onchange={(v) => commit(setAllowEveryone(access, v))}
    />
    {#if mode === "open"}
      <p class="acc-risk" role="alert">Anyone who finds the bot or number can talk to this agent. Keep its tools and approvals tight, or switch this off and list people instead.</p>
    {/if}
  </div>

  <details class="acc-more">
    <summary>More access options</summary>
    <div class="acc-more-b">
      <Field id="acc-unknown" label="When a sender is not allowed" hint="Ignore them quietly, or surface them so you can see who tried.">
        <Select
          id="acc-unknown"
          value={access?.unknownSenderAction ?? "skip"}
          options={[{ value: "skip", label: "Ignore" }, { value: "escalate", label: "Surface in the overview" }]}
          onchange={(v) => commit({ ...(access ?? {}), unknownSenderAction: v === "escalate" ? "escalate" : "skip" })}
          describedBy="acc-unknown-hint"
        />
      </Field>
      <Field id="acc-reply" label="Reply to refused senders" hint="A fixed message, never run through the agent. Empty = no reply.">
        <Input id="acc-reply" value={replyText} placeholder="This assistant is private." oninput={(e) => {
          const v = (e.currentTarget as HTMLInputElement).value;
          const { replyToUnknown: _drop, ...rest } = access ?? {};
          commit(v.trim() ? { ...rest, replyToUnknown: v } : rest);
        }} describedBy="acc-reply-hint" />
      </Field>
      <Field id="acc-mode" label="Messages are handled as" hint="Chat keeps a conversation per sender; Task treats each message as a one-shot instruction.">
        <Select
          id="acc-mode"
          value={access?.mode ?? "chat"}
          options={[{ value: "chat", label: "Chat" }, { value: "task", label: "Task" }]}
          onchange={(v) => commit({ ...(access ?? {}), mode: v === "task" ? "task" : "chat" })}
          describedBy="acc-mode-hint"
        />
      </Field>
    </div>
  </details>
</section>

<style>
  .acc { display: grid; gap: 10px; padding: 14px 16px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); background: var(--cortex-canvas); }
  .acc h4 { margin: 0; font-size: var(--cortex-t-md); font-weight: 600; color: var(--cortex-text); }
  .acc-state { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  .acc-warn { color: var(--cortex-warn); }
  .acc-add { display: flex; gap: 6px; align-items: center; }
  .acc-add :global(input) { flex: 1; min-width: 0; }
  .acc-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .acc-hint { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .acc-hint code { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); }
  .acc-problems { margin: 0; padding-left: 18px; font-size: var(--cortex-t-xs); color: var(--cortex-bad); }
  .acc-list { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 6px; }
  .acc-list li { display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px 2px 10px; border-radius: var(--cortex-r-chip); background: var(--cortex-surface-2); }
  .acc-list code { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text); }
  .acc-everyone { display: grid; gap: 8px; padding-top: 10px; border-top: 1px solid var(--cortex-line); }
  .acc-everyone-on { padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--cortex-warn) 35%, transparent); border-radius: var(--cortex-r-ctl); background: var(--cortex-warn-tint); }
  .acc-risk { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text); }
  .acc-more summary { cursor: pointer; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .acc-more-b { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; padding-top: 10px; }
</style>
