import type { DistanceUnit, IntervalMode } from "../engine";
import { SegmentedControl, type SegmentOption } from "./SegmentedControl";
import { TextField } from "./TextField";
import { UnitSelector } from "./UnitSelector";

const MODE_OPTIONS: readonly SegmentOption<IntervalMode>[] = [
  { value: "automatic", label: "Automatic" },
  { value: "manual", label: "Manual" },
];

interface Preset {
  label: string;
  text: string;
  unit: DistanceUnit;
}

const PRESETS: readonly Preset[] = [
  { label: "100 m", text: "100", unit: "m" },
  { label: "200 m", text: "200", unit: "m" },
  { label: "400 m", text: "400", unit: "m" },
  { label: "800 m", text: "800", unit: "m" },
  { label: "1000 m", text: "1000", unit: "m" },
  { label: "1 mile", text: "1", unit: "mi" },
];

interface IntervalSelectorProps {
  mode: IntervalMode;
  text: string;
  unit: DistanceUnit;
  errors?: string[];
  onModeChange: (mode: IntervalMode) => void;
  onTextChange: (text: string) => void;
  onUnitChange: (unit: DistanceUnit) => void;
  onPreset: (text: string, unit: DistanceUnit) => void;
}

export function IntervalSelector({
  mode,
  text,
  unit,
  errors,
  onModeChange,
  onTextChange,
  onUnitChange,
  onPreset,
}: IntervalSelectorProps) {
  return (
    <section className="group" aria-labelledby="interval-heading">
      <h2 id="interval-heading" className="group-title">
        Split intervals
      </h2>
      <SegmentedControl legend="Interval type" value={mode} options={MODE_OPTIONS} onChange={onModeChange} />

      {mode === "automatic" ? (
        <p className="hint">
          Under a mile: every 200 m. A one-mile race: every 400 m. Longer than a mile: every mile. The
          finish is always included.
        </p>
      ) : (
        <>
          <TextField
            id="interval"
            label="Interval distance"
            value={text}
            onChange={onTextChange}
            errors={errors}
            hint="A split is shown every this far, plus the finish."
            placeholder="e.g. 400"
            inputMode="decimal"
          />
          <UnitSelector legend="Interval unit" value={unit} onChange={onUnitChange} />
          <div className="presets" role="group" aria-label="Quick intervals">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="chip"
                aria-pressed={text.trim() === preset.text && unit === preset.unit}
                onClick={() => onPreset(preset.text, preset.unit)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
