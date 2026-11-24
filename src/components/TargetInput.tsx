import type { TargetMode } from "../state/form";
import { SegmentedControl, type SegmentOption } from "./SegmentedControl";
import { TextField } from "./TextField";

const MODE_OPTIONS: readonly SegmentOption<TargetMode>[] = [
  { value: "time", label: "Target Time" },
  { value: "pace", label: "Target Pace" },
];

interface TargetInputProps {
  mode: TargetMode;
  timeText: string;
  paceText: string;
  timeDerived: boolean;
  paceDerived: boolean;
  timeErrors?: string[];
  paceErrors?: string[];
  onModeChange: (mode: TargetMode) => void;
  onTimeChange: (text: string) => void;
  onPaceChange: (text: string) => void;
}

/** Two mutually exclusive ways to state the goal; only the selected one is shown. */
export function TargetInput({
  mode,
  timeText,
  paceText,
  timeDerived,
  paceDerived,
  timeErrors,
  paceErrors,
  onModeChange,
  onTimeChange,
  onPaceChange,
}: TargetInputProps) {
  return (
    <section className="group" aria-labelledby="target-heading">
      <h2 id="target-heading" className="group-title">
        Goal
      </h2>
      <SegmentedControl legend="Goal type" value={mode} options={MODE_OPTIONS} onChange={onModeChange} />
      {mode === "time" ? (
        <TextField
          id="time"
          label="Expected completion time"
          value={timeText}
          onChange={onTimeChange}
          errors={timeErrors}
          hint={
            timeDerived
              ? "MM:SS or HH:MM:SS. Converted from your pace; edit if needed."
              : "MM:SS or HH:MM:SS"
          }
          placeholder="e.g. 20:00"
        />
      ) : (
        <TextField
          id="pace"
          label="Pace per mile"
          value={paceText}
          onChange={onPaceChange}
          errors={paceErrors}
          hint={
            paceDerived
              ? "MM:SS per mile. Converted from your time; edit if needed."
              : "MM:SS per mile"
          }
          placeholder="e.g. 7:00"
        />
      )}
    </section>
  );
}
