import * as React from "react";
import type { PendingInteractionWire } from "@reactive-agents/ui-core";
import { ChoiceCard } from "./ChoiceCard.js";

export interface AgentPromptProps {
  readonly interaction: PendingInteractionWire;
  readonly onRespond: (value: unknown) => void;
  readonly className?: string;
  readonly children?: (ctx: { interaction: PendingInteractionWire; submit: (v: unknown) => void }) => React.ReactNode;
}

interface FormField {
  readonly name: string;
  readonly label?: string;
  readonly type?: string;
  readonly required?: boolean;
}

export function AgentPrompt({ interaction, onRespond, className, children }: AgentPromptProps): React.ReactElement {
  if (children) return <>{children({ interaction, submit: onRespond })}</>;

  return (
    <div className={className} data-ra-prompt data-ra-kind={interaction.kind}>
      <p data-ra-prompt-text>{interaction.prompt}</p>
      {interaction.kind === "choice" && (
        <ChoiceCard options={(interaction.schema as { options?: readonly string[] })?.options ?? []} onPick={onRespond} />
      )}
      {interaction.kind === "confirmation" && (
        <div data-ra-confirm>
          <button type="button" onClick={() => onRespond(true)}>
            Yes
          </button>
          <button type="button" onClick={() => onRespond(false)}>
            No
          </button>
        </div>
      )}
      {interaction.kind === "form" && (
        <FormFields fields={(interaction.schema as { fields?: readonly FormField[] })?.fields ?? []} onSubmit={onRespond} />
      )}
    </div>
  );
}

function FormFields({
  fields,
  onSubmit,
}: {
  fields: readonly FormField[];
  onSubmit: (v: Record<string, string>) => void;
}): React.ReactElement {
  const [values, setValues] = React.useState<Record<string, string>>({});
  return (
    <form
      data-ra-form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
      }}
    >
      {fields.map((f) => (
        <label key={f.name} data-ra-field={f.name}>
          {f.label ?? f.name}
          <input
            type={f.type === "number" ? "number" : "text"}
            required={f.required}
            value={values[f.name] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
          />
        </label>
      ))}
      <button type="submit">Submit</button>
    </form>
  );
}
