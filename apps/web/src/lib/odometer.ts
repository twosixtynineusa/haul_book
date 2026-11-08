import {
  DEFAULT_BEGIN_ODO,
  OdometerReadingSchema,
  truckKey,
  type SavedOdometer,
  type TripSummary,
} from '@haulbook/shared';

export interface TripOdometer {
  /** The odometer map key for this trip's truck (company + unit). */
  key: string;
  /** True on a truck's first trip — the only row with an input. */
  editable: boolean;
  /** What will be written as Begin Odo for this trip, given the readings typed so far. */
  value: string;
  placeholder: boolean;
  /** Nothing typed for the truck, so its reading saved from the last conversion is used. */
  fromSaved: boolean;
  /** Nothing typed for the truck, so this trip starts at the source file's own odometer. */
  fromFile: boolean;
}

/**
 * Mirrors the converter: the reading entered for a truck applies to its first trip,
 * and each later month starts where the previous one ended (+ miles). With nothing
 * entered, a trip whose source file records the odometer (Motive) starts and ends
 * there; otherwise the reading the API saved from the truck's last conversion
 * starts its first trip. Trips arrive from the API ordered by company, truck, date.
 */
export function tripOdometers(
  trips: TripSummary[],
  odometers: Record<string, string>,
  saved: Record<string, SavedOdometer> = {},
): TripOdometer[] {
  const running = new Map<string, number | null>();
  const typed = new Set<string>();
  const fromSaved = new Set<string>();
  return trips.map((trip) => {
    const key = truckKey(trip.company, trip.unit);
    const editable = !running.has(key);
    if (editable) {
      const text = (odometers[key] ?? '').trim();
      if (text) {
        typed.add(key);
        const entered = OdometerReadingSchema.safeParse(text);
        running.set(key, entered.success ? Number(entered.data) : null);
      } else {
        const stored = trip.fileOdometer ? undefined : saved[key];
        if (stored) fromSaved.add(key);
        running.set(key, stored ? Number(stored.reading) : null);
      }
    }
    const file = typed.has(key) ? null : trip.fileOdometer;
    const odo = file ? Number(file.begin) : (running.get(key) ?? null);
    running.set(key, file ? Number(file.end) : odo === null ? null : odo + trip.totalDistance);
    return {
      key,
      editable,
      value: odo === null ? DEFAULT_BEGIN_ODO : String(Math.round(odo * 10) / 10),
      placeholder: odo === null,
      fromSaved: fromSaved.has(key),
      fromFile: !!file,
    };
  });
}
