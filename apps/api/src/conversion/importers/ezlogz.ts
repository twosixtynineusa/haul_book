import { parse } from 'csv-parse/sync';
import {
  ConversionError,
  decodeText,
  parseDate,
  parseDistance,
  stateCode,
  type DistanceUnit,
  type Leg,
  type PeriodTrip,
  type SourceReport,
} from '../common';
import type { Importer } from './types';

/**
 * EZLogz "Mileage Report" CSV export (docs/data-contracts.md §4), e.g. `Mileage_Report.csv`.
 * Four sections, one after the other, each starting with its own header row:
 *
 *     State,Miles                      ← totals per state, alphabetical
 *     Kansas,275.8 mi
 *     …
 *     Total distance:,2593.5 mi
 *     Driver,State,Miles               ← per driver: a total row (no state), then states
 *     John Doe,,1767.1 mi
 *     John Doe,Texas,433.2 mi
 *     …
 *     Units,State,Miles                ← per unit: a total row (no state), then states
 *     52,,2593.5 mi
 *     52,Texas,433.2 mi
 *     …
 *     Date,State,Driver,Unit,Miles     ← per day: a total row (no state), then states
 *     2026-10-03,,,,531.1 mi
 *     2026-10-03,Texas,John Doe,Texas,120.4 mi
 *     …
 *
 * Comma-separated, LF, no BOM. Full state names, miles with a ` mi` suffix. The file carries
 * no company and no period line. The unit # is the Units section's; the daily rows don't say
 * which unit drove them (EZLogz writes the state again in their Unit column), so a file must
 * list exactly one unit. The daily rows make one trip per month, with one leg per state from
 * its first to its last day that month, in order of first entry. Legs get whole miles (half
 * up), and the exact sum of that month's daily totals is the report's own total.
 */

type Section = 'states' | 'drivers' | 'units' | 'days';

const HEADERS: [RegExp, Section][] = [
  [/^state,miles$/, 'states'],
  [/^driver,state,miles$/, 'drivers'],
  [/^units?,state,miles$/, 'units'],
  [/^date,state,driver,unit,miles$/, 'days'],
];

function lines(text: string): string[] {
  return text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim());
}

function cells(line: string): string[] {
  return (parse(line, { relax_quotes: true, relax_column_count: true })[0] ?? []).map((c: string) =>
    c.trim(),
  );
}

function headerOf(row: string[]): Section | null {
  const key = row.join(',').toLowerCase().replace(/\s+/g, '');
  return HEADERS.find(([re]) => re.test(key))?.[1] ?? null;
}

/** To 2 decimals, so float sums like 388.49999999 still round half up as 388.5. */
function exact(n: number): number {
  return Math.round(n * 100) / 100;
}

export function detectEzlogz(bytes: Buffer): boolean {
  const head = lines(decodeText(bytes.subarray(0, 4096)));
  return (
    /^state\s*,\s*miles$/i.test(head[0] ?? '') && head.some((l) => /^total distance:\s*,/i.test(l))
  );
}

interface MonthLegs {
  /** Exact miles per state (insertion order = first entry), plus its first/last day. */
  legs: Map<string, { begin: Date; end: Date; miles: number }>;
  dayTotals: number | null;
}

