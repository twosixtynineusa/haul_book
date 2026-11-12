import {
  DEFAULT_BEGIN_ODO,
  companyKey,
  truckKey,
  type OdometerMap,
  type SavedOdometer,
  type TripSummary,
} from '@haulbook/shared';
import {
  ConversionError,
  sumLegs,
  totalsDisagree,
  type DistanceUnit,
  type PeriodTrip,
  type SavedReading,
  type SourceReport,
} from './common';

/**
 * ProMiles FuelTaxOnline TRIPSUMMARY2 writer (docs/data-contracts.md §2).
 *
 * Every truck (company + unit) gets one distance-mode trip per reporting period,
 * with one leg per state ordered by first entry. ProMiles imports a file under
 * ONE customer, so each company gets its own file. ProMiles rejects a trip row
 * unless columns A–I all have a value, so Begin Odo is always written: the
 * reading typed for the truck (carried forward across later periods), else the
 * period's own odometer when the source records one (Motive), else the one saved
 * from its previous conversion (carried forward); or DEFAULT_BEGIN_ODO.
 */

export const PROMILES_HEADER = [
  'Unit#',
  'Begin Date',
  'End date',
  'Begin Odo',
  'D(istance) or O(dometer)',
  'M(iles) or K(ilometers)',
  'State',
  'Distance or Odometer',
  'Toll Distance',
  'Empty(Y/N)',
  'Off Road(Y/N)',
  'Permitting (None, IFTA, Mile, Both)',
];

/** One uploaded report, attributed to a truck. */
export interface TruckReport {
  company: string;
  /** The truck # in the source; matching, odometers and history go by it. */
  unit: string;
  /** The unit # written to ProMiles (column A), when it isn't `unit` itself. */
  promilesUnit?: string;
  sourceFile: string;
  report: SourceReport;
}

/** Where a truck's odometer ends in this file: saved for its next conversion. */
export interface EndReading extends SavedReading {
  unit: string;
}

export interface CompanyOutput {
  company: string;
  units: string[];
  /** Aligned with `units`: what ProMiles got for each. */
  promilesUnits: string[];
  csv: string;
  trips: TripSummary[];
  /** Only trucks with a real reading; a placeholder Begin Odo is never saved. */
  odometers: EndReading[];
}

export interface ProMilesOutput {
  outputs: CompanyOutput[];
  trips: TripSummary[];
  warnings: string[];
  /** The saved readings used, by truckKey, because none was typed. */
  savedUsed: Record<string, SavedOdometer>;
}

interface Truck {
  company: string;
  unit: string;
  promilesUnit: string;
  distanceUnit: DistanceUnit;
  trips: { trip: PeriodTrip; sourceFile: string }[];
}

function csvLine(cells: string[]): string {
  return cells.map((c) => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',');
}

