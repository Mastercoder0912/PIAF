import { useEffect, useRef, type FormEvent } from "react";
import { DistanceInput } from "../components/DistanceInput";
import { IntervalSelector } from "../components/IntervalSelector";
import { ResultSummary } from "../components/ResultSummary";
import { SplitTable } from "../components/SplitTable";
import { TargetInput } from "../components/TargetInput";
import { FIELD_ORDER, type FieldErrors } from "../state/calculate";
import type { Calculator } from "../state/useCalculator";

function focusFirstInvalidField(errors: FieldErrors): void {
  for (const field of FIELD_ORDER) {
    if (errors[field]?.length) {
      document.getElementById(field)?.focus();
      return;
    }
  }
}

export function CalculatorScreen({
  calc,
  pacingLocationCount = 0,
}: {
  calc: Calculator;
  /** Pacing locations are cleared by Reset too, so the confirmation says so when there are any. */
  pacingLocationCount?: number;
}) {
  const { form, errors, result, isStale, confirmingReset } = calc;
  const resultsRef = useRef<HTMLDivElement>(null);

  // After a successful calculation, bring the results into view (matters on phones,
  // where they sit below the form) and move keyboard/screen-reader focus to them.
  useEffect(() => {
    const panel = resultsRef.current;
    if (!result || !panel) return;
    const { top } = panel.getBoundingClientRect();
    if (top < 0 || top > window.innerHeight * 0.6) {
      panel.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }
    panel.focus({ preventScroll: true });
  }, [result]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const outcome = calc.calculate();
    if (!outcome.ok) focusFirstInvalidField(outcome.errors);
  }

  const generalErrors = errors.general ?? [];
  const hasErrors = Object.values(errors).some((messages) => messages && messages.length > 0);

  return (
    <div className="layout">
      <form className="card form" onSubmit={handleSubmit} noValidate aria-label="Race calculator">
        <DistanceInput
          text={form.distanceText}
          unit={form.distanceUnit}
          errors={errors.distance}
          onTextChange={(text) => calc.editText("distanceText", text)}
          onUnitChange={calc.setDistanceUnit}
        />

        <TargetInput
          mode={form.targetMode}
          timeText={form.timeText}
          paceText={form.paceText}
          timeDerived={form.timeDerived}
          paceDerived={form.paceDerived}
          timeErrors={errors.time}
          paceErrors={errors.pace}
          onModeChange={calc.setTargetMode}
          onTimeChange={(text) => calc.editText("timeText", text)}
          onPaceChange={(text) => calc.editText("paceText", text)}
        />

        <IntervalSelector
          mode={form.intervalMode}
          text={form.intervalText}
          unit={form.intervalUnit}
          errors={errors.interval}
          onModeChange={calc.setIntervalMode}
          onTextChange={(text) => calc.editText("intervalText", text)}
          onUnitChange={calc.setIntervalUnit}
          onPreset={calc.setInterval}
        />

        {hasErrors ? (
          <div className="error-summary" role="alert">
            <p>Check the highlighted fields, then press Calculate again.</p>
            {generalErrors.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        ) : null}

        <div className="actions">
          <button type="submit" className="btn btn-primary">
            Calculate
          </button>
          <button type="button" className="btn btn-secondary" onClick={calc.requestReset}>
            Reset
          </button>
        </div>

        {confirmingReset ? (
          <div
            className="confirm"
            role="alertdialog"
            aria-labelledby="confirm-title"
            onKeyDown={(event) => {
              if (event.key === "Escape") calc.cancelReset();
            }}
          >
            <p id="confirm-title">
              {pacingLocationCount > 0
                ? `Clear everything you've entered, the current results, and your ${pacingLocationCount} pacing ${pacingLocationCount === 1 ? "location" : "locations"}?`
                : "Clear everything you've entered and the current results?"}
            </p>
            <div className="confirm-actions">
              <button type="button" className="btn btn-danger" onClick={calc.confirmReset}>
                Yes, reset
              </button>
              <button type="button" className="btn btn-secondary" onClick={calc.cancelReset} autoFocus>
                Keep editing
              </button>
            </div>
          </div>
        ) : null}
      </form>

      <section className="card results" aria-labelledby="results-heading">
        <h2 id="results-heading" className="group-title" ref={resultsRef} tabIndex={-1}>
          Results
        </h2>
        {result ? (
          <div className={isStale ? "results-body is-stale" : "results-body"}>
            {isStale ? (
              <p className="stale-note" role="status">
                Inputs changed since this was calculated. Press Calculate to update.
              </p>
            ) : null}
            <ResultSummary calculation={result.calculation} mode={form.targetMode} />
            <SplitTable splits={result.calculation.splits} />
          </div>
        ) : (
          <p className="placeholder">
            Enter your race details and press <strong>Calculate</strong> to see the split table.
          </p>
        )}
      </section>
    </div>
  );
}
