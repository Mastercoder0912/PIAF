import type { DistanceUnit } from "../engine";
import { SegmentedControl, type SegmentOption } from "./SegmentedControl";

const UNIT_OPTIONS: readonly SegmentOption<DistanceUnit>[] = [
  { value: "m", label: "Meters" },
  { value: "km", label: "Kilometers" },
  { value: "mi", label: "Miles" },
];

interface UnitSelectorProps {
  legend: string;
  value: DistanceUnit;
  onChange: (unit: DistanceUnit) => void;
}

export function UnitSelector({ legend, value, onChange }: UnitSelectorProps) {
  return <SegmentedControl legend={legend} value={value} options={UNIT_OPTIONS} onChange={onChange} />;
}
