import { formatDistanceLabel, type Split } from "../engine";
import { formatTenths } from "../display";

interface SplitTableProps {
  splits: readonly Split[];
}

/** Every generated split. Times are rounded to tenths for display only; the splits themselves are untouched. */
export function SplitTable({ splits }: SplitTableProps) {
  return (
    <div className="table-wrap">
      <table className="splits">
        <caption className="sr-only">Target passing time at each split</caption>
        <thead>
          <tr>
            <th scope="col" className="col-num">
              #
            </th>
            <th scope="col">Distance</th>
            <th scope="col" className="col-time">
              Target time
            </th>
          </tr>
        </thead>
        <tbody>
          {splits.map((split, index) => (
            <tr key={split.id} className={split.isFinish ? "finish-row" : undefined}>
              <td className="col-num">{index + 1}</td>
              <th scope="row" className="col-distance">
                <span className="distance-text">
                  {split.isFinish ? formatDistanceLabel(split.distanceMeters) : split.label}
                </span>
                {split.isFinish ? <span className="finish-pill">Finish</span> : null}
              </th>
              <td className="col-time">{formatTenths(split.targetTimeSeconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
