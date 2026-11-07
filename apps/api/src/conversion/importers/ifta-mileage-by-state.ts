import { parse } from 'csv-parse/sync';
import {
  ConversionError,
  decodeText,
  parseDistance,
  stateCode,
  type SourceReport,
} from '../common';
import type { Importer } from './types';

/**
 * "IFTA Mileage By State" CSV export (docs/data-contracts.md §3), one vehicle per file,
 * e.g. `Vehicle-7-123456-mileage-report_20261001-20261031_1794000000000.csv`:
 *
 *     IFTA Mileage By State
 *     Summary of total mileage by state for all equipment
 *     Carrier: ACME TRUCKING LLC
 *     Period: 2026/10/01 - 2026/10/31
 *     Report Generated: 2026/11/07 1:47:56 pm
 *     Vehicle,Name,Make,Model,Year
 *     1FAKEVIN0LJ123456,7,Freightliner,Cascadia,2019
 *     State,Miles
 *     TX,1204.55
 *     …
 *
 * Comma-separated, LF, no BOM. The company is the `Carrier:` line and the unit # the
 * vehicle's Name. The whole period becomes one trip (the export has no per-month
 * split), with one leg per state in file order. Miles come with decimals; ProMiles
 * gets whole miles (half up), and their exact sum is kept as the report's own total.
 *
 * Bellfam ELD and HOS247 both export this format.
 */

const TITLE = 'ifta mileage by state';
const PERIOD_RE =
  /^Period:\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s*-\s*(\d{4})\/(\d{1,2})\/(\d{1,2})\s*$/i;
const FILE_UNIT_RE = /^Vehicle-(.+?)-[^-]*-mileage-report/i;

/** `Vehicle-7-123456-mileage-report_…csv` → `7`. */
export function unitFromVehicleFileName(name: string): string | null {
  const base = name.split(/[\\/]/).pop() ?? name;
  return FILE_UNIT_RE.exec(base)?.[1].trim() || null;
}

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

function utcDate(y: string, m: string, d: string, where: string): Date {
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) {
    throw new ConversionError(`${where}: impossible date ${y}/${m}/${d}`);
  }
  return date;
}

export function detectIftaMileageByState(bytes: Buffer): boolean {
  const head = lines(decodeText(bytes.subarray(0, 2048)));
  return head[0]?.toLowerCase() === TITLE && head.some((l) => /^state\s*,\s*miles$/i.test(l));
}

export function readIftaMileageByState(
  file: { name: string; bytes: Buffer },
  warnings: string[],
): SourceReport {
  const all = lines(decodeText(file.bytes));
  if (all[0]?.toLowerCase() !== TITLE) {
    throw new ConversionError(`${file.name}: not an "IFTA Mileage By State" report`);
  }

  let company: string | null = null;
  let period: [Date, Date] | null = null;
  const vehicles: string[][] = [];
  const legs: SourceReport['trips'][number]['legs'] = [];
  let exact = 0;
  let section: 'head' | 'vehicles' | 'states' = 'head';

  for (const [i, line] of all.entries()) {
    const where = `${file.name}:${i + 1}`;
    if (!line) continue;
    if (/^carrier\s*:/i.test(line)) {
      company = line.replace(/^carrier\s*:/i, '').trim() || null;
      continue;
    }
    const p = PERIOD_RE.exec(line);
    if (p) {
      period = [utcDate(p[1], p[2], p[3], where), utcDate(p[4], p[5], p[6], where)];
      continue;
    }
    if (/^vehicle\s*,\s*name\b/i.test(line)) {
      section = 'vehicles';
      continue;
    }
    if (/^state\s*,\s*miles$/i.test(line)) {
      section = 'states';
      continue;
    }

    if (section === 'vehicles') {
      vehicles.push(cells(line));
    } else if (section === 'states') {
      const [state = '', miles = ''] = cells(line);
      const code = stateCode(state);
      if (!code) throw new ConversionError(`${where}: unknown state/province "${state}"`);
      if (legs.some((leg) => leg.state === code)) {
        throw new ConversionError(`${where}: ${code} appears twice`);
      }
      const [number] = parseDistance(miles, where);
      exact += Number(number);
      legs.push({ state: code, begin: new Date(0), end: new Date(0), distance: number });
    }
  }

  if (!period) {
    throw new ConversionError(`${file.name}: no "Period: YYYY/MM/DD - YYYY/MM/DD" line`);
  }
  if (period[1] < period[0])
    throw new ConversionError(`${file.name}: the period ends before it starts`);
  if (legs.length === 0) throw new ConversionError(`${file.name}: no state mileage rows`);

  // No per-state dates in this export: every leg spans the period, kept in file order.
  for (const leg of legs) {
    leg.begin = period[0];
    leg.end = period[1];
    leg.distance = String(Math.round(Number(leg.distance)));
  }
  const [from, to] = period;
  if (from.getUTCFullYear() !== to.getUTCFullYear() || from.getUTCMonth() !== to.getUTCMonth()) {
    warnings.push(
      `${file.name}: covers more than one month; ProMiles gets one trip for the whole period ` +
        `(this export has no per-month split)`,
    );
  }

  let unit = vehicles.length === 1 ? vehicles[0][1] || null : null;
  if (vehicles.length > 1) {
    warnings.push(
      `${file.name}: lists ${vehicles.length} vehicles; enter the unit # these miles belong to`,
    );
  } else if (!unit) {
    unit = unitFromVehicleFileName(file.name);
  }

  return {
    trips: [{ period, reportedTotal: Math.round(exact * 100) / 100, legs }],
    distanceUnit: 'M',
    detectedUnit: unit,
    detectedCompany: company,
  };
}

function iftaMileageByState(id: 'bellamsp-anir' | 'hos247'): Importer {
  return {
    id,
    detect: (file) => /\.csv$/i.test(file.name) && detectIftaMileageByState(file.bytes),
    read: readIftaMileageByState,
  };
}

/** Two providers, one layout: both detect the same files (the company's source or the user decides). */
export const bellamspAnirImporter = iftaMileageByState('bellamsp-anir');
export const hos247Importer = iftaMileageByState('hos247');
