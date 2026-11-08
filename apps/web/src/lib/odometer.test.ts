import { describe, expect, it } from 'vitest';
import { truckKey, type TripSummary } from '@haulbook/shared';
import { tripOdometers } from './odometer';

const trip = (company: string, unit: string, totalDistance: number): TripSummary => ({
  company,
  unit,
  sourceFile: `${unit}_IFTA_Single_Unit_Mileage_Report.csv`,
  beginDate: '10/1/2026',
  endDate: '10/31/2026',
  beginOdo: '1',
  beginOdoIsPlaceholder: true,
  distanceUnit: 'M',
  states: ['TX'],
  totalDistance,
  reportedTotal: totalDistance,
  fileOdometer: null,
});

describe('tripOdometers', () => {
  const trips = [trip('ACME', '22', 300), trip('ACME', '22', 50.25), trip('XYZ', '22', 10)];

  it('uses the placeholder until a reading is typed', () => {
    expect(tripOdometers(trips, {}).map(({ editable, value }) => [editable, value])).toEqual([
      [true, '1'],
      [false, '1'],
      [true, '1'],
    ]);
  });

  it('carries a truck’s reading forward, keeping the same unit # at two companies apart', () => {
    const odo = { [truckKey('ACME', '22')]: '1,000', [truckKey('XYZ', '22')]: '' };
    expect(tripOdometers(trips, odo).map((t) => t.value)).toEqual(['1000', '1300', '1']);
  });

  it('uses a truck’s saved reading while nothing is typed for it', () => {
    const saved = { [truckKey('ACME', '22')]: { reading: '5000', asOf: '9/30/2026' } };
    expect(
      tripOdometers(trips, {}, saved).map(({ value, fromSaved }) => [value, fromSaved]),
    ).toEqual([
      ['5000', true],
      ['5300', true],
      ['1', false],
    ]);
    expect(tripOdometers(trips, { [truckKey('ACME', '22')]: '7000' }, saved)[0]).toMatchObject({
      value: '7000',
      fromSaved: false,
    });
  });

  it('starts trips at the file’s own odometer unless a reading is typed (Motive)', () => {
    const withFile = [
      { ...trip('ACME', '9', 30), fileOdometer: { begin: '1000', end: '1031' } },
      { ...trip('ACME', '9', 20), fileOdometer: { begin: '1040', end: '1060' } },
      trip('ACME', '9', 5),
    ];
    const saved = { [truckKey('ACME', '9')]: { reading: '5', asOf: '9/30/2026' } };
    expect(
      tripOdometers(withFile, {}, saved).map(({ value, fromFile, fromSaved }) => [
        value,
        fromFile,
        fromSaved,
      ]),
    ).toEqual([
      ['1000', true, false],
      ['1040', true, false],
      ['1060', false, false], // carried on from the file's last reading
    ]);
    expect(tripOdometers(withFile, { [truckKey('ACME', '9')]: '500' }).map((t) => t.value)).toEqual(
      ['500', '530', '550'],
    );
  });

  it('ignores a reading that is not a number yet', () => {
    expect(tripOdometers(trips, { [truckKey('ACME', '22')]: '10x' })[1]).toMatchObject({
      placeholder: true,
    });
  });
});
