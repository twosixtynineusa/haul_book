import { z } from 'zod';

/**
 * Source formats the portal converts FROM — one importer per ELD/telematics
 * provider (docs/data-contracts.md). `available: false` = placeholder: listed so
 * the user can pick it, but its importer isn't built yet (see ROADMAP.md).
 */
export const SOURCE_FORMATS = [
  { id: 'wialon', label: 'Wialon — IFTA Single Unit Mileage Report', available: true },
  // Ids are stored in Postgres (each company's approved source), so they never change, even when
  // a label does: 'bellamsp-anir' is Bellfam ELD.
  { id: 'bellamsp-anir', label: 'Bellfam ELD — IFTA Mileage By State', available: true },
  { id: 'ezlogz', label: 'Ezlogz — Mileage Report', available: true },
  { id: 'hos247', label: 'HOS 247 — IFTA Mileage By State', available: true },
  { id: 'motive', label: 'Motive — IFTA Trip Report or Distance Summary', available: true },
  { id: 'swift', label: 'Swift ELD — IFTA Report (Excel)', available: true },
  { id: 'vista-eld', label: 'Vista ELD — IFTA Report (Excel)', available: true },
] as const;

export const SourceFormatIdSchema = z.enum([
  'wialon',
  'bellamsp-anir',
  'ezlogz',
  'hos247',
  'motive',
  'swift',
  'vista-eld',
]);
export type SourceFormatId = z.infer<typeof SourceFormatIdSchema>;

export function sourceFormat(id: SourceFormatId) {
  return SOURCE_FORMATS.find((f) => f.id === id)!;
}

/** File types the dropzone and API accept (Swift ELD and Vista ELD export legacy Excel .xls). */
export const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx', '.xls'] as const;

export const CompanyNameSchema = z.string().trim().min(1, 'Company name is required').max(100);
export const UnitNumberSchema = z
  .string()
  .trim()
  .min(1, 'Unit # is required')
  .max(40)
  .regex(/^[^/\\]+$/, 'Unit # cannot contain / or \\');

const IsoDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-31');

/**
 * The dates a report covers (`YYYY-MM-DD`, both included). Only asked for a file that
 * carries no dates of its own (Motive's distance summary); it becomes one trip, so it must
 * stay inside one IFTA quarter.
 */
export const PeriodSchema = z
  .object({ begin: IsoDaySchema, end: IsoDaySchema })
  .refine((p) => p.begin <= p.end, { message: 'The period ends before it begins', path: ['end'] })
  .refine((p) => quarterOf(p.begin) === quarterOf(p.end), {
    message: 'The period must stay inside one quarter (one trip per quarter at most)',
    path: ['end'],
  });
export type Period = z.infer<typeof PeriodSchema>;

/** `2026-11-07` → `2026-Q4`. */
export function quarterOf(isoDay: string): string {
  const [y, m] = isoDay.split('-').map(Number);
  return `${y}-Q${Math.ceil(m / 3)}`;
}

/**
 * What the user chose for one uploaded file (all optional — anything left out is
 * auto-detected). Sent as the `sources` form field: a JSON array aligned with `files[]`.
 */
export const SourceChoiceSchema = z.object({
  format: SourceFormatIdSchema.optional(),
  company: CompanyNameSchema.optional(),
  unit: UnitNumberSchema.optional(),
  /** For a file with no dates of its own (Motive's distance summary): the dates it covers. */
  period: PeriodSchema.optional(),
  /**
   * Convert even though the company's approved source is another format. Converting then
   * makes this file's format the company's approved source (it replaces the old one).
   */
  confirmSource: z.boolean().optional(),
});
export type SourceChoice = z.infer<typeof SourceChoiceSchema>;
export const SourceChoicesSchema = z.array(SourceChoiceSchema).max(100);

/**
 * `source`: the file's format isn't the (saved) company's approved source. It waits for the
 * user to confirm the switch (`confirmSource`).
 * `period`: the file has no dates (Motive's distance summary); the user gives them.
 */
export const SourceNeedSchema = z.enum(['format', 'company', 'unit', 'period', 'source']);
export type SourceNeed = z.infer<typeof SourceNeedSchema>;

/**
 * Where a file's company came from: typed/picked by the user, the file itself, the input
 * sub-folder it was dropped in, or the one saved company that runs its unit #(s).
 */
export const CompanyOriginSchema = z.enum(['user', 'file', 'folder', 'unit']);
export type CompanyOrigin = z.infer<typeof CompanyOriginSchema>;

/** How the API understood one uploaded file. */
export const SourceFileSchema = z.object({
  name: z.string(),
  format: SourceFormatIdSchema.nullable(),
  /**
   * True when `format` came from auto-detection (or from the company's approved source)
   * rather than the user's pick.
   */
  formatDetected: z.boolean(),
  /**
   * Several sources export this file's exact layout (Bellfam ELD and HOS 247; Swift ELD and
   * Vista ELD) and nothing
   * settled which: the candidates, and `needs` has `format`. When the file's company has
   * one of them as its approved source, that one is used instead (`format` set, this empty).
   */
  formatOptions: z.array(SourceFormatIdSchema),
  company: z.string().nullable(),
  companyOrigin: CompanyOriginSchema.nullable(),
  /**
   * No company in the file, and its unit # is saved under several companies: the
   * candidates, and `needs` has `company`. The user picks (or types) the right one.
   */
  companyOptions: z.array(z.string()),
  unit: z.string().nullable(),
  unitDetected: z.boolean(),
  /**
   * When the file holds several trucks (Motive): their unit #s, read from the file. Each
   * converts as its own truck, `unit` is null, and a typed unit # is ignored. Else empty.
   */
  units: z.array(z.string()),
  /** The dates used for a file that has none of its own (else null). */
  period: PeriodSchema.nullable(),
  /** For such a file: a likely period (the month before it was exported), to offer the user. */
  suggestedPeriod: PeriodSchema.nullable(),
  /** What the user still has to supply before this file can be converted. */
  needs: z.array(SourceNeedSchema),
  /** When `needs` has `source`: the company's approved source. */
  knownSource: SourceFormatIdSchema.nullable(),
  /** Why the file can't be read (bad data, importer not built yet, …). */
  error: z.string().nullable(),
});
export type SourceFile = z.infer<typeof SourceFileSchema>;

/** "Wialon" from "Wialon — IFTA Single Unit Mileage Report": the provider's short name. */
export function sourceName(id: SourceFormatId): string {
  return sourceFormat(id).label.split(' — ')[0];
}
