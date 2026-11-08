import { IFTA_REPORT_SAMPLE, iftaReport } from '../../../test/helpers/ifta-report';
import { fixture } from '../../../test/helpers/wialon-report';
import { xlsFile } from '../../../test/helpers/xls-writer';
import { ConversionError, type UploadedFile } from '../common';
import { writeProMiles } from '../promiles';
import { detectFormats } from '.';
import { swiftImporter, vistaEldImporter } from './ifta-spreadsheet';

const SAMPLE = iftaReport({ trucks: IFTA_REPORT_SAMPLE });
const OCT_1 = new Date(Date.UTC(2026, 9, 1));
const OCT_31 = new Date(Date.UTC(2026, 9, 31));

const read = (file: UploadedFile, warnings: string[] = []) => swiftImporter.read(file, warnings);

describe('IFTA Report workbook (Swift ELD · Vista ELD)', () => {
  it('is recognised as Swift ELD or Vista ELD, which export the same layout', () => {
    expect(detectFormats(SAMPLE)).toEqual(['swift', 'vista-eld']);
    expect(vistaEldImporter.read(SAMPLE, [])).toEqual(read(SAMPLE));
  });

  it('reads the company, the unit # (leading zero kept) and one trip for the period', () => {
    const warnings: string[] = [];
    const r = read(SAMPLE, warnings);
    expect(r).toMatchObject({
      detectedCompany: 'ACME TRUCKING LLC',
      detectedUnit: '0412',
      distanceUnit: 'M',
    });
    expect(r.trucks).toBeUndefined();
    expect(r.trips).toEqual([
      {
        period: [OCT_1, OCT_31],
        reportedTotal: 3428.17, // the truck's TOTAL row
        legs: [
          { state: 'AR', begin: OCT_1, end: OCT_31, distance: '72' },
          { state: 'MO', begin: OCT_1, end: OCT_31, distance: '1763' },
          { state: 'OK', begin: OCT_1, end: OCT_31, distance: '389' }, // 388.5 rounds up
          { state: 'TX', begin: OCT_1, end: OCT_31, distance: '1205' },
        ],
      },
    ]);
    expect(warnings).toEqual([]);
  });

  it('matches the golden ProMiles file', () => {
    const r = read(SAMPLE);
    const { outputs, warnings } = writeProMiles([
      { company: 'ACME TRUCKING LLC', unit: '0412', sourceFile: SAMPLE.name, report: r },
    ]);
    expect(warnings).toEqual([]);
    expect(outputs[0].csv).toBe(
      fixture('promiles_expected_ifta_report_unit0412_oct2026.csv').toString('utf8'),
    );
  });

  it('reads the miles column when the export also has kilometres', () => {
    const r = read(iftaReport({ trucks: IFTA_REPORT_SAMPLE, kilometres: true }));
    expect(r.trips[0].legs.map((l) => l.distance)).toEqual(['72', '1763', '389', '1205']);
  });

  it('converts each truck of a file holding several on its own', () => {
    const r = read(
      iftaReport({
        trucks: [
          [
            '22',
            [
              ['TX', 100.4],
              ['OK', 50],
            ],
          ],
          ['31', [['WA', 10.5]]],
        ],
      }),
    );
    expect(r.detectedUnit).toBeNull();
    expect(
      r.trucks?.map((t) => [t.unit, t.trips[0].legs.map((l) => [l.state, l.distance])]),
    ).toEqual([
      [
        '22',
        [
          ['TX', '100'],
          ['OK', '50'],
        ],
      ],
      ['31', [['WA', '11']]],
    ]);
  });

  it('warns that a multi-month period becomes one trip', () => {
    const warnings: string[] = [];
    const r = read(
      iftaReport({ trucks: IFTA_REPORT_SAMPLE, period: 'Oct 01, 2026 - Dec 31, 2026' }),
      warnings,
    );
    expect(r.trips[0].period).toEqual([OCT_1, new Date(Date.UTC(2026, 11, 31))]);
    expect(warnings).toEqual([expect.stringMatching(/covers more than one month/)]);
  });

  it('is not detected for other files', () => {
    const csv = { name: 'IFTA_Report.xls', bytes: Buffer.from('State,Miles\nTX,1\n') };
    const otherSheet = { name: 'IFTA_Report.xls', bytes: xlsFile([{ name: 'Sheet1', rows: [] }]) };
    const renamed = { ...SAMPLE, name: 'IFTA_Report.csv' };
    for (const file of [csv, otherSheet, renamed]) expect(detectFormats(file)).toEqual([]);
  });

  it.each([
    [{ name: 'x.xls', bytes: Buffer.from('nope') }, /can't be read \(not an Excel 97–2003/],
    [
      { name: 'x.xls', bytes: xlsFile([{ name: 'Sheet1', rows: [['a']] }]) },
      /no "All trucks" sheet/,
    ],
    [iftaReport({ trucks: IFTA_REPORT_SAMPLE, period: 'October 2026' }), /no period like/],
    [iftaReport({ trucks: [['22', [['Narnia', 1]]]] }), /unknown state\/province "Narnia"/],
    [
      iftaReport({
        trucks: [
          [
            '22',
            [
              ['TX', 1],
              ['Texas', 2],
            ],
          ],
        ],
      }),
      /TX appears twice/,
    ],
    [iftaReport({ trucks: [] }), /no state mileage rows/],
    [
      iftaReport({ trucks: IFTA_REPORT_SAMPLE, period: 'Oct 31, 2026 - Oct 01, 2026' }),
      /ends before/,
    ],
    [
      iftaReport({ trucks: IFTA_REPORT_SAMPLE, period: 'Feb 30, 2026 - Mar 31, 2026' }),
      /"Feb 30, 2026"/,
    ],
  ])('refuses a broken file with a reason (%#)', (file, reason) => {
    expect(() => read(file)).toThrow(ConversionError);
    expect(() => read(file)).toThrow(reason);
  });
});
