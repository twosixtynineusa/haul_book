import { z } from 'zod';

/**
 * Source formats the portal converts FROM — one importer per ELD/telematics
 * provider (docs/data-contracts.md). `available: false` = placeholder: listed so
 * the user can pick it, but its importer isn't built yet (see ROADMAP.md).
 */
export const SOURCE_FORMATS = [
  { id: 'wialon', label: 'Wialon — IFTA Single Unit Mileage Report', available: true },
  { id: 'ez-logs', label: 'EZ Logs', available: false },
  { id: 'motive', label: 'Motive Fleet', available: false },
  { id: 'vista-eld', label: 'Vista ELD', available: false },
] as const;

export const SourceFormatIdSchema = z.enum(['wialon', 'ez-logs', 'motive', 'vista-eld']);
export type SourceFormatId = z.infer<typeof SourceFormatIdSchema>;

export function sourceFormat(id: SourceFormatId) {
  return SOURCE_FORMATS.find((f) => f.id === id)!;
}

/** File types the dropzone and API accept (Excel for the providers still to come). */
export const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx', '.xls'] as const;

export const CompanyNameSchema = z.string().trim().min(1, 'Company name is required').max(100);
export const UnitNumberSchema = z
  .string()
  .trim()
  .min(1, 'Unit # is required')
  .max(40)
  .regex(/^[^/\\]+$/, 'Unit # cannot contain / or \\');

/**
 * What the user chose for one uploaded file (all optional — anything left out is
 * auto-detected). Sent as the `sources` form field: a JSON array aligned with `files[]`.
 */
export const SourceChoiceSchema = z.object({
  format: SourceFormatIdSchema.optional(),
  company: CompanyNameSchema.optional(),
  unit: UnitNumberSchema.optional(),
  /** Convert even though the company's earlier files came from another source format. */
  confirmSource: z.boolean().optional(),
});
export type SourceChoice = z.infer<typeof SourceChoiceSchema>;
export const SourceChoicesSchema = z.array(SourceChoiceSchema).max(100);

/**
 * `source`: the file's format isn't one the (saved) company has been converted
 * from before. It waits for the user to confirm the switch (`confirmSource`).
 */
export const SourceNeedSchema = z.enum(['format', 'company', 'unit', 'source']);
export type SourceNeed = z.infer<typeof SourceNeedSchema>;

/** How the API understood one uploaded file. */
export const SourceFileSchema = z.object({
  name: z.string(),
  format: SourceFormatIdSchema.nullable(),
  /** True when `format` came from auto-detection rather than the user's pick. */
  formatDetected: z.boolean(),
  company: z.string().nullable(),
  companyDetected: z.boolean(),
  unit: z.string().nullable(),
  unitDetected: z.boolean(),
  /** What the user still has to supply before this file can be converted. */
  needs: z.array(SourceNeedSchema),
  /** When `needs` has `source`: the formats the company was converted from so far. */
  knownSources: z.array(SourceFormatIdSchema),
  /** Why the file can't be read (bad data, importer not built yet, …). */
  error: z.string().nullable(),
});
export type SourceFile = z.infer<typeof SourceFileSchema>;

/** "Wialon" from "Wialon — IFTA Single Unit Mileage Report": the provider's short name. */
export function sourceName(id: SourceFormatId): string {
  return sourceFormat(id).label.split(' — ')[0];
}
