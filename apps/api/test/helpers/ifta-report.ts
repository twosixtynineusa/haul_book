import type { UploadedFile } from '../../src/conversion/common';
import { xlsFile, type Cell } from './xls-writer';

/** A truck's state rows: [state, miles]. */
export type TruckMiles = [unit: string, states: [state: string, miles: number][]];

const KM = 1.609344;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A made-up Swift ELD / Vista ELD "IFTA Report" workbook, laid out cell for cell like the
 * real exports (docs/data-contracts.md §6): an "IFTA Spreadsheet" tax summary sheet and the
 * "All trucks" sheet the importer reads. Company, address and miles are fictional.
 */
export function iftaReport({
  trucks,
  company = 'ACME TRUCKING LLC',
  period = 'Oct 01, 2026 - Oct 31, 2026',
  kilometres = false,
  name = 'IFTA_Report.xls',
}: {
  trucks: TruckMiles[];
  company?: string;
  period?: string;
  /** Newer exports add a Total Kilometers column. */
  kilometres?: boolean;
  name?: string;
}): UploadedFile {
  const km = (miles: number): Cell[] => (kilometres ? [round2(miles * KM)] : []);
  const head = (gap: number): Cell[][] => [
    [],
    [null, period, ...Array<Cell>(gap).fill(null), `Company Name: ${company}`],
    [
      null,
      `IFTA by Vehicles: ${trucks.map(([unit]) => unit).join(', ')}`,
      ...Array<Cell>(gap).fill(null),
      'Address: 100 Main St, Springfield Texas USA, 75001',
    ],
    [null, null, ...Array<Cell>(gap).fill(null), 'Phone: 5550100'],
    [],
    [],
  ];

  const byState = new Map<string, number>();
  for (const [, states] of trucks) {
    for (const [state, miles] of states) byState.set(state, (byState.get(state) ?? 0) + miles);
  }
  const overall = round2([...byState.values()].reduce((a, b) => a + b, 0));
  const summary: Cell[][] = [
    ...head(2),
    ['Diesel'],
    [
      'Jurisdiction',
      'Total Miles',
      ...(kilometres ? ['Total Kilometers'] : []),
      'Taxable Gallons Consumed',
      'Tax Paid Gallon Purchases',
      'NET Taxable Gallons',
      'Tax Rate',
      'Tax Due / Credit Earned',
    ],
    ...[...byState].map(([state, miles]): Cell[] => [
      state,
      round2(miles),
      ...km(miles),
      0,
      0,
      0,
      0,
      0,
    ]),
    ['TOTAL', overall, ...km(overall), 'TOTAL', 0],
    [],
    ['Surcharge'],
    ['Diesel'],
    ['Jurisdiction', 'Total Miles', 'Taxable Gallons Consumed', 'Surcharge Tax Rate', 'Tax Due'],
    [null, null, null, 'TOTAL', 0],
    [],
    [],
    [],
    [null, null, 'OVERALL TOTAL', 0],
  ];

  const allTrucks: Cell[][] = [
    ...head(1),
    ['Truck', 'State/Province', 'Total Miles', ...(kilometres ? ['Total Kilometers'] : [])],
    ...trucks.flatMap(([unit, states]): Cell[][] => {
      const total = round2(states.reduce((sum, [, miles]) => sum + miles, 0));
      return [
        ...states.map(([state, miles]): Cell[] => [unit, state, miles, ...km(miles)]),
        [unit, 'TOTAL', total, ...km(total)],
      ];
    }),
  ];

  return {
    name,
    bytes: xlsFile([
      { name: 'IFTA Spreadsheet', rows: summary },
      { name: 'All trucks', rows: allTrucks },
    ]),
  };
}

/** The sample: unit 0412 (a leading zero, kept), October 2026, four states. */
export const IFTA_REPORT_SAMPLE: TruckMiles[] = [
  [
    '0412',
    [
      ['AR', 72.49],
      ['MO', 1762.63],
      ['OK', 388.5],
      ['TX', 1204.55],
    ],
  ],
];
