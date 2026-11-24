import { useCallback, useMemo, useReducer, useState } from "react";
import type { DistanceUnit, IntervalMode } from "../engine";
import {
  buildRaceConfig,
  runCalculation,
  sameConfig,
  type CalcOutcome,
  type CalcSuccess,
  type FieldErrors,
  type FieldName,
} from "./calculate";
import {
  INITIAL_FORM,
  formReducer,
  hasMeaningfulChanges,
  type EditableTextField,
  type TargetMode,
} from "./form";

const FIELD_FOR_TEXT: Record<EditableTextField, FieldName> = {
  distanceText: "distance",
  timeText: "time",
  paceText: "pace",
  intervalText: "interval",
};

function without(errors: FieldErrors, ...fields: FieldName[]): FieldErrors {
  const next = { ...errors };
  for (const field of fields) delete next[field];
  return next;
}

/**
 * All calculator state in one place, so it survives switching screens
 * (it lives in <App>, above the screens). Nothing is persisted anywhere.
 */
export interface CalculatorOptions {
  /** True when data outside the calculator (pacing locations) would also be lost by a reset, so confirm first. */
  hasExtraData?: boolean;
  /** Called when a reset is carried out, so other state can be cleared with it. */
  onReset?: () => void;
}

export function useCalculator(options: CalculatorOptions = {}) {
  const { hasExtraData = false, onReset } = options;
  const [form, dispatch] = useReducer(formReducer, INITIAL_FORM);
  const [result, setResult] = useState<CalcSuccess | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [confirmingReset, setConfirmingReset] = useState(false);

  // Results go stale when the inputs no longer describe the race that was calculated.
  const isStale = useMemo(
    () => result !== null && !sameConfig(buildRaceConfig(form), result.config),
    [form, result],
  );

  const calculate = useCallback((): CalcOutcome => {
    const outcome = runCalculation(form);
    if (outcome.ok) {
      setResult({ config: outcome.config, calculation: outcome.calculation });
      setErrors({});
    } else {
      // Never leave numbers on screen that don't match the (now invalid) inputs.
      setResult(null);
      setErrors(outcome.errors);
    }
    return outcome;
  }, [form]);

  const editText = useCallback((field: EditableTextField, value: string) => {
    dispatch({ type: "editText", field, value });
    setErrors((current) => without(current, FIELD_FOR_TEXT[field]));
  }, []);

  const setDistanceUnit = useCallback((unit: DistanceUnit) => {
    dispatch({ type: "setDistanceUnit", unit });
    setErrors((current) => without(current, "distance"));
  }, []);

  const setIntervalUnit = useCallback((unit: DistanceUnit) => {
    dispatch({ type: "setIntervalUnit", unit });
    setErrors((current) => without(current, "interval"));
  }, []);

  const setTargetMode = useCallback((mode: TargetMode) => {
    dispatch({ type: "setTargetMode", mode });
    setErrors((current) => without(current, "time", "pace"));
  }, []);

  const setIntervalMode = useCallback((mode: IntervalMode) => {
    dispatch({ type: "setIntervalMode", mode });
    setErrors((current) => without(current, "interval"));
  }, []);

  const setInterval = useCallback((text: string, unit: DistanceUnit) => {
    dispatch({ type: "setInterval", text, unit });
    setErrors((current) => without(current, "interval"));
  }, []);

  const performReset = useCallback(() => {
    dispatch({ type: "reset" });
    setResult(null);
    setErrors({});
    setConfirmingReset(false);
    onReset?.();
  }, [onReset]);

  /** Resets immediately, or asks first when there is something meaningful to lose. */
  const requestReset = useCallback(() => {
    if (hasMeaningfulChanges(form) || result !== null || hasExtraData) setConfirmingReset(true);
    else performReset();
  }, [form, result, hasExtraData, performReset]);

  const cancelReset = useCallback(() => setConfirmingReset(false), []);

  return {
    form,
    result,
    errors,
    isStale,
    confirmingReset,
    calculate,
    editText,
    setDistanceUnit,
    setIntervalUnit,
    setTargetMode,
    setIntervalMode,
    setInterval,
    requestReset,
    confirmReset: performReset,
    cancelReset,
  };
}

export type Calculator = ReturnType<typeof useCalculator>;
