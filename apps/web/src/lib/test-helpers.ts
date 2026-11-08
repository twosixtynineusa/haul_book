import type { Company } from '@haulbook/shared';

/** A saved company for tests: Wialon-approved, with these unit #s and no details. */
export function company(name: string, units: string[] = [], extra: Partial<Company> = {}): Company {
  return {
    id: name,
    name,
    source: 'wialon',
    dotNumber: null,
    iftaAccount: null,
    contactName: null,
    phone: null,
    email: null,
    notes: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    lastConvertedAt: null,
    trucks: units.map((unit) => ({
      id: `${name}:${unit}`,
      unit,
      vin: null,
      plate: null,
      notes: null,
      odometer: null,
      odometerAsOf: null,
      lastSource: null,
      lastPeriodEnd: null,
      lastConvertedAt: null,
      createdAt: '2026-11-01T00:00:00.000Z',
    })),
    ...extra,
  };
}
