import { formatDistanceLabel, type RaceCalculation } from "../engine";
import { formatTenths } from "../display";
import type { TargetMode } from "../state/form";

interface ResultSummaryProps {
  calculation: RaceCalculation;
  /** Which value the coach entered; the other one is shown as "calculated". */
  mode: TargetMode;
}

function Stat({
  label,
  value,
  unit,
  calculated,
}: {
  label: string;
  value: string;
  unit?: string;
  calculated?: boolean;
}) {
  return (
    <div className="stat">
      <dt className="stat-label">
        {label}
        {calculated ? <span className="calc-tag">calculated</span> : null}
      </dt>
      <dd className="stat-value">
        {value}
        {unit ? <span className="stat-unit">{` ${unit}`}</span> : null}
      </dd>
    </div>
  );
}

export function ResultSummary({ calculation, mode }: ResultSummaryProps) {
  return (
    <dl className="summary">
      <Stat label="Distance" value={formatDistanceLabel(calculation.totalDistanceMeters)} />
      <Stat
        label="Completion time"
        value={formatTenths(calculation.totalTimeSeconds)}
        calculated={mode === "pace"}
      />
      <Stat
        label="Mile pace"
        value={formatTenths(calculation.paceSecondsPerMile)}
        unit="/mi"
        calculated={mode === "time"}
      />
    </dl>
  );
}
