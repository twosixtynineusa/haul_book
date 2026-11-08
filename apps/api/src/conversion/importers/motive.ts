import { parse } from 'csv-parse/sync';
import {
  ConversionError,
  decodeText,
  parseDistance,
  stateCode,
  tryParseDate,
  type DistanceUnit,
  type Leg,
  type PeriodTrip,
  type ReportTruck,
  type SourceReport,
} from '../common';
import type { Importer } from './types';

/**
 * Motive "IFTA Trip Report" detail CSV (docs/data-contracts.md §5), e.g.
 * `1794000000-trip_reports_detail_by_vehicle.csv`. One row per state segment, newest first,
 * each vehicle's rows in a block of their own:
 *
 *     Date,Vehicle,Jurisdiction,Distance (mi),Odometer Start,Odometer End,Manual Odo Edit,
 *       Latitude Start,Longitude Start,Latitude End,Longitude End
 *     "Oct 31, 2026",Volvo 7,Texas,120.53,"431,452","431,572",No,32.77,-96.79,33.21,-97.13
 *     …
 *
 * Comma-separated, LF, no BOM; full state names; odometers in whole miles with thousands
 * separators. No company in the file. The unit # is the Vehicle; a file may hold several
 * vehicles, each converted as its own truck. Each vehicle's rows (ordered by odometer) make
 * one trip per month, with one leg per state from its first to its last day that month, in
 * order of first entry. Legs get whole miles (half up); the exact sum is the report's total.
 * The month's first Odometer Start and last Odometer End are the trip's own odometer.
 *
 * Motive's "distance summary by vehicle" CSV has no dates, so it can't become a trip: it's
 * recognised only to say which report to export instead.
 */

const DETAIL_RE =
  /^date,vehicle,jurisdiction,distance \((mi|km)\),odometer start,odometer end(,|$)/;
const SUMMARY_RE = /^vehicle,jurisdiction,distance \((mi|km)\)(,|$)/;
/** Odometer jumps up to this many miles between rows are rounding; beyond, miles went unlogged. */
const ODO_GAP = 10;

// prettier-ignore
const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MOTIVE_DATE_RE = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})$/i;

function headerKey(line: string): string {
  return line
    .replace(/^\uFEFF/, '')
    .split(',')
    .map((c) => c.trim().replace(/^"|"$/g, '').toLowerCase())
    .join(',');
}

/** `Oct 31, 2026` (Motive's own), or the ISO / US dates every importer takes. */
function motiveDate(value: string, where: string): Date {
  const m = MOTIVE_DATE_RE.exec(value.trim());
  if (m) {
    const month = MONTH_ABBR.indexOf(m[1].toLowerCase());
    const date = new Date(Date.UTC(Number(m[3]), month, Number(m[2])));
    if (month >= 0 && date.getUTCDate() === Number(m[2])) return date;
  } else {
    const date = tryParseDate(value);
    if (date)
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }
  throw new ConversionError(`${where}: unrecognised date "${value}"`);
}

/** `"1,173,671"` → 1173671; blank → null (Motive leaves it out when it has no reading). */
function odometer(value: string, where: string): number | null {
  const v = value.trim().replace(/,/g, '');
  if (!v) return null;
  if (!/^\d+(\.\d+)?$/.test(v))
    throw new ConversionError(`${where}: unrecognised odometer "${value}"`);
  return Number(v);
}

