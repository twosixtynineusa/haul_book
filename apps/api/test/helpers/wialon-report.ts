import * as fs from 'node:fs';
import * as path from 'node:path';
import type { UploadedFile } from '../../src/conversion/common';

export const FIXTURES = path.resolve(__dirname, '..', 'fixtures');
export const RAW_NAME = '22_IFTA_Single_Unit_Mileage_Report_11-06-2026_05-16-23_pm.csv';

export function fixture(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURES, name));
}

/** A sample Wialon export for unit 22, October 2026: made-up trips in the exact raw format and file name Wialon uses. */
export const RAW: UploadedFile = { name: RAW_NAME, bytes: fixture(RAW_NAME) };

/** Builds a report in Wialon's exact shape: `;`-delimited, quoted, CRLF, trailing `;`. */
export function wialonReport(rows: string[][], unit = '7'): UploadedFile {
  const header = ['№', 'Grouping', 'Mileage', 'Time in', 'Time out', 'Total time'];
  const line = (cells: string[]) => cells.map((c) => `"${c}"`).join(';') + ';';
  return {
    name: `${unit}_IFTA_Single_Unit_Mileage_Report_12-01-2026_08-00-00_am.csv`,
    bytes: Buffer.from([header, ...rows].map(line).join('\r\n') + '\r\n', 'latin1'),
  };
}

const row = (no: string, grouping: string, mi: string, from: string, to: string) => [
  no,
  grouping,
  mi,
  from,
  to,
  '',
];
export const month = row;
export const state = (no: string, name: string, mi: string, from: string, to = from) =>
  row(no, name, mi, from, to);
export const crossing = (no: string, at: string, mi: string) => row(no, at, mi, at, at);
export const total = (mi: string, from: string, to: string) => row('----', 'Total', mi, from, to);
