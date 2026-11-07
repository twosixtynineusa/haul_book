import type { TripSummary } from '@haulbook/shared';
import { outputBaseName } from './conversion.service';

const trip = (unit: string, beginDate: string): TripSummary => ({
  company: 'ACME TRUCKING LLC',
  unit,
  sourceFile: `${unit}_IFTA_Single_Unit_Mileage_Report.csv`,
  beginDate,
  endDate: beginDate,
  beginOdo: '1',
  beginOdoIsPlaceholder: true,
  distanceUnit: 'M',
  states: ['TX'],
  totalDistance: 1,
  reportedTotal: 1,
});

const name = (company: string, units: string[], months: string[]) =>
  outputBaseName({ company, units, trips: months.map((m) => trip(units[0], m)) });

describe('outputBaseName — company name + unit # + period', () => {
  it('names one unit for one month', () => {
    expect(name('ACME TRUCKING LLC', ['22'], ['10/1/2026'])).toBe(
      'ACME-TRUCKING-LLC_unit-22_2026-10',
    );
  });

  it('names the month range of a quarterly report', () => {
    expect(name('X Y Z Freight, LLC', ['22'], ['10/1/2026', '11/1/2026', '12/1/2026'])).toBe(
      'X-Y-Z-Freight-LLC_unit-22_2026-10_to_2026-12',
    );
  });

  it('lists up to three units, then counts them, and drops unsafe characters', () => {
    expect(name('A&B', ['22', '29-LB'], ['10/1/2026'])).toBe('A-B_units-22-29-LB_2026-10');
    expect(name('A', ['1', '2', '3', '4/x'], ['10/1/2026'])).toBe('A_4-units_2026-10');
    expect(name('***', ['1'], ['10/1/2026'])).toBe('company_unit-1_2026-10');
  });
});
