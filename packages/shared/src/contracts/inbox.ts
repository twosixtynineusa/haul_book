import { z } from 'zod';
import { PeriodSchema, SourceFormatIdSchema, SourceNeedSchema } from './sources';

/**
 * The watched input folder (INPUT_DIR). The worker scans it every
 * INPUT_SCAN_SECONDS, converts what it can and archives the source; files that
 * need a format / company / unit # / period wait here until the user fills them in,
 * and files from a source other than their company's approved one wait for the user
 * to confirm it.
 *
 *   GET   /api/v1/inbox              → InboxList
 *   PATCH /api/v1/inbox/:id          body: SourceChoice  → InboxEntry (converted or still waiting)
 *   POST  /api/v1/inbox/:id/retry                        → InboxEntry
 *   POST  /api/v1/inbox/:id/dismiss  (moves the file to failed/) → InboxEntry
 *   POST  /api/v1/inbox/scan         (queue a scan now)   → 202
 *
 * A processed file (converted / duplicate / dismissed) can be undone:
 *
 *   POST   /api/v1/inbox/:id/reprocess  body: SourceChoice (may be {})  → InboxEntry
 *          (its source goes back into the input folder and converts again, with the body as
 *          the user's entry; the ProMiles file(s) and history it produced before are deleted)
 *   DELETE /api/v1/inbox/:id            → 204 (the row, its ProMiles file(s) and its history;
 *          the archived source stays)
 */
export const InboxStatusSchema = z.enum([
  'waiting',
  'processing',
  'needs_input',
  'failed',
  'converted',
  'duplicate',
  'dismissed',
]);
export type InboxStatus = z.infer<typeof InboxStatusSchema>;

/** Statuses whose file is still in the input folder. */
export const ACTIVE_INBOX_STATUSES = ['waiting', 'processing', 'needs_input', 'failed'] as const;

export const InboxEntrySchema = z.object({
  id: z.string(),
  /** Relative to INPUT_DIR — the file's place while active, its last place once final. */
  path: z.string(),
  name: z.string(),
  status: InboxStatusSchema,
  format: SourceFormatIdSchema.nullable(),
  /** When `needs` has `format` because several sources share this file's layout: the candidates. */
  formatOptions: z.array(SourceFormatIdSchema),
  company: z.string().nullable(),
  /** When `needs` has `company` because its unit # is saved under several companies: those. */
  companyOptions: z.array(z.string()),
  unit: z.string().nullable(),
  /** When the file holds several trucks: their unit #s (`unit` is then null). Else empty. */
  units: z.array(z.string()),
  /** The ProMiles unit # entered per truck (truck # → ProMiles unit #). */
  promilesUnits: z.record(z.string(), z.string()),
  /** When `needs` has `promilesUnit`: the trucks whose ProMiles unit # to confirm. */
  newTrucks: z.array(z.string()),
  /** For a file with no dates of its own: the period entered (else null), and a likely one. */
  period: PeriodSchema.nullable(),
  suggestedPeriod: PeriodSchema.nullable(),
  needs: z.array(SourceNeedSchema),
  /** When `needs` has `source`: the company's approved source. */
  knownSource: SourceFormatIdSchema.nullable(),
  error: z.string().nullable(),
  /** ProMiles file(s) written to OUTPUT_DIR. */
  outputs: z.array(z.string()),
  /** Where the source was moved, relative to INPUT_DIR (archive/… or failed/…). */
  archivedPath: z.string().nullable(),
  createdAt: z.string().datetime(),
  processedAt: z.string().datetime().nullable(),
});
export type InboxEntry = z.infer<typeof InboxEntrySchema>;

export const InboxListSchema = z.object({
  /** The watched folder as the user knows it on this machine (INPUT_DIR). */
  inputDir: z.string(),
  scanSeconds: z.number().int(),
  /** Still in the input folder: waiting to settle, needing input, or failed. */
  pending: z.array(InboxEntrySchema),
  /** The latest converted / duplicate / dismissed files, newest first. */
  recent: z.array(InboxEntrySchema),
});
export type InboxList = z.infer<typeof InboxListSchema>;
