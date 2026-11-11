import { z } from 'zod';
import { OdometerReadingSchema } from './conversion';
import { CompanyNameSchema, SourceFormatIdSchema, UnitNumberSchema } from './sources';

/**
 * The saved companies and their trucks: the portal's pickers and its Companies
 * tab. Every successful conversion adds its companies and trucks; the tab edits
 * their details, renames, merges and deletes them.
 *
 *   GET    /api/v1/companies                          → CompanyList
 *   POST   /api/v1/companies               CompanyInput        → Company
 *   PATCH  /api/v1/companies/:id           CompanyUpdate       → Company
 *   DELETE /api/v1/companies/:id                              → 204
 *   POST   /api/v1/companies/:id/merge     CompanyMerge        → Company (the one kept)
 *   POST   /api/v1/companies/:id/trucks    TruckInput          → Company
 *   PATCH  /api/v1/companies/:id/trucks/:truckId  TruckUpdate  → Company
 *   DELETE /api/v1/companies/:id/trucks/:truckId              → Company
 *   POST   /api/v1/companies/:id/trucks/:truckId/move  TruckMove  → TruckMoved
 *
 * Dates without a time are `YYYY-MM-DD`.
 */

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-31');

/** Optional free text: blank means "not set" (null). */
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((s) => s || null);

export const TruckSchema = z.object({
  id: z.string(),
  unit: z.string(),
  vin: z.string().nullable(),
  plate: z.string().nullable(),
  notes: z.string().nullable(),
  /** Odometer at the end of the latest converted period; the next conversion starts there. */
  odometer: z.string().nullable(),
  odometerAsOf: IsoDateSchema.nullable(),
  /** Filled in by conversions. */
  lastSource: SourceFormatIdSchema.nullable(),
  lastPeriodEnd: IsoDateSchema.nullable(),
  lastConvertedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type Truck = z.infer<typeof TruckSchema>;

export const CompanySchema = z.object({
  id: z.string(),
  name: z.string(),
  /**
   * The one source format approved for this company (null = none yet: the next converted
   * file's format becomes it). A file from any other format waits for the user to confirm
   * the switch; confirming makes that format the approved one, replacing this.
   */
  source: SourceFormatIdSchema.nullable(),
  dotNumber: z.string().nullable(),
  iftaAccount: z.string().nullable(),
  contactName: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  notes: z.string().nullable(),
  trucks: z.array(TruckSchema),
  createdAt: z.string().datetime(),
  /** The latest conversion of any of its trucks. */
  lastConvertedAt: z.string().datetime().nullable(),
});
export type Company = z.infer<typeof CompanySchema>;

export const CompanyListSchema = z.object({
  companies: z.array(CompanySchema),
});
export type CompanyList = z.infer<typeof CompanyListSchema>;

const companyDetails = {
  dotNumber: text(20).optional(),
  iftaAccount: text(40).optional(),
  contactName: text(100).optional(),
  phone: text(40).optional(),
  email: z
    .string()
    .trim()
    .max(200)
    .refine((s) => s === '' || /^[^\s@]+@[^\s@]+$/.test(s), 'Enter a valid email address')
    .nullable()
    .transform((s) => s || null)
    .optional(),
  notes: text(2000).optional(),
};

export const CompanyInputSchema = z.object({ name: CompanyNameSchema, ...companyDetails });
export type CompanyInput = z.input<typeof CompanyInputSchema>;

export const CompanyUpdateSchema = z.object({
  name: CompanyNameSchema.optional(),
  ...companyDetails,
  /** Replaces the approved source; null clears it. */
  source: SourceFormatIdSchema.nullable().optional(),
});
export type CompanyUpdate = z.input<typeof CompanyUpdateSchema>;

/** Fold this company into `into` (e.g. two spellings of one carrier). */
export const CompanyMergeSchema = z.object({ into: z.string().min(1) });
export type CompanyMerge = z.infer<typeof CompanyMergeSchema>;

const truckDetails = {
  vin: text(17).optional(),
  plate: text(20).optional(),
  notes: text(2000).optional(),
  /** Set both to correct the saved odometer, or both to null to clear it. */
  odometer: z.union([OdometerReadingSchema, z.null()]).optional(),
  odometerAsOf: IsoDateSchema.nullable().optional(),
};

const sameOdometerFields = (t: { odometer?: string | null; odometerAsOf?: string | null }) =>
  (t.odometer === undefined) === (t.odometerAsOf === undefined) &&
  (t.odometer === null) === (t.odometerAsOf === null);
const ODOMETER_PAIR = {
  message: 'Give the odometer and its as-of date together',
  path: ['odometerAsOf'],
};

export const TruckInputSchema = z
  .object({ unit: UnitNumberSchema, ...truckDetails })
  .refine(sameOdometerFields, ODOMETER_PAIR);
export type TruckInput = z.input<typeof TruckInputSchema>;

export const TruckUpdateSchema = z
  .object({ unit: UnitNumberSchema.optional(), ...truckDetails })
  .refine(sameOdometerFields, ODOMETER_PAIR);
export type TruckUpdate = z.input<typeof TruckUpdateSchema>;

/**
 * Move a truck to company `into`, with its odometer, details and history. When `into`
 * already has a truck with that number, the two become one.
 */
export const TruckMoveSchema = z.object({ into: z.string().min(1) });
export type TruckMove = z.infer<typeof TruckMoveSchema>;

export const TruckMovedSchema = z.object({
  /** The company it left, and the one it joined, as saved now. */
  from: CompanySchema,
  into: CompanySchema,
  /** The truck in `into`: the same id, or the one it was merged into. */
  truckId: z.string(),
  merged: z.boolean(),
});
export type TruckMoved = z.infer<typeof TruckMovedSchema>;

/** Same company regardless of case/spacing ("acme trucking  llc" = "Acme Trucking LLC"). */
export function companyKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Key for per-truck values (odometers): a unit # is only unique within its company. */
export function truckKey(company: string, unit: string): string {
  return `${companyKey(company)}\u001f${unit.trim()}`;
}
