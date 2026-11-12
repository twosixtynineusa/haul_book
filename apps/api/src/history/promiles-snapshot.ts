import { parse } from 'csv-parse/sync';
import { ProMilesTripSchema, type ProMilesTrip, type HistoryTrip } from '@haulbook/shared';
import { parseDate, stateCode } from '../conversion/common';
import { PROMILES_HEADER } from '../conversion/promiles';

/** Read only the exact distance-mode format our writer exports; preserve every column as text. */
export function parseProMilesCsv(csv: string): ProMilesTrip[] {
  const rows: string[][] = parse(csv, { skip_empty_lines: true });
  if (
    rows[0]?.[0] !== '###TRIPSUMMARY2' ||
    JSON.stringify(rows[1]) !== JSON.stringify(PROMILES_HEADER)
  ) {
    throw new Error('Not a Haul Book ProMiles TRIPSUMMARY2 CSV');
  }
  const trips: ProMilesTrip[] = [];
  for (const row of rows.slice(2)) {
    if (row.length !== 12) throw new Error('Expected 12 ProMiles columns');
    if (row[0]) {
      trips.push(
        ProMilesTripSchema.parse({
          unit: row[0],
          beginDate: parseDate(row[1], 'ProMiles').toISOString().slice(0, 10),
          endDate: parseDate(row[2], 'ProMiles').toISOString().slice(0, 10),
          beginOdo: row[3],
          mode: row[4],
          distanceUnit: row[5],
          legs: [],
        }),
      );
    } else if (row.slice(0, 6).some(Boolean)) throw new Error('Invalid ProMiles continuation row');
    const trip = trips.at(-1);
    if (!trip || !stateCode(row[6]) || !/^\d+(?:\.\d+)?$/.test(row[7]))
      throw new Error('Invalid ProMiles state mileage');
    trip.legs.push({
      state: row[6],
      distance: row[7],
      tollDistance: row[8],
      empty: row[9],
      offRoad: row[10],
      permitting: row[11],
    });
  }
  if (!trips.length) throw new Error('No ProMiles trips');
  return trips;
}

/** Match on exported truck number and exact period, never by filename or array position. */
export function attachProMiles(
  trips: HistoryTrip[],
  unit: string,
  stored: ProMilesTrip[],
): HistoryTrip[] {
  return trips.map((trip) => {
    const matches = stored.filter(
      (s) => s.unit === unit && s.beginDate === trip.beginDate && s.endDate === trip.endDate,
    );
    const match = matches.length === 1 ? matches[0] : null;
    const distance = match?.legs.reduce((n, l) => n + Number(l.distance), 0);
    return match && Math.round(distance! * 100) / 100 === trip.distance
      ? { ...trip, promiles: match }
      : trip;
  });
}
