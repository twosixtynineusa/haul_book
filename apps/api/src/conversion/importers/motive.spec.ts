import { truckKey } from '@haulbook/shared';
import { fixture } from '../../../test/helpers/wialon-report';
import { ConversionError, type SourceReport, type UploadedFile } from '../common';
import { writeProMiles, type TruckReport } from '../promiles';
import { detectFormats } from '.';
import { motiveImporter } from './motive';

/** A made-up export in the exact format (LF, final newline, the provider's file name). */
const NAME = '1794000000-trip_reports_detail_by_vehicle.csv';
const SAMPLE: UploadedFile = { name: NAME, bytes: fixture(NAME) };
const COMPANY = 'ACME TRUCKING LLC';

const read = (file: UploadedFile, warnings: string[] = []) => motiveImporter.read(file, warnings);

const HEADER =
  'Date,Vehicle,Jurisdiction,Distance (mi),Odometer Start,Odometer End,Manual Odo Edit,' +
  'Latitude Start,Longitude Start,Latitude End,Longitude End';

/** A trip detail export with these rows (newest first, as Motive writes them). */
function report(rows: string[], header = HEADER): UploadedFile {
  return {
    name: '1794000001-trip_reports_detail_by_vehicle.csv',
    bytes: Buffer.from([header, ...rows].join('\n') + '\n'),
  };
}

/** A row: date, vehicle, state, miles, odometer start/end, manual edit. */
const row = (
  date: string,
  unit: string,
  state: string,
  mi: string,
  from = '',
  to = '',
  manual = 'No',
) => `"${date}",${unit},${state},${mi},"${from}","${to}",${manual},1,2,3,4`;

/** As ConversionService does: one truck report per vehicle. */
function trucksOf(r: SourceReport): TruckReport[] {
  return (r.trucks ?? [{ unit: r.detectedUnit!, trips: r.trips }]).map((t) => ({
    company: COMPANY,
    unit: t.unit,
    sourceFile: NAME,
    report: { ...r, trips: t.trips, detectedUnit: t.unit, trucks: undefined },
  }));
}

describe('Motive IFTA trip report — the sample export', () => {
  it('is recognised as Motive only', () => {
    expect(detectFormats(SAMPLE)).toEqual(['motive']);
  });

  it('reads two vehicles as two trucks; the file has no company', () => {
    const r = read(SAMPLE);
    expect(r.trucks?.map((t) => t.unit)).toEqual(['Volvo 7', '31']);
    expect(r.trips).toEqual([]);
    expect(r.detectedUnit).toBeNull();
    expect(r.detectedCompany).toBeNull();
    expect(r.distanceUnit).toBe('M');
  });

  it('makes one trip per truck and month, in odometer order, with its odometer', () => {
    const [volvo, unit31] = read(SAMPLE).trucks!;
    expect(volvo.trips).toHaveLength(1);
    expect(volvo.trips[0].legs.map((l) => [l.state, l.distance])).toEqual([
      ['TX', '433'],
      ['OK', '451'],
      ['KS', '276'],
    ]);
    expect(volvo.trips[0].odometer).toEqual({ begin: 431000, end: 432160 });
    expect(volvo.trips[0].reportedTotal).toBe(1160.1);
    expect(unit31.trips[0].legs.map((l) => [l.state, l.distance])).toEqual([
      ['WA', '246'],
      ['OR', '229'],
      ['ID', '344'], // 288.51 + 54.99 = 343.5 rounds half up
    ]);
    expect(unit31.trips[0].odometer).toEqual({ begin: 1205330, end: 1206148 });
  });

  it('converts to the expected ProMiles file byte for byte, Begin Odo from the file', () => {
    const warnings: string[] = [];
    const out = writeProMiles(trucksOf(read(SAMPLE, warnings)));
    expect(out.outputs).toHaveLength(1);
    expect(out.outputs[0].csv).toBe(
      fixture('promiles_expected_motive_2trucks_oct2026.csv').toString('utf8'),
    );
    expect(out.outputs[0].odometers).toEqual([
      { unit: 'Volvo 7', reading: 432160, asOf: new Date(Date.UTC(2026, 9, 7)) },
      { unit: '31', reading: 1206148, asOf: new Date(Date.UTC(2026, 9, 14)) },
    ]);
    expect(out.trips[0].fileOdometer).toEqual({ begin: '431000', end: '432160' });
    expect([...warnings, ...out.warnings]).toEqual([]);
  });
});