function fmtDate(d: Date): string {
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthIndex(d: Date): number {
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/** Midnight of the same day: what a Postgres `date` column gives back. */
function dayOf(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function fmtOdo(odo: number): string {
  return String(Math.round(odo * 10) / 10);
}

function sortedLegs(trip: PeriodTrip) {
  return [...trip.legs].sort((a, b) => a.begin.getTime() - b.begin.getTime());
}

function startOf(trip: PeriodTrip): Date {
  return trip.period?.[0] ?? sortedLegs(trip)[0].begin;
}

function endOf(trip: PeriodTrip): Date {
  return trip.period?.[1] ?? new Date(Math.max(...trip.legs.map((leg) => leg.end.getTime())));
}

/** Groups reports into companies → trucks, in upload order. */
function groupTrucks(reports: TruckReport[], warnings: string[]): Map<string, Truck[]> {
  const companies = new Map<string, Truck[]>();
  for (const { company, unit, promilesUnit, sourceFile, report } of reports) {
    const trucks = companies.get(companyKey(company)) ?? [];
    companies.set(companyKey(company), trucks);
    let truck = trucks.find((t) => t.unit === unit);
    if (!truck) {
      truck = {
        company,
        unit,
        promilesUnit: promilesUnit ?? unit,
        distanceUnit: report.distanceUnit,
        trips: [],
      };
      trucks.push(truck);
    }
    if (truck.distanceUnit !== report.distanceUnit) {
      throw new ConversionError(
        `${company} unit ${unit}: one report is in miles, another in kilometres`,
      );
    }
    for (const trip of report.trips) {
      if (trip.legs.length === 0) {
        warnings.push(`${sourceFile}: a period with no state rows was skipped`);
        continue;
      }
      truck.trips.push({ trip, sourceFile });
    }
  }
  return companies;
}

/**
 * `odometers` are the readings typed in the portal; `saved` the ones stored from
 * earlier conversions (by truckKey). A saved reading is used only for a truck with
 * nothing typed, and only when the truck's first trip starts after it was taken.
 */
export function writeProMiles(
  reports: TruckReport[],
  odometers: OdometerMap = {},
  saved: ReadonlyMap<string, SavedReading> = new Map(),
): ProMilesOutput {
  const warnings: string[] = [];
  const savedUsed: Record<string, SavedOdometer> = {};
  const companies = groupTrucks(reports, warnings);

  const trucksByKey = new Set(
    [...companies.values()].flat().map((t) => truckKey(t.company, t.unit)),
  );
  for (const key of Object.keys(odometers)) {
    if (!trucksByKey.has(key)) {
      warnings.push(
        `odometer given for ${key.replace('\u001f', ' unit ')}, which is not in the upload`,
      );
    }
  }

  const outputs: CompanyOutput[] = [];
  for (const trucks of companies.values()) {
    // LF line endings, matching ProMiles' own example file.
    const lines = [
      csvLine(['###TRIPSUMMARY2', ...Array<string>(PROMILES_HEADER.length - 1).fill('')]),
      csvLine(PROMILES_HEADER),
    ];
    const summaries: TripSummary[] = [];
    const ends: EndReading[] = [];

    for (const truck of trucks) {
      const { company, unit, promilesUnit, distanceUnit } = truck;
      const label = `${company} unit ${unit}`;
      truck.trips.sort((a, b) => startOf(a.trip).getTime() - startOf(b.trip).getTime());

      // The same month for the same truck in two uploads would double-count miles. A trip can
      // span several months (a distance summary over a quarter), so compare month ranges.
      const seen = new Map<number, string>();
      for (const { trip, sourceFile } of truck.trips) {
        const [from, to] = [monthIndex(startOf(trip)), monthIndex(endOf(trip))];
        for (let month = from; month <= to; month++) {
          const other = seen.get(month);
          if (other) {
            const key = monthKey(new Date(Date.UTC(Math.floor(month / 12), month % 12, 1)));
            throw new ConversionError(
              `${label}: ${key} is in more than one file (${other}, ${sourceFile})`,
            );
          }
          seen.set(month, sourceFile);
        }
      }

      // A real reading carries forward: next period starts where this one ended. Without a
      // typed one, a period whose source records the odometer starts and ends there instead.
      const truckId = truckKey(company, unit);
      const reading = odometers[truckId];
      const fromFile = (trip: PeriodTrip) => (reading === undefined ? trip.odometer : null);
      let odo: number | null = reading !== undefined ? Number(reading) : null;
      const firstTrip = truck.trips[0]?.trip;
      const stored =
        reading === undefined && firstTrip && !fromFile(firstTrip) ? saved.get(truckId) : undefined;
      const first = firstTrip && dayOf(startOf(firstTrip));
      if (stored && first) {
        const asOf = fmtDate(stored.asOf);
        if (first > stored.asOf) {
          odo = stored.reading;
          savedUsed[truckId] = { reading: fmtOdo(stored.reading), asOf };
          if (monthIndex(first) - monthIndex(stored.asOf) > 1) {
            warnings.push(
              `${label}: the saved odometer is from ${asOf} and the months between weren't ` +
                `converted, so Begin Odo is short by their miles`,
            );
          }
        } else {
          warnings.push(
            `${label}: the saved odometer (${asOf}) is not before this upload, so Begin Odo is ` +
              `the placeholder ${DEFAULT_BEGIN_ODO} unless you enter one`,
          );
        }
      }
      let lastEnd: Date | null = null;

      for (const { trip, sourceFile } of truck.trips) {
        const legs = sortedLegs(trip);
        const [start, end] = trip.period ?? [
          legs[0].begin,
          new Date(Math.max(...legs.map((leg) => leg.end.getTime()))),
        ];
        const summed = sumLegs(legs);
        if (trip.reportedTotal !== null && totalsDisagree(summed, trip.reportedTotal)) {
          warnings.push(
            `${label} (${fmtDate(start)}): state rows sum to ${summed} but the report total is ${trip.reportedTotal}`,
          );
        }

        const fileOdo = fromFile(trip);
        if (fileOdo) odo = fileOdo.begin;
        const beginOdo = odo === null ? DEFAULT_BEGIN_ODO : fmtOdo(odo);
        legs.forEach((leg, i) => {
          const head =
            i === 0
              ? [promilesUnit, fmtDate(start), fmtDate(end), beginOdo, 'D', distanceUnit]
              : Array<string>(6).fill('');
          lines.push(csvLine([...head, leg.state, leg.distance, '0', 'n', 'n', '']));
        });

        summaries.push({
          company,
          unit,
          promilesUnit,
          sourceFile,
          beginDate: fmtDate(start),
          endDate: fmtDate(end),
          beginOdo,
          beginOdoIsPlaceholder: odo === null,
          distanceUnit,
          states: legs.map((leg) => leg.state),
          totalDistance: Math.round(summed * 100) / 100,
          reportedTotal: trip.reportedTotal,
          fileOdometer: trip.odometer
            ? { begin: fmtOdo(trip.odometer.begin), end: fmtOdo(trip.odometer.end) }
            : null,
        });
        if (fileOdo) odo = fileOdo.end;
        else if (odo !== null) odo += summed;
        lastEnd = end;
      }
      if (odo !== null && lastEnd) {
        ends.push({ unit, reading: Math.round(odo * 10) / 10, asOf: dayOf(lastEnd) });
      }
    }

    if (summaries.length > 0) {
      outputs.push({
        company: trucks[0].company,
        units: trucks.filter((t) => t.trips.length > 0).map((t) => t.unit),
        promilesUnits: trucks.filter((t) => t.trips.length > 0).map((t) => t.promilesUnit),
        csv: lines.join('\n') + '\n',
        trips: summaries,
        odometers: ends,
      });
    }
  }

  if (outputs.length === 0) {
    throw new ConversionError('No state mileage was found in the uploaded file(s)');
  }
  return { outputs, trips: outputs.flatMap((o) => o.trips), warnings, savedUsed };
}
