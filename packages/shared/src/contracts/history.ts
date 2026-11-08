import { z } from 'zod';
import { TruckSchema } from './companies';
import { DistanceUnitSchema } from './conversion';
import { SourceFormatIdSchema } from './sources';

/**
 * Conversion history: every source report written to a ProMiles file, one row per truck per
 * source file (a file with several trucks gives several rows), newest first.
 *
 *   GET /api/v1/history[?companyId=…][&truckId=…][&limit=…]  → HistoryList
 *   GET /api/v1/trucks/:truckId                             → TruckDetail
 *
 * Dates without a time are `YYYY-MM-DD`.
 */

const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const HistoryOriginSchema = z.enum(['portal', 'inbox']);
export type HistoryOrigin = z.infer<typeof HistoryOriginSchema>;

/** One ProMiles trip of a converted report (usually a month). */
export const HistoryTripSchema = z.object({
  beginDate: IsoDateSchema,
  endDate: IsoDateSchema,
  /** Null when no reading was typed, saved or in the file (ProMiles got the placeholder). */
  beginOdo: z.string().nullable(),
  endOdo: z.string().nullable(),
  distance: z.number(),
  states: z.array(z.string()),
});
export type HistoryTrip = z.infer<typeof HistoryTripSchema>;

export const HistoryEntrySchema = z.object({
  id: z.string(),
  convertedAt: z.string().datetime(),
  /** Converted from the portal's upload, or from the watched input folder. */
  origin: HistoryOriginSchema,
  /** As written at the time; the ids are null once the company or truck is deleted. */
  company: z.string(),
  companyId: z.string().nullable(),
  unit: z.string(),
  truckId: z.string().nullable(),
  source: SourceFormatIdSchema.nullable(),
  sourceFile: z.string(),
  outputFile: z.string(),
  /** First trip's begin → last trip's end. */
  beginDate: IsoDateSchema,
  endDate: IsoDateSchema,
  /** Odometer at the start of the first trip and the end of the last (null = not known). */
  beginOdo: z.string().nullable(),
  endOdo: z.string().nullable(),
  /** Total of every trip's state legs. */
  distance: z.number(),
  distanceUnit: DistanceUnitSchema,
  /** Every state driven, in order of first entry. */
  states: z.array(z.string()),
  trips: z.array(HistoryTripSchema),
});
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export const HistoryListSchema = z.object({
  entries: z.array(HistoryEntrySchema),
  /** True when there are older entries than the `limit` returned. */
  more: z.boolean(),
});
export type HistoryList = z.infer<typeof HistoryListSchema>;

export const HistoryQuerySchema = z.object({
  companyId: z.string().min(1).optional(),
  truckId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});
export type HistoryQuery = z.input<typeof HistoryQuerySchema>;

/** One truck with its company and every conversion of it: the unit # links open this. */
export const TruckDetailSchema = z.object({
  company: z.object({
    id: z.string(),
    name: z.string(),
    source: SourceFormatIdSchema.nullable(),
  }),
  truck: TruckSchema,
  history: z.array(HistoryEntrySchema),
});
export type TruckDetail = z.infer<typeof TruckDetailSchema>;