describe('Motive IFTA trip report — Begin Odo', () => {
  const twoMonths = report([
    row('Oct 1, 2026', '9', 'Texas', '20.00', '1,030', '1,050'),
    row('Sep 30, 2026', '9', 'Texas', '30.00', '1,000', '1,030'),
  ]);
  const begins = (out: ReturnType<typeof writeProMiles>) => out.trips.map((t) => t.beginOdo);

  it('starts each month at the file reading when none is typed, ignoring the saved one', () => {
    const saved = new Map([[truckKey(COMPANY, '9'), { reading: 5, asOf: new Date(0) }]]);
    const out = writeProMiles(trucksOf(read(twoMonths)), {}, saved);
    expect(begins(out)).toEqual(['1000', '1030']);
    expect(out.savedUsed).toEqual({});
    expect(out.outputs[0].odometers[0].reading).toBe(1050);
  });

  it('lets a typed reading win, carried forward by the miles', () => {
    const out = writeProMiles(trucksOf(read(twoMonths)), { [truckKey(COMPANY, '9')]: '500' });
    expect(begins(out)).toEqual(['500', '530']);
  });

  it('falls back to the saved reading when the file has no odometer', () => {
    const file = report([row('Oct 1, 2026', '9', 'Texas', '20.00')]);
    const saved = new Map([[truckKey(COMPANY, '9'), { reading: 700, asOf: new Date(0) }]]);
    const out = writeProMiles(trucksOf(read(file)), {}, saved);
    expect(read(file).trips[0].odometer).toBeNull();
    expect(begins(out)).toEqual(['700']);
  });
});

describe('Motive IFTA trip report — variations', () => {
  it('reads one vehicle as the unit #, and accepts CRLF and km', () => {
    const file = report(
      [row('Oct 2, 2026', 'T-12', 'Ohio', '10.40', '100', '110')],
      HEADER.replace('(mi)', '(km)'),
    );
    file.bytes = Buffer.from(file.bytes.toString().replace(/\n/g, '\r\n'));
    const r = read(file);
    expect(r.trucks).toBeUndefined();
    expect(r.detectedUnit).toBe('T-12');
    expect(r.distanceUnit).toBe('K');
    expect(r.trips[0].legs.map((l) => [l.state, l.distance])).toEqual([['OH', '10']]);
  });

  it('warns about odometer jumps with no state row and odometer edits by hand', () => {
    const warnings: string[] = [];
    read(
      report([
        row('Oct 6, 2026', '9', 'Texas', '10.00', '1,600', '1,610', 'Yes'),
        row('Oct 5, 2026', '9', 'Texas', '10.00', '1,083', '1,093'),
        row('Oct 5, 2026', '9', 'Texas', '10.00', '1,070', '1,080'),
      ]),
      warnings,
    );
    expect(warnings).toEqual([
      expect.stringContaining('+507 mi between Oct 5, 2026 and Oct 6, 2026 (1,093 → 1,600)'),
      expect.stringContaining('edited by hand on Oct 6, 2026'),
    ]);
  });

  it.each([
    [report([]), /no trip rows/],
    [report([row('Oct 2, 2026', '', 'Texas', '1')]), /no Vehicle/],
    [report([row('Oct 2, 2026', '9', 'Narnia', '1')]), /unknown state\/province "Narnia"/],
    [report([row('Oct 2, 2026', '9', 'Texas', 'lots')]), /unrecognised distance "lots"/],
    [report([row('Feb 30, 2026', '9', 'Texas', '1')]), /unrecognised date "Feb 30, 2026"/],
    [report([row('Oct 2, 2026', '9', 'Texas', '1', 'n/a', '5')]), /unrecognised odometer "n\/a"/],
  ])('refuses a broken file with a reason (%#)', (file, reason) => {
    expect(() => read(file)).toThrow(ConversionError);
    expect(() => read(file)).toThrow(reason);
  });
});

