import { fixture } from '../../../test/helpers/wialon-report';
import { ConversionError, type UploadedFile } from '../common';
import { writeProMiles } from '../promiles';
import { detectFormats } from '.';
import { ezlogzImporter } from './ezlogz';

/** A made-up export in the exact format (LF, final newline, the provider's file name). */
const NAME = 'Mileage_Report.csv';
const SAMPLE: UploadedFile = { name: NAME, bytes: fixture(NAME) };

const read = (file: UploadedFile, warnings: string[] = []) => ezlogzImporter.read(file, warnings);

/** An export in this format: the given unit rows and daily rows, under their headers. */
function report(units: string[], days: string[]): UploadedFile {
  const text = [
    'State,Miles',
    'Texas,10 mi',
    'Total distance:,10 mi',
    'Driver,State,Miles',
    'John Doe,,10 mi',
    'John Doe,Texas,10.0 mi',
    'Units,State,Miles',
    ...units,
    'Date,State,Driver,Unit,Miles',
    ...days,
  ].join('\n');
  return { name: 'Mileage_Report (3).csv', bytes: Buffer.from(text + '\n') };
}

describe('Ezlogz Mileage Report — the sample export', () => {
  it('is recognised as Ezlogz only', () => {
    expect(detectFormats(SAMPLE)).toEqual(['ezlogz']);
    expect(ezlogzImporter.detect({ name: 'Mileage_Report.xlsx', bytes: SAMPLE.bytes })).toBe(false);
  });

  it('reads the unit # from the Units section; the file has no company', () => {
    const r = read(SAMPLE);
    expect(r.detectedUnit).toBe('52');
    expect(r.detectedCompany).toBeNull();
    expect(r.distanceUnit).toBe('M');
  });

  it('makes one trip per month from the daily rows, whole miles per state', () => {
    const [trip, ...rest] = read(SAMPLE).trips;
    expect(rest).toEqual([]);
    expect(trip.period).toBeNull(); // the writer takes the first and last day driven
    expect(trip.legs.map((l) => [l.state, l.distance])).toEqual([
      ['TX', '433'],
      ['OK', '435'],
      ['KS', '276'],
      ['NE', '461'],
      ['IA', '311'], // 288.5 + 22.0 = 310.5 rounds half up
      ['IL', '366'],
      ['MO', '312'],
    ]);
    const tx = trip.legs[0];
    expect([tx.begin, tx.end]).toEqual([
      new Date(Date.UTC(2026, 9, 3)),
      new Date(Date.UTC(2026, 9, 9)),
    ]);
    expect(trip.reportedTotal).toBe(2593.5); // the daily totals, for the review's cross-check
  });

  it('converts to the expected ProMiles file byte for byte, with no warnings', () => {
    const warnings: string[] = [];
    const out = writeProMiles([
      {
        company: 'ACME TRUCKING LLC',
        unit: '52',
        sourceFile: NAME,
        report: read(SAMPLE, warnings),
      },
    ]);
    expect(out.outputs[0].csv).toBe(
      fixture('promiles_expected_ezlogz_unit52_oct2026.csv').toString('utf8'),
    );
    expect([...warnings, ...out.warnings]).toEqual([]);
  });
});

describe('Ezlogz Mileage Report — variations', () => {
  it('splits a multi-month export into one trip per month, and accepts CRLF', () => {
    const file = report(
      ['7,,30 mi', '7,Texas,20 mi', '7,Oklahoma,10 mi'],
      [
        '2026-09-30,,,,15 mi',
        '2026-09-30,Texas,John Doe,Texas,15 mi',
        '2026-10-01,,,,15 mi',
        '2026-10-01,Texas,John Doe,Texas,5 mi',
        '2026-10-01,Oklahoma,John Doe,Oklahoma,10 mi',
      ],
    );
    file.bytes = Buffer.from(file.bytes.toString().replace(/\n/g, '\r\n'));
    const warnings: string[] = [];
    const r = read(file, warnings);
    expect(r.detectedUnit).toBe('7');
    expect(r.trips.map((t) => t.legs.map((l) => [l.state, l.distance]))).toEqual([
      [['TX', '15']],
      [
        ['TX', '5'],
        ['OK', '10'],
      ],
    ]);
    expect(r.trips.map((t) => t.reportedTotal)).toEqual([15, 15]);
    expect(warnings).toEqual([]);
  });

  it('warns when the unit totals and the daily rows disagree', () => {
    const warnings: string[] = [];
    read(
      report(
        ['7,,30 mi', '7,Texas,30 mi'],
        ['2026-10-01,,,,20 mi', '2026-10-01,Texas,John Doe,Texas,20 mi'],
      ),
      warnings,
    );
    expect(warnings).toEqual([expect.stringContaining('disagree (TX 30 vs 20)')]);
  });

  it.each([
    [report(['7,,1 mi', '8,,1 mi'], ['2026-10-01,Texas,A,Texas,1 mi']), /lists 2 units \(7, 8\)/],
    [report([], ['2026-10-01,Texas,A,Texas,1 mi']), /no "Units,State,Miles" section/],
    [report(['7,,1 mi', '7,Texas,1 mi'], []), /no daily rows/],
    [report(['7,,1 mi'], ['2026-10-01,Narnia,A,Narnia,1 mi']), /unknown state\/province "Narnia"/],
    [report(['7,,1 mi'], ['2026-10-01,Texas,A,Texas,lots']), /unrecognised distance "lots"/],
    [report(['7,,1 mi'], ['2026-02-30,Texas,A,Texas,1 mi']), /unrecognised date "2026-02-30"/],
    [
      report(['7,,1 mi'], ['2026-10-01,Texas,A,Texas,1 mi', '2026-10-02,Ohio,A,Ohio,1 km']),
      /mixes/,
    ],
  ])('refuses a broken file with a reason (%#)', (file, reason) => {
    expect(() => read(file)).toThrow(ConversionError);
    expect(() => read(file)).toThrow(reason);
  });
});
