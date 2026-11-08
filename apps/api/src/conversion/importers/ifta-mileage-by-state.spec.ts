import { fixture } from '../../../test/helpers/wialon-report';
import { ConversionError, type UploadedFile } from '../common';
import { writeProMiles } from '../promiles';
import { detectFormat, detectFormats } from '.';
import {
  bellamspAnirImporter,
  hos247Importer,
  unitFromVehicleFileName,
} from './ifta-mileage-by-state';
import { wialonImporter } from './wialon';

/** A made-up export in the exact format (LF, no final newline, the provider's file name). */
const NAME = 'Vehicle-7-123456-mileage-report_20261001-20261031_1794000000000.csv';
const SAMPLE: UploadedFile = { name: NAME, bytes: fixture(NAME) };

const read = (file: UploadedFile, warnings: string[] = []) =>
  bellamspAnirImporter.read(file, warnings);

/** An export in this format with the given lines after the vehicle header. */
function report(lines: string[], period = '2026/10/01 - 2026/10/31'): UploadedFile {
  const text = [
    'IFTA Mileage By State',
    'Summary of total mileage by state for all equipment',
    'Carrier: X Y Z FREIGHT LLC',
    `Period: ${period}`,
    'Report Generated: 2026/11/07 9:15:30 am',
    'Vehicle,Name,Make,Model,Year',
    ...lines,
  ].join('\n');
  return {
    name: 'Vehicle-31-654321-mileage-report_20261001-20261031_1.csv',
    bytes: Buffer.from(text),
  };
}

describe('IFTA Mileage By State (Bellfam ELD) — the sample export', () => {
  it('is recognised as Bellfam ELD or HOS 247, which export the same layout', () => {
    expect(detectFormats(SAMPLE)).toEqual(['bellamsp-anir', 'hos247']);
    expect(detectFormat(SAMPLE)).toBeNull(); // ambiguous: the company's source or the user decides
    expect(wialonImporter.detect(SAMPLE)).toBe(false);
    expect(hos247Importer.read(SAMPLE, [])).toEqual(bellamspAnirImporter.read(SAMPLE, []));
  });

  it('reads the carrier as the company and the vehicle Name as the unit #', () => {
    const r = read(SAMPLE);
    expect(r.detectedCompany).toBe('ACME TRUCKING LLC');
    expect(r.detectedUnit).toBe('7');
    expect(r.distanceUnit).toBe('M');
  });

  it('makes one trip for the period, whole miles per state in file order', () => {
    const [trip] = read(SAMPLE).trips;
    expect(trip.period).toEqual([new Date(Date.UTC(2026, 9, 1)), new Date(Date.UTC(2026, 9, 31))]);
    expect(trip.legs.map((l) => [l.state, l.distance])).toEqual([
      ['AR', '412'],
      ['MO', '389'], // 388.5 rounds half up
      ['OK', '1205'],
      ['TX', '2316'],
    ]);
    expect(trip.reportedTotal).toBe(4321.6); // the exact sum, for the review's cross-check
  });

  it('converts to the expected ProMiles file byte for byte, with no warnings', () => {
    const warnings: string[] = [];
    const out = writeProMiles([
      { company: 'ACME TRUCKING LLC', unit: '7', sourceFile: NAME, report: read(SAMPLE, warnings) },
    ]);
    expect(out.outputs[0].csv).toBe(
      fixture('promiles_expected_ifta_by_state_unit7_oct2026.csv').toString('utf8'),
    );
    expect([...warnings, ...out.warnings]).toEqual([]);
  });
});

describe('IFTA Mileage By State — variations', () => {
  it.each([
    [NAME, '7'],
    ['Vehicle-104-ZZ0042-mileage-report_20261001-20261031_1794000000042.csv', '104'],
    ['C:\\fakepath\\Vehicle-29-LB-AB1234-mileage-report_x.csv', '29-LB'],
    ['october.csv', null],
  ])('unit from file name %s → %s', (name, unit) => {
    expect(unitFromVehicleFileName(name)).toBe(unit);
  });

  it('falls back to the file name for the unit #, and accepts CRLF and full state names', () => {
    const file = report([
      '1FAKEVIN0LJ000031,,Volvo,VNL,2021',
      'State,Miles',
      'Texas,10.4',
      'NM,"1,002.6"',
    ]);
    file.bytes = Buffer.from(file.bytes.toString().replace(/\n/g, '\r\n'));
    const r = read(file);
    expect(r.detectedUnit).toBe('31');
    expect(r.trips[0].legs.map((l) => [l.state, l.distance])).toEqual([
      ['TX', '10'],
      ['NM', '1003'],
    ]);
  });

  it('warns about a period longer than a month and a file listing several vehicles', () => {
    const warnings: string[] = [];
    const r = read(
      report(
        ['VIN1,31,Volvo,VNL,2021', 'VIN2,32,Volvo,VNL,2021', 'State,Miles', 'TX,10'],
        '2026/10/01 - 2026/12/31',
      ),
      warnings,
    );
    expect(r.detectedUnit).toBeNull();
    expect(r.trips).toHaveLength(1);
    expect(warnings).toEqual([
      expect.stringContaining('covers more than one month'),
      expect.stringContaining('lists 2 vehicles'),
    ]);
  });

  it.each([
    [report(['VIN,31,Volvo,VNL,2021', 'State,Miles', 'TX,10'], 'October'), /no "Period: /],
    [
      report(['VIN,31,Volvo,VNL,2021', 'State,Miles', 'Narnia,10']),
      /unknown state\/province "Narnia"/,
    ],
    [report(['VIN,31,Volvo,VNL,2021', 'State,Miles', 'TX,10', 'TX,5']), /TX appears twice/],
    [report(['VIN,31,Volvo,VNL,2021', 'State,Miles']), /no state mileage rows/],
    [report(['VIN,31,Volvo,VNL,2021', 'State,Miles', 'TX,lots']), /unrecognised distance "lots"/],
    [
      report(['VIN,31,Volvo,VNL,2021', 'State,Miles', 'TX,1'], '2026/02/30 - 2026/03/01'),
      /impossible date/,
    ],
  ])('refuses a broken file with a reason (%#)', (file, reason) => {
    expect(() => read(file)).toThrow(ConversionError);
    expect(() => read(file)).toThrow(reason);
  });
});