describe('Motive distance summary by vehicle', () => {
  const SUMMARY_NAME = '1794000000-distance_summary_by_vehicle.csv';
  const SUMMARY: UploadedFile = { name: SUMMARY_NAME, bytes: fixture(SUMMARY_NAME) };
  const OCTOBER: [Date, Date] = [new Date(Date.UTC(2026, 9, 1)), new Date(Date.UTC(2026, 9, 31))];

  /** A summary export with these rows: vehicle, state, miles. */
  const summary = (rows: string[]): UploadedFile => ({
    name: '1794000002-distance_summary_by_vehicle.csv',
    bytes: Buffer.from(
      ['Vehicle,Jurisdiction,Distance (mi),Fuel (gal)', ...rows].join('\n') + '\n',
    ),
  });

  it('is recognised as Motive only', () => {
    expect(detectFormats(SUMMARY)).toEqual(['motive']);
  });

  it('reads the vehicles but needs the period, offering the month before the export', () => {
    const r = read(SUMMARY);
    expect(r.needsPeriod).toBe(true);
    expect(r.trucks).toEqual([
      { unit: '12', trips: [] },
      { unit: 'Volvo 9', trips: [] },
    ]);
    // 1794000000 = Nov 6, 2026 → October 2026.
    expect(r.suggestedPeriod).toEqual(OCTOBER);
    expect(motiveImporter.suggestPeriod?.('report.csv')).toBeNull();
  });

  it('makes one trip per vehicle over the period given, legs in file order', () => {
    const r = motiveImporter.read(SUMMARY, [], { period: OCTOBER });
    expect(r.needsPeriod).toBeUndefined();
    const [twelve] = r.trucks!;
    expect(twelve.trips).toEqual([
      {
        period: OCTOBER,
        reportedTotal: 4871.84,
        legs: [
          { state: 'ID', begin: OCTOBER[0], end: OCTOBER[1], distance: '787' },
          { state: 'MT', begin: OCTOBER[0], end: OCTOBER[1], distance: '1481' },
          { state: 'WA', begin: OCTOBER[0], end: OCTOBER[1], distance: '2604' },
        ],
        odometer: null,
      },
    ]);
  });

  it('matches the golden ProMiles file for the sample export', () => {
    const r = motiveImporter.read(SUMMARY, [], { period: OCTOBER });
    const { outputs } = writeProMiles(trucksOf(r).map((t) => ({ ...t, sourceFile: SUMMARY_NAME })));
    expect(outputs[0].csv).toBe(
      fixture('promiles_expected_motive_summary_2trucks_oct2026.csv').toString('utf8'),
    );
  });

  it('adds up a state listed twice and keeps one vehicle as a plain unit #', () => {
    const r = motiveImporter.read(summary(['9,Texas,10.25', '9,Texas,"1,000.30"']), [], {
      period: OCTOBER,
    });
    expect(r.detectedUnit).toBe('9');
    expect(r.trucks).toBeUndefined();
    expect(r.trips[0].legs.map((l) => [l.state, l.distance])).toEqual([['TX', '1011']]);
  });

  it.each([
    [summary([]), /no distance rows/],
    [summary([',Texas,1']), /no Vehicle/],
    [summary(['9,Narnia,1']), /unknown state\/province "Narnia"/],
    [summary(['9,Texas,lots']), /unrecognised distance "lots"/],
  ])('refuses a broken file with a reason (%#)', (file, reason) => {
    expect(() => read(file)).toThrow(ConversionError);
    expect(() => read(file)).toThrow(reason);
  });
});
