import {
  ConversionError,
  parseDistance,
  stateCode,
  type Leg,
  type ReportTruck,
  type SourceReport,
} from '../common';
import { XlsError, isOle2, readXls, type XlsCell, type XlsSheet } from '../xls';
import type { Importer } from './types';

/**
 * "IFTA Report" Excel workbook (docs/data-contracts.md §6), e.g. `IFTA_Report.xls`: legacy
 * Excel 97–2003 (BIFF8), two sheets. Swift ELD and Vista ELD both export this layout.
 *
 *   IFTA Spreadsheet — per-state tax summary for all trucks (fuel columns empty): not read.
 *   All trucks       — the per-truck miles read here:
 *
 *       (row 2)  B: "Oct 01, 2026 - Oct 31, 2026"     D: "Company Name: ACME TRUCKING LLC"
 *       (row 3)  B: "IFTA by Vehicles: 22"            D: "Address: …"
 *       (row 7)  Truck | State/Province | Total Miles [| Total Kilometers]
 *                22    | AR             | 72.49
 *                …
 *                22    | TOTAL          | 18970.41
 *
 * The company is the "Company Name:" cell; each Truck value is a unit # (a file may hold
 * several trucks, each converted as its own truck). The period becomes one trip per truck
 * (the export has no per-month split), with one leg per state in file order. Miles come with
 * decimals; ProMiles gets whole miles (half up), and each truck's TOTAL row is kept as the
 * report's own total.
 */

const SHEET = 'all trucks';
const MONTH = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY = String.raw`([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),\s*(\d{4})`;
const PERIOD_RE = new RegExp(`^${DAY}\\s*-\\s*${DAY}$`);
const COMPANY_RE = /^company name\s*:\s*(.*)$/i;

const text = (cell: XlsCell | undefined) =>
  cell === null || cell === undefined ? '' : String(cell).trim();

/** To 2 decimals, so float sums like 388.49999999 still round half up as 388.5. */
function exact(n: number): number {
  return Math.round(n * 100) / 100;
}

function day(mon: string, d: string, y: string, where: string): Date {
  const month = MONTH.indexOf(mon.toLowerCase());
  const date = new Date(Date.UTC(Number(y), month, Number(d)));
  if (month < 0 || date.getUTCDate() !== Number(d)) {
    throw new ConversionError(`${where}: unrecognised date "${mon} ${d}, ${y}"`);
  }
  return date;
}

/** The "All trucks" sheet and the row its Truck / State/Province / Total Miles header is on. */
function layout(sheets: XlsSheet[]): { sheet: XlsSheet; header: number } | null {
  const sheet = sheets.find((s) => s.name.trim().toLowerCase() === SHEET);
  if (!sheet) return null;
  const header = sheet.rows.findIndex(
    (r) =>
      text(r[0]).toLowerCase() === 'truck' &&
      text(r[1]).toLowerCase() === 'state/province' &&
      text(r[2]).toLowerCase() === 'total miles',
  );
  return header < 0 ? null : { sheet, header };
}

export function detectIftaSpreadsheet(file: { name: string; bytes: Buffer }): boolean {
  if (!/\.xls$/i.test(file.name) || !isOle2(file.bytes)) return false;
  try {
    return layout(readXls(file.bytes)) !== null;
  } catch {
    return false;
  }
}

export function readIftaSpreadsheet(
  file: { name: string; bytes: Buffer },
  warnings: string[],
): SourceReport {
  let sheets: XlsSheet[];
  try {
    sheets = readXls(file.bytes);
  } catch (e) {
    if (!(e instanceof XlsError)) throw e;
    throw new ConversionError(
      `${file.name}: can't be read (${e.message}). Export the IFTA report again as .xls`,
    );
  }
  const found = layout(sheets);
  if (!found) {
    throw new ConversionError(
      `${file.name}: no "All trucks" sheet with Truck, State/Province and Total Miles columns`,
    );
  }
  const { sheet, header } = found;
  const where = (row: number) => `${file.name}: ${sheet.name} row ${row + 1}`;

  let company: string | null = null;
  let period: [Date, Date] | null = null;
  for (const [i, row] of sheet.rows.slice(0, header).entries()) {
    for (const cell of row.map(text)) {
      const c = COMPANY_RE.exec(cell);
      if (c) company = c[1].trim() || null;
      const p = PERIOD_RE.exec(cell);
      if (p) period = [day(p[1], p[2], p[3], where(i)), day(p[4], p[5], p[6], where(i))];
    }
  }
  if (!period) {
    throw new ConversionError(`${file.name}: no period like "Oct 01, 2026 - Oct 31, 2026"`);
  }
  if (period[1] < period[0]) {
    throw new ConversionError(`${file.name}: the period ends before it starts`);
  }

  /** Truck → its state miles (exact) in file order, and its TOTAL row. */
  const trucks = new Map<string, { states: Map<string, number>; total: number | null }>();
  for (let i = header + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i];
    const [unit, state] = [text(row[0]), text(row[1])];
    if (!unit && !state) continue;
    if (!unit) throw new ConversionError(`${where(i)}: no Truck`);
    const [miles] = parseDistance(text(row[2]), where(i));
    const truck = trucks.get(unit) ?? { states: new Map<string, number>(), total: null };
    trucks.set(unit, truck);
    if (state.toUpperCase() === 'TOTAL') {
      truck.total = Number(miles);
      continue;
    }
    const code = stateCode(state);
    if (!code) throw new ConversionError(`${where(i)}: unknown state/province "${state}"`);
    if (truck.states.has(code)) throw new ConversionError(`${where(i)}: ${code} appears twice`);
    truck.states.set(code, Number(miles));
  }
  const withMiles = [...trucks].filter(([, t]) => t.states.size > 0);
  if (withMiles.length === 0) throw new ConversionError(`${file.name}: no state mileage rows`);

  const [from, to] = period;
  if (from.getUTCFullYear() !== to.getUTCFullYear() || from.getUTCMonth() !== to.getUTCMonth()) {
    warnings.push(
      `${file.name}: covers more than one month; ProMiles gets one trip for the whole period ` +
        `(this export has no per-month split)`,
    );
  }

  const reportTrucks: ReportTruck[] = withMiles.map(([unit, { states, total }]) => ({
    unit,
    trips: [
      {
        period: period!,
        reportedTotal: exact(total ?? [...states.values()].reduce((a, b) => a + b, 0)),
        // No per-state dates in this export: every leg spans the period, kept in file order.
        legs: [...states].map(([state, miles]): Leg => ({
          state,
          begin: from,
          end: to,
          distance: String(Math.round(exact(miles))),
        })),
      },
    ],
  }));

  if (reportTrucks.length === 1) {
    return {
      trips: reportTrucks[0].trips,
      distanceUnit: 'M',
      detectedUnit: reportTrucks[0].unit,
      detectedCompany: company,
    };
  }
  return {
    trips: [],
    distanceUnit: 'M',
    detectedUnit: null,
    detectedCompany: company,
    trucks: reportTrucks,
  };
}

function iftaSpreadsheet(id: 'swift' | 'vista-eld'): Importer {
  return { id, detect: detectIftaSpreadsheet, read: readIftaSpreadsheet };
}

/** Two providers, one layout: both detect the same files (the company's source or the user decides). */
export const swiftImporter = iftaSpreadsheet('swift');
export const vistaEldImporter = iftaSpreadsheet('vista-eld');
