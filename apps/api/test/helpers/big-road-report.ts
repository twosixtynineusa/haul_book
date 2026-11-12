import type { UploadedFile } from '../../src/conversion/common';
import { xlsFile, type Cell } from './xls-writer';

/** Fictional Big Road layout, including fleet totals and optional diagnostic Exceptions. */
export function bigRoadReport({
  headers = ['Truck', 'OR', 'WA', 'Total (mi)'],
  rows = [['007', 120.5, 230.4, 350.9]],
  exceptions = [],
}: { headers?: string[]; rows?: Cell[][]; exceptions?: Cell[][] } = {}): UploadedFile {
  const totalIndex = headers.indexOf('Total (mi)');
  const totals = headers.map((_, i) =>
    i === 0 ? 'Total' : rows.reduce((sum, r) => sum + Number(r[i] ?? 0), 0),
  );
  return {
    name: 'Vehicle Mileage (Nov 7, 2026).xls',
    bytes: xlsFile([
      {
        name: 'Summary',
        rows: [
          ['Truck', 'Mileage (mi)', 'Exceptions'],
          ...rows.map((r) => [r[0], r[totalIndex], exceptions.length]),
          ['Total', totals[totalIndex], exceptions.length],
        ],
      },
      { name: 'Vehicle Mileage', rows: [headers, ...rows, totals] },
      ...(exceptions.length
        ? [
            {
              name: 'Exceptions',
              rows: [['Truck', 'Start date', 'End date', 'Message'], ...exceptions],
            },
          ]
        : []),
    ]),
  };
}
