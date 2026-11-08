'use client';

import { DEFAULT_BEGIN_ODO, type SavedOdometer, type TripSummary } from '@haulbook/shared';
import { formatDistance, plural } from '@/lib/format';
import { tripOdometers } from '@/lib/odometer';
import { cx } from './ui';

const SHOWN_STATES = 8;

/** One row per ProMiles trip (truck × month); the odometer is typed once per truck. */
export function ReviewTable({
  trips,
  odometers,
  saved,
  invalid,
  onOdometerChange,
  readOnly,
}: {
  trips: TripSummary[];
  odometers: Record<string, string>;
  /** Readings saved from each truck's last conversion, used while its input is blank. */
  saved: Record<string, SavedOdometer>;
  /** Truck keys (truckKey) whose typed odometer isn't a number. */
  invalid: Set<string>;
  onOdometerChange: (truck: string, value: string) => void;
  readOnly?: boolean;
}) {
  const odo = tripOdometers(trips, odometers, saved);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[600px] text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-muted-foreground">
          <tr className="border-b border-border">
            <th className="py-2 pr-4 font-medium">Truck</th>
            <th className="py-2 pr-4 font-medium">Trip period</th>
            <th className="py-2 pr-4 font-medium">States</th>
            <th className="py-2 pr-4 text-right font-medium">Distance</th>
            <th className="py-2 font-medium">Begin odometer</th>
          </tr>
        </thead>
        <tbody>
          {trips.map((t, i) => {
            const mismatch =
              t.reportedTotal !== null && Math.abs(t.reportedTotal - t.totalDistance) > 1;
            const bad = invalid.has(odo[i].key);
            const savedReading = saved[odo[i].key];
            return (
              <tr
                key={`${odo[i].key}:${t.beginDate}`}
                className="border-b border-border align-top last:border-0"
              >
                <td className="py-3 pr-4">
                  <p className="font-semibold">Unit {t.unit}</p>
                  <p className="max-w-[12rem] truncate text-xs" title={t.company}>
                    {t.company}
                  </p>
                  <p
                    className="max-w-[10rem] truncate text-xs text-muted-foreground"
                    title={t.sourceFile}
                  >
                    {t.sourceFile}
                  </p>
                </td>
                <td className="whitespace-nowrap py-3 pr-4 tabular-nums">
                  {t.beginDate} – {t.endDate}
                </td>
                <td className="py-3 pr-4">
                  <div className="flex max-w-[22rem] flex-wrap gap-1" title={t.states.join(' → ')}>
                    {t.states.slice(0, SHOWN_STATES).map((s) => (
                      <span key={s} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {s}
                      </span>
                    ))}
                    {t.states.length > SHOWN_STATES && (
                      <span className="px-1 py-0.5 text-xs text-muted-foreground">
                        +{t.states.length - SHOWN_STATES} more
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {plural(t.states.length, 'state')}
                  </p>
                </td>
                <td className="whitespace-nowrap py-3 pr-4 text-right tabular-nums">
                  <p className="font-medium">{formatDistance(t.totalDistance, t.distanceUnit)}</p>
                  {t.reportedTotal !== null && (
                    <p
                      className={cx('text-xs', mismatch ? 'text-warning' : 'text-muted-foreground')}
                    >
                      Report total {formatDistance(t.reportedTotal, t.distanceUnit)}
                    </p>
                  )}
                </td>
                <td className="py-3">
                  {odo[i].editable ? (
                    <>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={odometers[odo[i].key] ?? ''}
                        onChange={(e) => onOdometerChange(odo[i].key, e.target.value)}
                        readOnly={readOnly}
                        placeholder={
                          t.fileOdometer
                            ? t.fileOdometer.begin
                            : savedReading && odo[i].fromSaved
                              ? savedReading.reading
                              : `${DEFAULT_BEGIN_ODO} (placeholder)`
                        }
                        aria-label={`Begin odometer for ${t.company} unit ${t.unit}`}
                        aria-invalid={bad}
                        className={cx(
                          'w-36 rounded-md border bg-background px-2.5 py-1.5 text-sm tabular-nums',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          bad ? 'border-danger' : 'border-input',
                          readOnly && 'bg-muted text-muted-foreground',
                        )}
                      />
                      {bad && <p className="mt-1 text-xs text-danger">Numbers only, e.g. 184310</p>}
                      {odo[i].fromSaved && savedReading && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Saved: end of {savedReading.asOf}
                        </p>
                      )}
                      {odo[i].fromFile && (
                        <p className="mt-1 text-xs text-muted-foreground">From the file</p>
                      )}
                    </>
                  ) : (
                    <p className="py-1.5 text-sm tabular-nums text-muted-foreground">
                      {odo[i].placeholder
                        ? `${DEFAULT_BEGIN_ODO} (placeholder)`
                        : `${odo[i].value} (${odo[i].fromFile ? 'from file' : 'carried forward'})`}
                    </p>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