/** To 2 decimals, so float sums like 388.49999999 still round half up as 388.5. */
function exact(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmtMiles(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

function fmtDay(d: Date): string {
  return `${MONTH_ABBR[d.getUTCMonth()].replace(/^./, (c) => c.toUpperCase())} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export function detectMotive(bytes: Buffer): 'detail' | 'summary' | null {
  const text = decodeText(bytes.subarray(0, 1024));
  const key = headerKey(text.split(/\r?\n/)[0] ?? '');
  if (DETAIL_RE.test(key)) return 'detail';
  if (SUMMARY_RE.test(key)) return 'summary';
  return null;
}

interface Row {
  index: number;
  date: Date;
  state: string;
  miles: number;
  odoStart: number | null;
  odoEnd: number | null;
  manual: boolean;
}

/** Chronological: by date, then odometer; rows of one day come newest first in the file. */
function chronological(a: Row, b: Row): number {
  const byDate = a.date.getTime() - b.date.getTime();
  if (byDate !== 0) return byDate;
  if (a.odoStart !== null && b.odoStart !== null && a.odoStart !== b.odoStart) {
    return a.odoStart - b.odoStart;
  }
  return b.index - a.index;
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function tripsOf(rows: Row[]): PeriodTrip[] {
  const months = new Map<string, Row[]>();
  for (const row of rows) {
    const key = monthKey(row.date);
    months.set(key, [...(months.get(key) ?? []), row]);
  }
  return [...months.keys()].sort().map((key) => {
    const month = months.get(key)!;
    const legs = new Map<string, { begin: Date; end: Date; miles: number }>();
    for (const row of month) {
      const leg = legs.get(row.state);
      if (leg) {
        leg.miles += row.miles;
        leg.end = row.date;
      } else {
        legs.set(row.state, { begin: row.date, end: row.date, miles: row.miles });
      }
    }
    const first = month[0].odoStart;
    const last = month[month.length - 1].odoEnd;
    return {
      period: null, // No period line: the trip runs from its first to its last day driven.
      reportedTotal: exact(month.reduce((sum, row) => sum + row.miles, 0)),
      legs: [...legs].map(([state, leg]): Leg => ({
        state,
        begin: leg.begin,
        end: leg.end,
        distance: String(Math.round(exact(leg.miles))),
      })),
      odometer:
        first !== null && last !== null && last >= first ? { begin: first, end: last } : null,
    };
  });
}

/** Odometer jumps between consecutive rows that no state row accounts for. */
function odometerWarnings(file: string, unit: string, rows: Row[], warnings: string[]): void {
  const gaps: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const [prev, next] = [rows[i - 1], rows[i]];
    if (prev.odoEnd === null || next.odoStart === null) continue;
    const jump = next.odoStart - prev.odoEnd;
    if (Math.abs(jump) > ODO_GAP) {
      gaps.push(
        `${jump > 0 ? '+' : ''}${fmtMiles(jump)} mi between ${fmtDay(prev.date)} and ` +
          `${fmtDay(next.date)} (${fmtMiles(prev.odoEnd)} → ${fmtMiles(next.odoStart)})`,
      );
    }
  }
  if (gaps.length > 0) {
    warnings.push(
      `${file}: ${unit}: the odometer moves with no state row for ${gaps.join('; ')}. Those ` +
        `miles are in no state; check the ELD before filing`,
    );
  }
  const manual = [...new Set(rows.filter((r) => r.manual).map((r) => fmtDay(r.date)))];
  if (manual.length > 0) {
    warnings.push(`${file}: ${unit}: the odometer was edited by hand on ${manual.join(', ')}`);
  }
}

export function readMotive(
  file: { name: string; bytes: Buffer },
  warnings: string[],
): SourceReport {
  const kind = detectMotive(file.bytes);
  if (kind === 'summary') {
    throw new ConversionError(
      `${file.name}: this is Motive's distance summary, which has no dates, so it can't become ` +
        `ProMiles trips. In Motive, export the IFTA trip report detail by vehicle ` +
        `(…trip_reports_detail_by_vehicle.csv) instead`,
    );
  }
  if (kind !== 'detail') throw new ConversionError(`${file.name}: not a Motive IFTA trip report`);

  const records: string[][] = parse(decodeText(file.bytes).replace(/^\uFEFF/, ''), {
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
    trim: true,
  });
  const header = records[0].map((h) => h.toLowerCase());
  const col = (name: string) => header.findIndex((h) => h.startsWith(name));
  const [cDate, cVehicle, cState, cMiles, cStart, cEnd, cManual] = [
    'date',
    'vehicle',
    'jurisdiction',
    'distance',
    'odometer start',
    'odometer end',
    'manual odo edit',
  ].map(col);
  const distanceUnit: DistanceUnit = header[cMiles].includes('(km)') ? 'K' : 'M';

  const byVehicle = new Map<string, Row[]>();
  for (const [i, cells] of records.entries()) {
    if (i === 0 || cells.every((c) => !c)) continue;
    const where = `${file.name}:${i + 1}`;
    const unit = cells[cVehicle] ?? '';
    if (!unit) throw new ConversionError(`${where}: no Vehicle`);
    const state = stateCode(cells[cState] ?? '');
    if (!state) {
      throw new ConversionError(`${where}: unknown state/province "${cells[cState] ?? ''}"`);
    }
    const [miles] = parseDistance(cells[cMiles] ?? '', where);
    const rows = byVehicle.get(unit) ?? [];
    byVehicle.set(unit, rows);
    rows.push({
      index: i,
      date: motiveDate(cells[cDate] ?? '', where),
      state,
      miles: Number(miles),
      odoStart: cStart >= 0 ? odometer(cells[cStart] ?? '', where) : null,
      odoEnd: cEnd >= 0 ? odometer(cells[cEnd] ?? '', where) : null,
      manual: cManual >= 0 && /^y(es)?$/i.test(cells[cManual] ?? ''),
    });
  }
  if (byVehicle.size === 0) throw new ConversionError(`${file.name}: no trip rows`);

  const trucks: ReportTruck[] = [...byVehicle].map(([unit, rows]) => {
    rows.sort(chronological);
    odometerWarnings(file.name, unit, rows, warnings);
    return { unit, trips: tripsOf(rows) };
  });

  if (trucks.length === 1) {
    return {
      trips: trucks[0].trips,
      distanceUnit,
      detectedUnit: trucks[0].unit,
      detectedCompany: null,
    };
  }
  return { trips: [], distanceUnit, detectedUnit: null, detectedCompany: null, trucks };
}

export const motiveImporter: Importer = {
  id: 'motive',
  detect: (file) => /\.csv$/i.test(file.name) && detectMotive(file.bytes) !== null,
  read: readMotive,
};
