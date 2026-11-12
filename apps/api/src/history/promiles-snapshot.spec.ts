import { fixture } from '../../test/helpers/wialon-report';
import { attachProMiles, parseProMilesCsv } from './promiles-snapshot';

describe('ProMiles database snapshots', () => {
  it('preserves all exported columns and separates trucks and trips', () => {
    const trips = parseProMilesCsv(
      fixture('promiles_expected_motive_2trucks_oct2026.csv').toString(),
    );
    expect(trips.map((t) => t.unit)).toEqual(['Volvo 7', '31']);
    expect(trips[0]).toMatchObject({
      beginDate: '2026-10-03',
      endDate: '2026-10-07',
      beginOdo: '431000',
      mode: 'D',
      distanceUnit: 'M',
    });
    expect(
      trips
        .flatMap((t) => t.legs)
        .every(
          (l) =>
            l.tollDistance === '0' && l.empty === 'n' && l.offRoad === 'n' && l.permitting === '',
        ),
    ).toBe(true);
  });
  it('matches historical state detail only for the exact truck, dates and distance', () => {
    const stored = parseProMilesCsv(fixture('promiles_expected_big_road_oct2026.csv').toString());
    const trips = [
      {
        beginDate: '2026-10-01',
        endDate: '2026-10-31',
        beginOdo: null,
        endOdo: null,
        distance: 351,
        states: ['OR', 'WA'],
      },
    ];
    expect(
      attachProMiles(trips, '007', stored)[0].promiles?.legs.map((l) => [l.state, l.distance]),
    ).toEqual([
      ['OR', '121'],
      ['WA', '230'],
    ]);
    expect(attachProMiles(trips, '008', stored)[0].promiles).toBeUndefined();
    expect(
      attachProMiles([{ ...trips[0], distance: 350 }], '007', stored)[0].promiles,
    ).toBeUndefined();
    expect(attachProMiles(trips, '007', [...stored, ...stored])[0].promiles).toBeUndefined();
  });
  it('refuses arbitrary or broken CSVs', () => {
    expect(() => parseProMilesCsv('hello,world')).toThrow();
    const csv = fixture('promiles_expected_big_road_oct2026.csv').toString();
    expect(() => parseProMilesCsv(csv.replace('OR,121', 'Atlantis,121'))).toThrow();
  });
});
