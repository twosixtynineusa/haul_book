import {
  RAW,
  RAW_NAME,
  crossing,
  month,
  state,
  total,
  wialonReport,
} from '../../../test/helpers/wialon-report';
import { ConversionError, decodeText, type UploadedFile } from '../common';
import { detectFormat } from '.';
import { unitFromFileName, wialonImporter } from './wialon';

const read = (file: UploadedFile, warnings: string[] = []) => wialonImporter.read(file, warnings);

describe('Wialon importer — the sample export (unit 22, October 2026)', () => {
  const report = read(RAW);

  it('is auto-detected from its header, whatever the codepage', () => {
    expect(detectFormat(RAW)).toBe('wialon');
    expect(decodeText(RAW.bytes).split('\r\n')[0]).toMatch(/^".";"Grouping";"Mileage"/);
  });

  it('takes the unit # from the file name; the report has no company name', () => {
    expect(report.detectedUnit).toBe('22');
    expect(report.detectedCompany).toBeNull();
  });

  it('reads one month with the 10 state totals, skipping the crossing rows', () => {
    expect(report.distanceUnit).toBe('M');
    expect(report.trips).toHaveLength(1);
    const [trip] = report.trips;
    expect(trip.reportedTotal).toBe(3619);
    expect(trip.legs).toHaveLength(10);
    expect(trip.legs.find((l) => l.state === 'TN')?.distance).toBe('389'); // crossings: 389.34
  });
});

describe('Wialon importer — variations', () => {
  it.each([
    [RAW_NAME, '22'],
    ['29-LB_IFTA_Single_Unit_Mileage_Report_11-06-2026_05-16-23_pm (1).csv', '29-LB'],
    ['C:\\fakepath\\65-GOLDEN_IFTA_Single_Unit_Mileage_Report_x.csv', '65-GOLDEN'],
    ['1236554.csv', null],
  ])('unit from %s → %s', (name, unit) => {
    expect(unitFromFileName(name)).toBe(unit);
  });

  it('still reads a renamed file — the unit # is just not detected', () => {
    const report = read({ ...RAW, name: 'october.csv' });
    expect(report.detectedUnit).toBeNull();
    expect(report.trips[0].legs).toHaveLength(10);
  });

  it('makes one trip per month of a multi-month report', () => {
    const report = read(
      wialonReport([
        month('1', 'October', '300 mi', '2026-10-01 00:00:00', '2026-10-31 23:59:59'),
        state('1.1', 'Texas', '200 mi', '2026-10-02 08:00:00'),
        crossing('1.1.1', '2026-10-02 08:00:00', '200 mi'),
        state('1.2', 'Oklahoma', '100 mi', '2026-10-05 08:00:00'),
        month('2', 'November', '50 mi', '2026-11-01 00:00:00', '2026-11-30 23:59:59'),
        state('2.1', 'Texas', '50 mi', '2026-11-03 08:00:00'),
        total('350 mi', '2026-10-01 00:00:00', '2026-11-30 23:59:59'),
      ]),
    );
    expect(report.trips.map((t) => t.legs.map((l) => `${l.state}:${l.distance}`))).toEqual([
      ['TX:200', 'OK:100'],
      ['TX:50'],
    ]);
  });

  it('uses the Total row for a report that is not grouped by month', () => {
    const [trip] = read(
      wialonReport([
        state('1', 'Utah', '42.50 mi', '2026-10-02 06:00:00'),
        total('42.5 mi', '2026-10-01 00:00:00', '2026-10-31 23:59:59'),
      ]),
    ).trips;
    expect(trip.period?.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-10-01',
      '2026-10-31',
    ]);
    expect(trip.legs[0].distance).toBe('42.5');
  });

  it('warns when months and the Total row disagree, or there is no Total row', () => {
    const warnings: string[] = [];
    read(
      wialonReport([
        month('1', 'October', '1000 mi', '2026-10-01 00:00:00', '2026-10-31 23:59:59'),
        state('1.1', 'Texas', '1000 mi', '2026-10-03 00:00:00'),
        month('2', 'November', '10 mi', '2026-11-01 00:00:00', '2026-11-30 23:59:59'),
        state('2.1', 'Texas', '10 mi', '2026-11-03 00:00:00'),
        total('5000 mi', '2026-10-01 00:00:00', '2026-11-30 23:59:59'),
      ]),
      warnings,
    );
    read(wialonReport([state('1', 'Iowa', '1,234 mi', '2026-10-04 08:00:00')]), warnings);
    expect(warnings).toEqual([
      expect.stringContaining('months add up to 1010 but the Total row says 5000'),
      expect.stringContaining('no Total row'),
    ]);
  });

  it('is not detected for other files', () => {
    expect(detectFormat({ name: 'a.csv', bytes: Buffer.from('Unit#,Begin Date\r\n') })).toBeNull();
    expect(detectFormat({ name: 'a.xlsx', bytes: Buffer.from('PK\u0003\u0004') })).toBeNull();
  });

  const oct = month('1', 'October', '1 mi', '2026-10-01 00:00:00', '2026-10-31 23:59:59');
  it.each<[string, UploadedFile, RegExp]>([
    [
      'the hand-edited comma format',
      { name: RAW_NAME, bytes: Buffer.from('Unit#,Begin Date,End date,State,Toll Distance\r\n') },
      /not a Wialon IFTA Single Unit Mileage Report/,
    ],
    [
      'an unknown state',
      wialonReport([oct, state('1.1', 'Atlantis', '1 mi', '2026-10-02')]),
      /Atlantis/,
    ],
    [
      'an impossible date',
      wialonReport([oct, state('1.1', 'Texas', '1 mi', '2026-13-45 00:00:00')]),
      /unrecognised date/,
    ],
    [
      'a bad distance',
      wialonReport([oct, state('1.1', 'Texas', 'ten mi', '2026-10-02')]),
      /unrecognised distance/,
    ],
    [
      'a state twice in one month',
      wialonReport([
        oct,
        state('1.1', 'Texas', '1 mi', '2026-10-02'),
        state('1.2', 'TX', '1 mi', '2026-10-03'),
      ]),
      /appears twice/,
    ],
    [
      'mixed miles and kilometres',
      wialonReport([oct, state('1.1', 'Texas', '1 km', '2026-10-02')]),
      /mixes miles and kilometres/,
    ],
  ])('rejects %s', (_label, file, message) => {
    expect(() => read(file)).toThrow(ConversionError);
    expect(() => read(file)).toThrow(message);
  });
});
