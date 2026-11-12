<script lang="ts" module>
  let formCount = 0;
</script>

<script lang="ts">
  // The form for a structured `request_user_input`: several typed questions answered at
  // once (single / multi choice, yes/no, number, text). Single choice and yes/no use the
  // kit Select; multi choice is a checkbox group. Required questions are marked, and a
  // problem shows under the question it belongs to. Sending hands the id-keyed answer map
  // to the caller. Rules: lib/structured-questions.ts.
  import Button from "$lib/components/kit/Button.svelte";
  import Field from "$lib/components/kit/Field.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import {
    buildAnswers,
    isRequired,
    otherKey,
    type QuestionDraft,
    type StructuredAnswerValue,
    type StructuredQuestion,
  } from "$lib/structured-questions.js";

  interface Props {
    questions: readonly StructuredQuestion[];
    /** Called with the answer map once every question passes; the caller sends it. */
    onSend: (answers: Readonly<Record<string, StructuredAnswerValue>>) => void;
    disabled?: boolean;
  }
  const { questions, onSend, disabled = false }: Props = $props();

  const uid = `sq${++formCount}`;
  let draft = $state<QuestionDraft>({});
  let errors = $state<Readonly<Record<string, string>>>({});

  const fid = (q: StructuredQuestion): string => `${uid}-${q.id}`;
  const label = (q: StructuredQuestion): string => `${q.prompt}${isRequired(q) ? "" : " (optional)"}`;
  const set = (key: string, value: string | readonly string[]) => {
    draft = { ...draft, [key]: value };
    if (errors[key] !== undefined) {
      const { [key]: _gone, ...rest } = errors;
      errors = rest;
    }
  };
  const picked = (q: StructuredQuestion): readonly string[] => {
    const v = draft[q.id];
    return Array.isArray(v) ? (v as readonly string[]) : [];
  };
  const text = (key: string): string => {
    const v = draft[key];
    return typeof v === "string" ? v : "";
  };
  const toggle = (q: StructuredQuestion, value: string, on: boolean) => {
    const rest = picked(q).filter((v) => v !== value);
    set(q.id, on ? [...rest, value] : rest);
  };
  const choiceOptions = (q: StructuredQuestion) => [
    ...(isRequired(q) ? [] : [{ value: "", label: "No answer" }]),
    ...(q.options ?? []).map((o) => ({ value: o.value, label: o.label, ...(o.description !== undefined ? { description: o.description } : {}) })),
  ];
  const yesNo = (q: StructuredQuestion) => [
    ...(isRequired(q) ? [] : [{ value: "", label: "No answer" }]),
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
  ];

  function submit() {
    const out = buildAnswers(questions, draft);
    if (!out.ok) {
      errors = out.errors;
      return;
    }
    errors = {};
    onSend(out.answers);
  }
</script>

<form class="sq" data-testid="structured-question-form" onsubmit={(e) => { e.preventDefault(); submit(); }} novalidate>
  {#each questions as q (q.id)}
    {#if q.type === "multi-choice"}
      <fieldset class="group" aria-describedby={errors[q.id] ? `${fid(q)}-error` : undefined}>
        <legend>{label(q)}</legend>
        {#each q.options ?? [] as o (o.value)}
          <label class="check">
            <input type="checkbox" checked={picked(q).includes(o.value)} onchange={(e) => toggle(q, o.value, e.currentTarget.checked)} />
            <span>{o.label}{#if o.description}<span class="desc"> {o.description}</span>{/if}</span>
          </label>
        {/each}
        {#if q.allowOther}
          <Input id="{fid(q)}-other" placeholder="Something else" aria-label="{q.prompt}: something else" value={text(otherKey(q.id))} oninput={(e) => set(otherKey(q.id), e.currentTarget.value)} />
        {/if}
        {#if errors[q.id]}<p id="{fid(q)}-error" class="err" role="alert">{errors[q.id]}</p>{/if}
      </fieldset>
    {:else}
      <Field id={fid(q)} label={label(q)} error={errors[q.id] ?? ""}>
        {#if q.type === "single-choice"}
          <Select id={fid(q)} value={text(q.id)} options={choiceOptions(q)} placeholder="Choose" invalid={errors[q.id] !== undefined} onchange={(v) => set(q.id, v)} />
          {#if q.allowOther}
            <Input id="{fid(q)}-other" placeholder="Or type something else" aria-label="{q.prompt}: something else" value={text(otherKey(q.id))} oninput={(e) => set(otherKey(q.id), e.currentTarget.value)} />
          {/if}
        {:else if q.type === "boolean"}
          <Select id={fid(q)} value={text(q.id)} options={yesNo(q)} placeholder="Choose" invalid={errors[q.id] !== undefined} onchange={(v) => set(q.id, v)} />
        {:else if q.type === "number"}
          <Input id={fid(q)} type="number" inputmode="decimal" mono value={text(q.id)} invalid={errors[q.id] !== undefined} describedBy={errors[q.id] ? `${fid(q)}-error` : undefined} oninput={(e) => set(q.id, e.currentTarget.value)} />
        {:else}
          <Input id={fid(q)} maxlength={q.maxLength} value={text(q.id)} invalid={errors[q.id] !== undefined} describedBy={errors[q.id] ? `${fid(q)}-error` : undefined} oninput={(e) => set(q.id, e.currentTarget.value)} />
        {/if}
      </Field>
    {/if}
  {/each}
  <div><Button type="submit" size="sm" variant="primary" {disabled}>Send answers</Button></div>
</form>

<style>
  .sq { display: grid; gap: 12px; max-width: var(--cortex-measure); }
  .group { display: grid; gap: 6px; margin: 0; padding: 0; border: 0; min-width: 0; }
  legend { padding: 0; margin-bottom: 6px; font-size: var(--cortex-t-xs); font-weight: 500; color: var(--cortex-text-2); }
  .check { display: flex; align-items: baseline; gap: 8px; font-size: var(--cortex-t-sm); color: var(--cortex-text); }
  .desc { color: var(--cortex-text-3); font-size: var(--cortex-t-xs); }
  .err { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-bad); }
</style>
