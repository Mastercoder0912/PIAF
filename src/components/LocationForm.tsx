import { useState, type FormEvent } from "react";
import type { DistanceUnit } from "../engine";
import type { LocationErrors, LocationField, LocationFormValues } from "../state/locations";
import { TextField } from "./TextField";
import { UnitSelector } from "./UnitSelector";

type Variant = "add" | "edit";

// Separate wording per variant so the add form and an open edit form never share a label.
const COPY: Record<Variant, { name: string; distance: string; unit: string; submit: string }> = {
  add: { name: "Location name", distance: "Distance from start", unit: "Distance unit", submit: "Add location" },
  edit: { name: "Edit name", distance: "Edit distance", unit: "Edit distance unit", submit: "Save changes" },
};

export const BLANK_LOCATION_FORM: LocationFormValues = { name: "", distanceText: "", unit: "m" };

interface LocationFormProps {
  variant: Variant;
  initial: LocationFormValues;
  /** Hint under the distance box, e.g. "Must be before the finish (5000 m)." */
  distanceHint: string;
  /** Returns validation errors, or null when the location was saved. All rules live in the state layer and engine. */
  onSubmit: (values: LocationFormValues) => LocationErrors | null;
  onCancel?: () => void;
}

/** One form for adding and editing: text fields as typed, errors shown in red, nothing invalid is saved. */
export function LocationForm({ variant, initial, distanceHint, onSubmit, onCancel }: LocationFormProps) {
  const [values, setValues] = useState<LocationFormValues>(initial);
  const [errors, setErrors] = useState<LocationErrors>({});
  const copy = COPY[variant];
  const nameId = `${variant}-name`;
  const distanceId = `${variant}-distance`;

  function change(patch: Partial<LocationFormValues>, clears: LocationField[]) {
    setValues((current) => ({ ...current, ...patch }));
    setErrors((current) => {
      const next = { ...current };
      for (const field of clears) delete next[field];
      return next;
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problems = onSubmit(values);
    if (problems) {
      setErrors(problems);
      const firstInvalid = problems.name?.length ? nameId : problems.distance?.length ? distanceId : null;
      if (firstInvalid) document.getElementById(firstInvalid)?.focus();
      return;
    }
    setErrors({});
    if (variant === "add") {
      // Ready for the next location; keep the unit, since coaches tend to add several in one unit.
      setValues({ name: "", distanceText: "", unit: values.unit });
      document.getElementById(nameId)?.focus();
    }
  }

  const general = errors.general ?? [];

  return (
    <form className="loc-form" onSubmit={handleSubmit} noValidate aria-label={variant === "add" ? "Add location" : "Edit location"}>
      <TextField
        id={nameId}
        label={copy.name}
        value={values.name}
        onChange={(name) => change({ name }, ["name", "general"])}
        errors={errors.name}
        placeholder="e.g. Water stop"
      />
      <TextField
        id={distanceId}
        label={copy.distance}
        value={values.distanceText}
        onChange={(distanceText) => change({ distanceText }, ["distance", "general"])}
        errors={errors.distance}
        hint={distanceHint}
        placeholder="e.g. 1200"
        inputMode="decimal"
      />
      <UnitSelector
        legend={copy.unit}
        value={values.unit}
        onChange={(unit: DistanceUnit) => change({ unit }, ["distance", "general"])}
      />
      {general.length > 0 ? (
        <div className="error-summary" role="alert">
          {general.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      ) : null}
      <div className="actions">
        <button type="submit" className="btn btn-primary">
          {copy.submit}
        </button>
        {onCancel ? (
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
