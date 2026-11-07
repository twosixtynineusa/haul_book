import { parse } from 'csv-parse/sync';
import { truckKey } from '@haulbook/shared';
import type { UploadedFile } from './common';
import { wialonImporter } from './importers/wialon';
import {
  RAW,
  RAW_NAME,
  fixture,
  month,
  state,
  wialonReport,
} from '../../test/helpers/wialon-report';
import { PROMILES_HEADER, writeProMiles, type TruckReport } from './promiles';

function truck(company: string, unit: string, file: UploadedFile): TruckReport {
  return { company, unit, sourceFile: file.name, report: wialonImporter.read(file, []) };
}

function rows(csv: string): string[][] {
  return parse(csv, { relax_column_count: true });
}

const quarterly = wialonReport([
  month('1', 'October', '300 mi', '2026-10-01 00:00:00', '2026-10-31 23:59:59'),
  state('1.1', 'Texas', '200 mi', '2026-10-02 08:00:00'),
  state('1.2', 'Oklahoma', '100 mi', '2026-10-05 08:00:00'),
  month('2', 'November', '50 mi', '2026-11-01 00:00:00', '2026-11-30 23:59:59'),
  state('2.1', 'Texas', '50 mi', '2026-11-03 08:00:00'),
]);

describe('writeProMiles — the sample export end to end', () => {
  const out = writeProMiles([truck('ACME TRUCKING LLC', '22', RAW)]);
  const [output] = out.outputs;
  const lines = rows(output.csv);

  it('reproduces the expected ProMiles file byte for byte', () => {
    expect(output.csv).toBe(fixture('promiles_expected_unit22_oct2026.csv').toString('utf8'));
  });

  it('writes the TRIPSUMMARY2 preamble and header, like ProMiles’ example', () => {
    const example = rows(fixture('promiles_tripsummary2_example.csv').toString('utf8'));
    expect(lines[0]).toEqual(example[0]);
    expect(lines[1]).toEqual(PROMILES_HEADER);
    expect(output.csv.includes('\r')).toBe(false);
  });

  it('orders legs by first entry and fills the trip row’s columns A–I', () => {
    expect(lines.slice(2, 6).map((r) => r[6])).toEqual(['TX', 'OK', 'KS', 'MO']);
    expect(lines[2].slice(0, 9).every((cell) => cell !== '')).toBe(true);
    for (const row of lines.slice(3)) expect(row.slice(0, 6)).toEqual(Array(6).fill(''));
    for (const row of lines.slice(2)) expect(row.slice(8)).toEqual(['0', 'n', 'n', '']);
  });

  it('summarises the trip with its company, and has no warnings', () => {
    expect(out.warnings).toEqual([]);
    expect(output).toMatchObject({ company: 'ACME TRUCKING LLC', units: ['22'] });
    expect(out.trips).toEqual([
      expect.objectContaining({
        company: 'ACME TRUCKING LLC',
        unit: '22',
        sourceFile: RAW_NAME,
        beginDate: '10/1/2026',
        endDate: '10/31/2026',
        beginOdo: '1',
        beginOdoIsPlaceholder: true,
        totalDistance: 3618,
        reportedTotal: 3619,
      }),
    ]);
  });
});

describe('writeProMiles — saved odometers', () => {
  const key = truckKey('XYZ', '7');
  const savedAt = (reading: number, y: number, m: number, d: number) =>
    new Map([[key, { reading, asOf: new Date(Date.UTC(y, m - 1, d)) }]]);
  const beginOdos = (out: ReturnType<typeof writeProMiles>) => out.trips.map((t) => t.beginOdo);

  it('starts a truck where its last conversion ended when nothing is typed', () => {
    const out = writeProMiles([truck('xyz', '7', quarterly)], {}, savedAt(5000, 2026, 9, 30));
    expect(beginOdos(out)).toEqual(['5000', '5300']);
    expect(out.trips[0].beginOdoIsPlaceholder).toBe(false);
    expect(out.savedUsed).toEqual({ [key]: { reading: '5000', asOf: '9/30/2026' } });
    expect(out.outputs[0].odometers).toEqual([
      { unit: '7', reading: 5350, asOf: new Date(Date.UTC(2026, 10, 30)) },
    ]);
    expect(out.warnings).toEqual([]);
  });

  it('lets a typed reading win over the saved one', () => {
    const out = writeProMiles(
      [truck('XYZ', '7', quarterly)],
      { [key]: '9000' },
      savedAt(5000, 2026, 9, 30),
    );
    expect(beginOdos(out)).toEqual(['9000', '9300']);
    expect(out.savedUsed).toEqual({});
  });

  it('ignores a saved reading that is not before the upload, with a warning', () => {
    const out = writeProMiles([truck('XYZ', '7', quarterly)], {}, savedAt(5000, 2026, 10, 31));
    expect(beginOdos(out)).toEqual(['1', '1']);
    expect(out.savedUsed).toEqual({});
    expect(out.outputs[0].odometers).toEqual([]);
    expect(out.warnings).toEqual([
      expect.stringContaining('saved odometer (10/31/2026) is not before'),
    ]);
  });

  it('still uses a saved reading across a gap, but warns that months are missing', () => {
    const out = writeProMiles([truck('XYZ', '7', quarterly)], {}, savedAt(5000, 2026, 8, 31));
    expect(beginOdos(out)).toEqual(['5000', '5300']);
    expect(out.warnings).toEqual([expect.stringContaining('months between weren')]);
  });
});

