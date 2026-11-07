import { parse } from 'csv-parse/sync';
import {
  ConversionError,
  MONTHS,
  decodeText,
  parseDate,
  parseDistance,
  stateCode,
  sumLegs,
  totalsDisagree,
  tryParseDate,
  type DistanceUnit,
  type PeriodTrip,
  type SourceReport,
  type UploadedFile,
} from '../common';
import type { Importer } from './types';

/**
 * Wialon "IFTA Single Unit Mileage Report" CSV export (docs/data-contracts.md §1),
 * e.g. `22_IFTA_Single_Unit_Mileage_Report_11-06-2026_05-16-23_pm.csv`:
 *   - semicolon-delimited, quoted, Windows codepage (the `№` header), CRLF;
 *   - the unit # is ONLY in the file name (`<unit>_IFTA_Single_Unit_Mileage_Report_…`);
 *     there is no company name anywhere, so the user always picks one;
 *   - rows form a numbered hierarchy:
 *       "1";"October";"3619 mi";"2026-10-01 00:00:12";"2026-10-31 23:58:47";…    month group
 *       "1.1";"Arkansas";"274 mi";"2026-10-20 15:40:03";"2026-10-27 09:30:54";…  state total
 *       "1.1.1";"2026-10-20 15:40:03";"151 mi";…                                one crossing (skipped)
 *       "----";"Total";"3619 mi";…                                              grand total
 *
 * Each month group becomes one trip whose legs are the state totals. A report
 * without month grouping becomes a single trip spanning the grand total's dates.
 */

/** Columns 2–5 of the header (column 1 is `№`, whose byte varies by codepage). */
const REPORT_HEADER = ['grouping', 'mileage', 'time in', 'time out'];
const REPORT_NAME_RE = /^(.+?)[ _-]+IFTA[ _-]+Single[ _-]+Unit[ _-]+Mileage[ _-]+Report/i;
const ROW_NUMBER_RE = /^\d+(\.\d+)*$/;

/** `22_IFTA_Single_Unit_Mileage_Report_11-06-2026_05-16-23_pm.csv` → `22`. */
export function unitFromFileName(name: string): string | null {
  const base = name.split(/[\\/]/).pop() ?? name;
  return REPORT_NAME_RE.exec(base)?.[1].trim() || null;
}

function headerMatches(firstLine: string): boolean {
  const cells = firstLine.split(';').map((c) => c.trim().replace(/^"|"$/g, '').toLowerCase());
  return cells.slice(1, 5).join('|') === REPORT_HEADER.join('|');
}

function read(file: UploadedFile, warnings: string[]): SourceReport {
  let rows: string[][];
  try {
    rows = parse(decodeText(file.bytes), {
      bom: true,
      delimiter: ';',
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
    });
  } catch (e) {
    throw new ConversionError(`${file.name}: not a readable CSV file (${(e as Error).message})`);
  }

  const header = rows[0]?.slice(1, 5).map((h) => h.trim().toLowerCase());
  if (!header || header.join('|') !== REPORT_HEADER.join('|')) {
    throw new ConversionError(
      `${file.name}: not a Wialon IFTA Single Unit Mileage Report ` +
        `(expected the columns №;Grouping;Mileage;Time in;Time out)`,
    );
  }

  const trips: PeriodTrip[] = [];
  let current: PeriodTrip | null = null;
  let grandTotal: { period: [Date, Date]; total: number } | null = null;
  let distanceUnit: DistanceUnit | null = null;

  for (const [i, row] of rows.slice(1).entries()) {
    const [no = '', grouping = '', mileage = '', timeIn = '', timeOut = ''] = row.map((c) =>
      c.trim(),
    );
    if (!no && !grouping) continue;
    const where = `${file.name}:${i + 2}`;

    const [number, unitOfDistance] = parseDistance(mileage, where);
    if (unitOfDistance) {
      if (distanceUnit && distanceUnit !== unitOfDistance) {
        throw new ConversionError(`${where}: the report mixes miles and kilometres`);
      }
      distanceUnit = unitOfDistance;
    }

    if (!ROW_NUMBER_RE.test(no)) {
      if (grouping.toLowerCase() === 'total') {
        grandTotal = {
          period: [parseDate(timeIn, where), parseDate(timeOut, where)],
          total: Number(number),
        };
      }
      continue;
    }

    const depth = no.split('.').length;
    if (depth === 1 && MONTHS.has(grouping.split(/\s+/)[0].toLowerCase())) {
      current = {
        period: [parseDate(timeIn, where), parseDate(timeOut, where)],
        reportedTotal: Number(number),
        legs: [],
      };
      trips.push(current);
      continue;
    }

    // Individual border crossings ("1.1.1";"2026-10-20 15:40:03";…) — the
    // state row above them already carries their total.
    if (tryParseDate(grouping)) continue;

    const code = stateCode(grouping);
    if (!code) throw new ConversionError(`${where}: unknown state/province "${grouping}"`);
    if (!current) {
      current = { period: null, reportedTotal: null, legs: [] };
      trips.push(current);
    }
    if (current.legs.some((leg) => leg.state === code)) {
      throw new ConversionError(`${where}: ${code} appears twice in the same period`);
    }
    current.legs.push({
      state: code,
      begin: parseDate(timeIn, where),
      end: parseDate(timeOut, where),
      distance: number,
    });
  }

  for (const trip of trips) {
    if (trip.period) continue;
    // Not grouped by month: one trip spanning the whole report.
    if (grandTotal) {
      trip.period = grandTotal.period;
      trip.reportedTotal = grandTotal.total;
    } else {
      warnings.push(`${file.name}: no Total row; trip dates use the earliest/latest state dates`);
    }
  }
  if (grandTotal && trips.length > 1) {
    const reported = trips.reduce((s, t) => s + (t.reportedTotal ?? sumLegs(t.legs)), 0);
    if (totalsDisagree(reported, grandTotal.total)) {
      warnings.push(
        `${file.name}: months add up to ${reported} but the Total row says ${grandTotal.total}`,
      );
    }
  }

  return {
    trips,
    distanceUnit: distanceUnit ?? 'M',
    detectedUnit: unitFromFileName(file.name),
    detectedCompany: null,
  };
}

export const wialonImporter: Importer = {
  id: 'wialon',
  detect(file) {
    if (!/\.csv$/i.test(file.name)) return false;
    const head = decodeText(file.bytes.subarray(0, 512)).replace(/^\uFEFF/, '');
    return headerMatches(head.split(/\r?\n/)[0] ?? '');
  },
  read,
};
