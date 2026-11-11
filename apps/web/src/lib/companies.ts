import type { Company, CompanyUpdate, Truck, TruckUpdate } from '@haulbook/shared';

/** The company details edited as text on the Companies tab. */
export const DETAIL_FIELDS = [
  'name',
  'dotNumber',
  'iftaAccount',
  'contactName',
  'phone',
  'email',
  'notes',
] as const;
export type DetailField = (typeof DETAIL_FIELDS)[number];
export type DetailsDraft = Record<DetailField, string>;

export function detailsDraft(c: Company): DetailsDraft {
  return Object.fromEntries(DETAIL_FIELDS.map((f) => [f, c[f] ?? ''])) as DetailsDraft;
}

/** Only the fields the user changed; a cleared field is sent as null. */
export function changedDetails(c: Company, draft: DetailsDraft): CompanyUpdate {
  const update: Record<string, string | null> = {};
  for (const f of DETAIL_FIELDS) {
    const value = draft[f].trim();
    if (value !== (c[f] ?? '')) update[f] = f === 'name' ? value : value || null;
  }
  return update;
}

export const TRUCK_FIELDS = ['unit', 'vin', 'plate', 'odometer', 'odometerAsOf', 'notes'] as const;
export type TruckField = (typeof TRUCK_FIELDS)[number];
export type TruckDraft = Record<TruckField, string>;

export const EMPTY_TRUCK: TruckDraft = {
  unit: '',
  vin: '',
  plate: '',
  odometer: '',
  odometerAsOf: '',
  notes: '',
};

export function truckDraft(t: Truck): TruckDraft {
  return Object.fromEntries(TRUCK_FIELDS.map((f) => [f, t[f] ?? ''])) as TruckDraft;
}

/**
 * The truck fields to send: everything for a new truck (`base` undefined), else
 * only what changed. The odometer and its date always travel together.
 */
export function truckChanges(draft: TruckDraft, base?: Truck): TruckUpdate {
  const before = base ? truckDraft(base) : EMPTY_TRUCK;
  const out: Record<string, string | null> = {};
  for (const f of ['unit', 'vin', 'plate', 'notes'] as const) {
    const value = draft[f].trim();
    if (!base || value !== before[f]) out[f] = f === 'unit' ? value : value || null;
  }
  const odometer = draft.odometer.trim();
  const asOf = draft.odometerAsOf.trim();
  if (odometer !== before.odometer || asOf !== before.odometerAsOf) {
    if (odometer || asOf || base) {
      out.odometer = odometer || null;
      out.odometerAsOf = asOf || null;
    }
  }
  return out;
}

/**
 * The confirm before moving truck `unit` to `target`: says when `target` already has that
 * truck #, since the two then become one.
 */
export function moveConfirmText(unit: string, target: Company): string {
  const ends = 'ProMiles files already written are not changed.';
  return target.trucks.some((t) => t.unit === unit)
    ? `${target.name} already has truck ${unit}. Move it there and make the two one truck? ` +
        `The later odometer is kept, blank details are filled in, and both histories are kept. ${ends}`
    : `Move truck ${unit} to ${target.name}, with its odometer, details and history? ${ends}`;
}

/** Search by company name, USDOT #, or any truck's unit #, VIN or plate. */
export function filterCompanies(companies: Company[], query: string): Company[] {
  const q = query.trim().toLowerCase();
  if (!q) return companies;
  const has = (v: string | null) => !!v && v.toLowerCase().includes(q);
  return companies.filter(
    (c) =>
      has(c.name) ||
      has(c.dotNumber) ||
      c.trucks.some((t) => has(t.unit) || has(t.vin) || has(t.plate)),
  );
}

/** `2026-10-31` → `Oct 31, 2026` (a calendar date: no time zone shift). */
export function formatIsoDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
