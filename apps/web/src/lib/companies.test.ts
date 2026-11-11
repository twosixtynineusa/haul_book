import { describe, expect, it } from 'vitest';
import {
  EMPTY_TRUCK,
  changedDetails,
  detailsDraft,
  filterCompanies,
  formatIsoDate,
  moveConfirmText,
  truckChanges,
} from './companies';
import { company } from './test-helpers';

describe('moving a truck', () => {
  it('warns when the other company already has that truck #', () => {
    const xyz = company('X Y Z FREIGHT LLC', ['22']);
    expect(moveConfirmText('22', xyz)).toMatch(/^X Y Z FREIGHT LLC already has truck 22\. /);
    expect(moveConfirmText('25', xyz)).toMatch(
      /^Move truck 25 to X Y Z FREIGHT LLC, with its odometer, details and history\?/,
    );
  });
});

describe('company details', () => {
  const acme = company('ACME TRUCKING LLC', [], { dotNumber: '123456', phone: '555-0100' });

  it('sends only the fields that changed, a cleared one as null', () => {
    const draft = { ...detailsDraft(acme), phone: '  ', email: ' ops@acme.test ' };
    expect(changedDetails(acme, draft)).toEqual({ phone: null, email: 'ops@acme.test' });
    expect(changedDetails(acme, detailsDraft(acme))).toEqual({});
  });
});

describe('truck changes', () => {
  const [truck] = company('ACME', ['22']).trucks;

  it('sends a new truck in full, leaving out an odometer that was not given', () => {
    expect(truckChanges({ ...EMPTY_TRUCK, unit: ' 22 ', vin: '1FUJ' })).toEqual({
      unit: '22',
      vin: '1FUJ',
      plate: null,
      notes: null,
    });
  });

  it('sends only what changed, with the odometer and its date together', () => {
    const draft = { ...EMPTY_TRUCK, unit: '22', odometer: '184310', odometerAsOf: '2026-10-31' };
    expect(truckChanges(draft, truck)).toEqual({ odometer: '184310', odometerAsOf: '2026-10-31' });
    expect(truckChanges({ ...EMPTY_TRUCK, unit: '22' }, truck)).toEqual({});
  });
});

describe('filterCompanies', () => {
  const list = [
    company('ACME TRUCKING LLC', ['22'], { dotNumber: '987654' }),
    company('X Y Z FREIGHT LLC', ['7']),
  ];
  list[1].trucks[0].vin = '1XKAD49X0LJ123456';

  it('matches name, USDOT #, unit #, VIN or plate', () => {
    expect(filterCompanies(list, 'acme').map((c) => c.name)).toEqual(['ACME TRUCKING LLC']);
    expect(filterCompanies(list, '9876').map((c) => c.name)).toEqual(['ACME TRUCKING LLC']);
    expect(filterCompanies(list, 'lj123').map((c) => c.name)).toEqual(['X Y Z FREIGHT LLC']);
    expect(filterCompanies(list, '  ')).toBe(list);
  });
});

describe('formatIsoDate', () => {
  it('shows a calendar date without shifting it by time zone', () => {
    expect(formatIsoDate('2026-10-31')).toBe('Oct 31, 2026');
    expect(formatIsoDate(null)).toBe('—');
  });
});