describe('writeProMiles — companies, trucks and odometers', () => {
  it('writes one file per company, each with its own trucks', () => {
    const out = writeProMiles([
      truck('ACME', '22', RAW),
      truck('XYZ', '7', quarterly),
      truck('acme ', '25', { ...quarterly, name: 'b.csv' }),
    ]);
    expect(
      out.outputs.map((o) => [
        o.company,
        o.units,
        rows(o.csv)
          .filter((r) => r[0])
          .map((r) => r[0]),
      ]),
    ).toEqual([
      ['ACME', ['22', '25'], ['###TRIPSUMMARY2', 'Unit#', '22', '25', '25']],
      ['XYZ', ['7'], ['###TRIPSUMMARY2', 'Unit#', '7', '7']],
    ]);
  });

  it('carries a truck’s odometer forward month by month', () => {
    const out = writeProMiles([truck('XYZ', '7', quarterly)], { [truckKey('XYZ', '7')]: '1000' });
    expect(
      rows(out.outputs[0].csv)
        .slice(2)
        .map((r) => r.slice(0, 8)),
    ).toEqual([
      ['7', '10/1/2026', '10/31/2026', '1000', 'D', 'M', 'TX', '200'],
      ['', '', '', '', '', '', 'OK', '100'],
      ['7', '11/1/2026', '11/30/2026', '1300', 'D', 'M', 'TX', '50'],
    ]);
    expect(out.warnings).toEqual([]);
  });

  it('keeps the same unit # in two companies apart', () => {
    const out = writeProMiles([truck('A', '22', RAW), truck('B', '22', RAW)], {
      [truckKey('A', '22')]: '500',
    });
    expect(out.trips.map((t) => [t.company, t.beginOdo])).toEqual([
      ['A', '500'],
      ['B', '1'],
    ]);
  });

  it('warns about odometers for trucks that are not in the upload', () => {
    const out = writeProMiles([truck('A', '22', RAW)], { [truckKey('A', '99')]: '5' });
    expect(out.warnings).toEqual([expect.stringContaining('a unit 99')]);
  });

  it('rejects the same truck and month twice, and miles mixed with km', () => {
    expect(() =>
      writeProMiles([truck('A', '22', RAW), truck('a', '22', { ...RAW, name: 'copy.csv' })]),
    ).toThrow(/2026-10 is in more than one file/);
    const km = wialonReport([
      month('1', 'December', '7 km', '2026-12-01 00:00:00', '2026-12-31 23:59:59'),
      state('1.1', 'Ontario', '7 km', '2026-12-05 00:00:00'),
    ]);
    expect(() => writeProMiles([truck('A', '22', RAW), truck('A', '22', km)])).toThrow(
      /one report is in miles, another in kilometres/,
    );
  });

  it('reports where each truck’s real odometer ends, and never a placeholder one', () => {
    const out = writeProMiles([truck('XYZ', '7', quarterly), truck('XYZ', '8', quarterly)], {
      [truckKey('XYZ', '7')]: '1000.25',
    });
    expect(out.outputs[0].odometers).toEqual([
      { unit: '7', reading: 1350.3, asOf: new Date(Date.UTC(2026, 10, 30)) },
    ]);
    expect(out.savedUsed).toEqual({});
  });

  it('rejects an upload with no state mileage', () => {
    const empty = wialonReport([
      month('1', 'October', '0 mi', '2026-10-01 00:00:00', '2026-10-31 23:59:59'),
    ]);
    expect(() => writeProMiles([truck('A', '1', empty)])).toThrow(/No state mileage/);
  });
});
