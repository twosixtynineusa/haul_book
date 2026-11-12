import { bigRoadReport } from '../../../test/helpers/big-road-report';
import { fixture } from '../../../test/helpers/wialon-report';
import { writeProMiles } from '../promiles';
import { detectFormats } from '.';
import { bigRoadImporter } from './big-road';

const period: [Date, Date] = [new Date('2026-10-01'), new Date('2026-10-31')];
describe('Big Road Vehicle Mileage', () => {
  it('requires an explicit period and company, never using the export date or exception dates', () => {
    const file = bigRoadReport({ exceptions: [['007', 46000, 46001, 'Diagnostic message']] });
    expect(detectFormats(file)).toEqual(['big-road']);
    expect(bigRoadImporter.read(file, [])).toMatchObject({
      needsPeriod: true,
      suggestedPeriod: null,
      detectedCompany: null,
      detectedUnit: '007',
      trips: [],
    });
  });
  it('converts confirmed dates byte for byte, excluding the fleet total row', () => {
    const file = bigRoadReport();
    const report = bigRoadImporter.read(file, [], { period });
    expect(report.trips).toHaveLength(1);
    expect(report.trips[0].reportedTotal).toBe(350.9);
    const output = writeProMiles([
      { company: 'ACME TRUCKING LLC', unit: report.detectedUnit!, sourceFile: file.name, report },
    ]);
    expect(output.outputs[0].csv).toBe(
      fixture('promiles_expected_big_road_oct2026.csv').toString(),
    );
    expect(output.warnings).toEqual([]);
  });
  it('keeps several trucks separate and accepts blank state cells and zero Unknown', () => {
    const file = bigRoadReport({
      headers: ['Truck', 'OR', 'WA', 'Unknown', 'Total (mi)'],
      rows: [
        ['007', 100, null, 0, 100],
        ['008', null, 200, 0, 200],
      ],
    });
    expect(bigRoadImporter.read(file, []).trucks?.map((t) => [t.unit, t.trips])).toEqual([
      ['007', []],
      ['008', []],
    ]);
    const report = bigRoadImporter.read(file, [], { period });
    expect(report.detectedUnit).toBeNull();
    expect(
      report.trucks?.map((t) => [t.unit, t.trips[0].legs.map((l) => [l.state, l.distance])]),
    ).toEqual([
      ['007', [['OR', '100']]],
      ['008', [['WA', '200']]],
    ]);
  });
  it('refuses Unknown miles even before dates are supplied', () => {
    const file = bigRoadReport({
      headers: ['Truck', 'OR', 'Unknown', 'Total (mi)'],
      rows: [['007', 100, 45, 145]],
    });
    expect(() => bigRoadImporter.read(file, [])).toThrow(/45 Unknown miles.*correct the source/);
    expect(() => bigRoadImporter.read(file, [], { period })).toThrow(/45 Unknown miles/);
  });
  it.each([
    [{ headers: ['Truck', 'Narnia', 'Total (mi)'], rows: [['007', 100, 100]] }, /unknown state/],
    [
      { headers: ['Truck', 'OR', 'Oregon', 'Total (mi)'], rows: [['007', 100, 100, 200]] },
      /appears twice/,
    ],
    [{ rows: [['007', -1, 2, 1]] }, /unrecognised distance/],
    [{ rows: [['', 1, 2, 3]] }, /no Truck/],
    [
      {
        rows: [
          ['007', 1, 2, 3],
          ['007', 1, 2, 3],
        ],
      },
      /truck appears twice/,
    ],
    [{ rows: [['007', 0, 0, 12]] }, /positive total/],
    [{ rows: [] }, /no truck mileage/],
  ])('refuses malformed workbook (%#)', (options, error) => {
    expect(() => bigRoadImporter.read(bigRoadReport(options), [], { period })).toThrow(error);
  });
  it('rejects reversed and cross-quarter periods and never throws during detection', () => {
    expect(() =>
      bigRoadImporter.read(bigRoadReport(), [], { period: [period[1], period[0]] }),
    ).toThrow(/period/);
    expect(() =>
      bigRoadImporter.read(bigRoadReport(), [], { period: [new Date('2026-09-01'), period[1]] }),
    ).toThrow(/quarter/);
    expect(bigRoadImporter.detect({ name: 'broken.xls', bytes: Buffer.from('broken') })).toBe(
      false,
    );
    expect(() =>
      bigRoadImporter.read({ name: 'broken.xls', bytes: Buffer.from('broken') }, []),
    ).toThrow(/export it again/);
  });
});
