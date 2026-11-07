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
}

/**
 * Mirrors the converter: the reading entered for a truck (else the one the API
 * saved from its last conversion) applies to its first trip, and each later month
 * starts where the previous one ended (+ miles). Trips arrive from the API already
 * ordered by company, truck, then date.
 */
export function tripOdometers(
  trips: TripSummary[],
  odometers: Record<string, string>,
  saved: Record<string, SavedOdometer> = {},
): TripOdometer[] {
  const running = new Map<string, number | null>();
  const fromSaved = new Set<string>();
  return trips.map((trip) => {
    const key = truckKey(trip.company, trip.unit);
    const editable = !running.has(key);
    if (editable) {
      const typed = (odometers[key] ?? '').trim();
      if (!typed && saved[key]) fromSaved.add(key);
      const parsed = OdometerReadingSchema.safeParse(typed || (saved[key]?.reading ?? ''));
      running.set(key, parsed.success ? Number(parsed.data) : null);
    }
    const odo = running.get(key) ?? null;
    if (odo !== null) running.set(key, odo + trip.totalDistance);
    return {
      key,
      editable,
      value: odo === null ? DEFAULT_BEGIN_ODO : String(Math.round(odo * 10) / 10),
      placeholder: odo === null,
      fromSaved: fromSaved.has(key),
    };
  });
}
