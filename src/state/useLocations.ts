import { useCallback, useState } from "react";
import type { RaceCalculation } from "../engine";
import {
  INITIAL_LOCATIONS,
  addLocation,
  clearLocations,
  importSplits,
  removeLocation,
  undoDelete,
  updateLocation,
  type ImportOutcome,
  type LocationFormValues,
  type LocationOutcome,
  type RemoveOutcome,
} from "./locations";

/**
 * React wrapper around the pure location functions. It holds ONLY the stored
 * locations (name, distance, unit, id): no race and no times. The race is
 * handed in when an action needs it, and the screen derives times from it.
 *
 * Lives in <App>, above the screens, so locations survive switching screens.
 * Nothing is persisted.
 */
export function useLocations() {
  const [state, setState] = useState(INITIAL_LOCATIONS);

  // Each action computes from the current state, applies it only if it succeeded,
  // and returns the outcome so the caller can show errors.
  const add = useCallback(
    (values: LocationFormValues, race: RaceCalculation | null): LocationOutcome => {
      const outcome = addLocation(state, values, race);
      if (outcome.ok) setState(outcome.state);
      return outcome;
    },
    [state],
  );

  const update = useCallback(
    (id: string, values: LocationFormValues, race: RaceCalculation | null): LocationOutcome => {
      const outcome = updateLocation(state, id, values, race);
      if (outcome.ok) setState(outcome.state);
      return outcome;
    },
    [state],
  );

  const remove = useCallback(
    (id: string): RemoveOutcome => {
      const outcome = removeLocation(state, id);
      if (outcome.ok) setState(outcome.state);
      return outcome;
    },
    [state],
  );

  const undo = useCallback(() => setState((current) => undoDelete(current)), []);

  const importFromSplits = useCallback(
    (race: RaceCalculation | null): ImportOutcome => {
      const outcome = importSplits(state, race);
      if (outcome.ok && outcome.added > 0) setState(outcome.state);
      return outcome;
    },
    [state],
  );

  const clear = useCallback(() => setState((current) => clearLocations(current)), []);

  return {
    items: state.items,
    lastDeleted: state.lastDeleted,
    count: state.items.length,
    add,
    update,
    remove,
    undo,
    importFromSplits,
    clear,
  };
}

export type LocationsStore = ReturnType<typeof useLocations>;