export function readEzlogz(
  file: { name: string; bytes: Buffer },
  warnings: string[],
): SourceReport {
  const all = lines(decodeText(file.bytes));
  if (!/^state\s*,\s*miles$/i.test(all[0] ?? '')) {
    throw new ConversionError(`${file.name}: not an EZLogz mileage report`);
  }

  let section: Section | null = null;
  let distanceUnit: DistanceUnit | null = null;
  const units: string[] = [];
  const unitStates = new Map<string, number>();
  const months = new Map<string, MonthLegs>();

  const miles = (value: string, where: string): number => {
    const [number, suffix] = parseDistance(value, where);
    const found = suffix ?? 'M';
    if (distanceUnit && distanceUnit !== found) {
      throw new ConversionError(`${where}: mixes miles and kilometres`);
    }
    distanceUnit = found;
    return Number(number);
  };
  const code = (state: string, where: string): string => {
    const c = stateCode(state);
    if (!c) throw new ConversionError(`${where}: unknown state/province "${state}"`);
    return c;
  };

  for (const [i, line] of all.entries()) {
    const where = `${file.name}:${i + 1}`;
    if (!line) continue;
    const row = cells(line);
    const header = headerOf(row);
    if (header) {
      section = header;
      continue;
    }

    if (section === 'units') {
      const [unit = '', state = '', distance = ''] = row;
      if (!state) {
        if (unit && !units.includes(unit)) units.push(unit);
        continue;
      }
      const c = code(state, where);
      unitStates.set(c, (unitStates.get(c) ?? 0) + miles(distance, where));
    } else if (section === 'days') {
      const [day = '', state = '', , , distance = ''] = row;
      const date = parseDate(day, where);
      const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
      const month = months.get(key) ?? { legs: new Map(), dayTotals: null };
      months.set(key, month);
      if (!state) {
        month.dayTotals = (month.dayTotals ?? 0) + miles(distance, where);
        continue;
      }
      const c = code(state, where);
      const leg = month.legs.get(c);
      if (leg) {
        leg.miles += miles(distance, where);
        if (date < leg.begin) leg.begin = date;
        if (date > leg.end) leg.end = date;
      } else {
        month.legs.set(c, { begin: date, end: date, miles: miles(distance, where) });
      }
    }
    // The state and driver summaries repeat what the units and days sections hold.
  }

  if (units.length === 0) throw new ConversionError(`${file.name}: no "Units,State,Miles" section`);
  if (units.length > 1) {
    throw new ConversionError(
      `${file.name}: lists ${units.length} units (${units.join(', ')}); its daily rows don't say ` +
        `which unit drove them, so export the report for one unit at a time`,
    );
  }
  if (months.size === 0) {
    throw new ConversionError(`${file.name}: no daily rows ("Date,State,Driver,Unit,Miles")`);
  }

  const trips: PeriodTrip[] = [...months.keys()].sort().map((key) => {
    const month = months.get(key)!;
    const legs: Leg[] = [...month.legs].map(([state, leg]) => ({
      state,
      begin: leg.begin,
      end: leg.end,
      distance: String(Math.round(exact(leg.miles))),
    }));
    return {
      period: null, // No period line: the trip runs from its first to its last day driven.
      reportedTotal: month.dayTotals === null ? null : exact(month.dayTotals),
      legs,
    };
  });

  // The daily rows and the unit's state totals are the same miles, split differently.
  const daily = new Map<string, number>();
  for (const month of months.values()) {
    for (const [state, leg] of month.legs) daily.set(state, (daily.get(state) ?? 0) + leg.miles);
  }
  const off = [...new Set([...unitStates.keys(), ...daily.keys()])].filter(
    (state) => Math.abs(exact(unitStates.get(state) ?? 0) - exact(daily.get(state) ?? 0)) > 0.05,
  );
  if (off.length > 0) {
    const detail = off
      .map((s) => `${s} ${exact(unitStates.get(s) ?? 0)} vs ${exact(daily.get(s) ?? 0)}`)
      .join(', ');
    warnings.push(
      `${file.name}: the unit's state totals and the daily rows disagree (${detail}); ` +
        `ProMiles gets the daily rows`,
    );
  }

  return {
    trips,
    distanceUnit: distanceUnit ?? 'M',
    detectedUnit: units[0],
    detectedCompany: null,
  };
}

export const ezlogzImporter: Importer = {
  id: 'ezlogz',
  detect: (file) => /\.csv$/i.test(file.name) && detectEzlogz(file.bytes),
  read: readEzlogz,
};
