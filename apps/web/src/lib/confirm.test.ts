import { describe, expect, it } from 'vitest';
import type { InboxEntry } from '@haulbook/shared';
import {
  deleteCompanyConfirm,
  deleteEntryConfirm,
  deleteTruckConfirm,
  mergeCompanyConfirm,
  moveTruckConfirm,
  reprocessEntryConfirm,
} from './confirm';
import { company } from './test-helpers';

const entry = (over: Partial<InboxEntry>): InboxEntry => ({
  id: 'i1',
  path: 'ACME TRUCKING LLC/report.csv',
  name: 'report.csv',
  status: 'converted',
  format: 'wialon',
  formatOptions: [],
  company: 'ACME TRUCKING LLC',
  companyOptions: [],
  unit: '22',
  units: [],
  promilesUnits: {},
  newTrucks: [],
  period: null,
  suggestedPeriod: null,
  needs: [],
  knownSource: null,
  error: null,
  outputs: ['ACME-TRUCKING-LLC_unit-22_2026-10.csv'],
  archivedPath: 'archive/2026-11-11/report.csv',
  createdAt: '2026-11-11T12:00:00.000Z',
  processedAt: '2026-11-11T12:00:00.000Z',
  ...over,
});

describe('confirm dialogs say what goes and what stays', () => {
  it('deleting a truck lists the truck, its odometer and details', () => {
    const [truck] = company('ACME', ['Volvo 01']).trucks;
    const options = deleteTruckConfirm('ACME', {
      ...truck,
      promilesUnit: '2011',
      odometer: '184310',
      odometerAsOf: '2026-10-31',
      vin: '1XKAD49X0AJ000001',
      plate: 'TX 123',
    });
    expect(options).toMatchObject({
      title: 'Delete truck Volvo 01?',
      tone: 'danger',
      confirmLabel: 'Delete truck Volvo 01',
      items: [
        'Truck Volvo 01 (ProMiles unit # 2011) from ACME',
        'Its saved odometer: 184,310 (end of Oct 31, 2026)',
        'Its VIN and plate',
      ],
    });
    expect(options.kept).toContain('ProMiles files already written');
    // A bare truck: just the truck.
    expect(deleteTruckConfirm('ACME', truck).items).toEqual(['Truck Volvo 01 from ACME']);
  });

  it('deleting a company lists its trucks and saved odometers', () => {
    const acme = company('ACME', ['22', '25']);
    acme.trucks[0].odometer = '1000';
    expect(deleteCompanyConfirm(acme).items).toEqual([
      'The company ACME, its details and its approved source',
      '2 trucks: 22 and 25',
      '1 saved odometer',
    ]);
    const big = company(
      'BIG',
      Array.from({ length: 10 }, (_, i) => String(i + 1)),
    );
    expect(deleteCompanyConfirm(big).items?.[1]).toBe(
      '10 trucks: 1, 2, 3, 4, 5, 6, 7, 8 and 2 more',
    );
  });

  it('deleting an input-folder row lists its ProMiles file and history, keeping the report', () => {
    expect(deleteEntryConfirm(entry({}))).toMatchObject({
      title: 'Delete report.csv?',
      items: [
        'Its row in the input folder list',
        'ProMiles file ACME-TRUCKING-LLC_unit-22_2026-10.csv',
        'Its History entry for ACME TRUCKING LLC · Truck 22',
      ],
      kept: ['The original report, in the archive folder'],
    });
    expect(deleteEntryConfirm(entry({ status: 'duplicate', outputs: [] }))).toMatchObject({
      title: 'Remove report.csv from the list?',
      items: ['Its row in the input folder list'],
      confirmLabel: 'Remove',
    });
  });

  it('converting again lists what it replaces', () => {
    expect(reprocessEntryConfirm(entry({}))).toMatchObject({
      title: 'Convert report.csv again?',
      itemsLabel: 'This replaces',
      tone: 'primary',
    });
    expect(
      reprocessEntryConfirm(entry({ status: 'dismissed', outputs: [] })).items,
    ).toBeUndefined();
  });

  it('moving or merging says when two trucks become one', () => {
    const [truck] = company('ACME', ['22']).trucks;
    expect(moveTruckConfirm(truck, company('XYZ', ['22']))).toMatchObject({
      confirmLabel: 'Move and merge',
      message: expect.stringMatching(/^XYZ already has truck 22: the two become one truck/),
    });
    expect(moveTruckConfirm(truck, company('XYZ', ['7'])).confirmLabel).toBe('Move truck');
    expect(
      mergeCompanyConfirm(company('ACME', ['22', '25']), company('XYZ', ['22'])).items,
    ).toEqual(['2 trucks with their odometers and history', "22 become one truck with XYZ's"]);
  });
});
