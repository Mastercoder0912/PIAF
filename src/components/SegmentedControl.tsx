import { useId } from "react";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  /** Accessible group name (screen readers); not shown visually. */
  legend: string;
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (value: T) => void;
}

/** A row of mutually exclusive choices, built on real radio inputs for keyboard and screen-reader support. */
export function SegmentedControl<T extends string>({
  legend,
  value,
  options,
  onChange,
}: SegmentedControlProps<T>) {
  const name = useId();
  return (
    <fieldset className="segmented">
      <legend className="sr-only">{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className="segment">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
