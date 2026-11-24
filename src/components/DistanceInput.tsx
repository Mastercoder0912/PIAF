import type { DistanceUnit } from "../engine";
import { TextField } from "./TextField";
import { UnitSelector } from "./UnitSelector";

interface DistanceInputProps {
  text: string;
  unit: DistanceUnit;
  errors?: string[];
  onTextChange: (text: string) => void;
  onUnitChange: (unit: DistanceUnit) => void;
}

/** Race distance: a number plus a unit. Conversion to meters happens at Calculate time via the engine. */
export function DistanceInput({ text, unit, errors, onTextChange, onUnitChange }: DistanceInputProps) {
  return (
    <section className="group" aria-labelledby="distance-heading">
      <h2 id="distance-heading" className="group-title">
        Race distance
      </h2>
      <TextField
        id="distance"
        label="Distance"
        value={text}
        onChange={onTextChange}
        errors={errors}
        placeholder="e.g. 5"
        inputMode="decimal"
      />
      <UnitSelector legend="Distance unit" value={unit} onChange={onUnitChange} />
    </section>
  );
}
