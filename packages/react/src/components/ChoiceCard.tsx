import * as React from "react";

export interface ChoiceCardProps {
  readonly options: readonly string[];
  readonly onPick: (value: string) => void;
  readonly className?: string;
}

export function ChoiceCard({ options, onPick, className }: ChoiceCardProps): React.ReactElement {
  return (
    <div className={className} data-ra-choice>
      {options.map((opt) => (
        <button key={opt} type="button" data-ra-choice-option={opt} onClick={() => onPick(opt)}>
          {opt}
        </button>
      ))}
    </div>
  );
}
