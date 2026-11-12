import { z } from 'zod';
import { SourceFileSchema } from './sources';

/**
 * Source report(s) → ProMiles TRIPSUMMARY2 conversion. The file formats themselves
 * are specified in docs/data-contracts.md; these are the HTTP contracts around them.
 *
 *   POST /api/v1/conversions/preview  multipart: files[] (+ sources, odometers)  → ConversionPreview
 *   POST /api/v1/conversions          multipart: files[] (+ sources, odometers)  → ConversionResult
 *   GET  /api/v1/outputs                                                → OutputList
 *   GET  /api/v1/outputs/:name        → the CSV as an attachment
 */

/** Odometer reading: digits with optional decimals; thousands separators are stripped. */
export const OdometerReadingSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/,/g, ''))
  .pipe(z.string().regex(/^\d+(\.\d+)?$/, 'Odometer must be a number, e.g. 184310'));

/**
 * `{ [truckKey(company, unit)]: "<odometer at the start of the truck's first trip>" }` —
 * sent as a JSON string form field. Later months carry it forward (+ miles driven).
 */
export const OdometerMapSchema = z.record(z.string().trim().min(1), OdometerReadingSchema);
export type OdometerMap = z.infer<typeof OdometerMapSchema>;

/**
 * A truck's odometer saved at the end of its latest conversion. When no reading is
 * typed for the truck, it becomes the Begin Odo of the truck's first trip, as long
 * as that trip starts after `asOf` and its source file records no odometer of its own.
 */
export const SavedOdometerSchema = z.object({
  reading: z.string(),
  /** End date of the period it was measured at (M/D/YYYY). */
  asOf: z.string(),
});
export type SavedOdometer = z.infer<typeof SavedOdometerSchema>;

export const DistanceUnitSchema = z.enum(['M', 'K']);

/** One ProMiles trip = one truck (company + unit) × one month of a source report. */
export const TripSummarySchema = z.object({
  company: z.string(),
  /** The truck # from the source, and the unit # written to ProMiles (often the same). */
  unit: z.string(),
  promilesUnit: z.string(),
  /** The uploaded report it came from. */
  sourceFile: z.string(),
  /** Trip dates as written to the file (M/D/YYYY). */
  beginDate: z.string(),
  endDate: z.string(),
  beginOdo: z.string(),
  /** True when no reading was given for the unit and DEFAULT_BEGIN_ODO was used. */
  beginOdoIsPlaceholder: z.boolean(),
  distanceUnit: DistanceUnitSchema,
  /** State/province codes in leg order (first entry into each). */
  states: z.array(z.string()),
  /** Sum of the per-state legs. */
  totalDistance: z.number(),
  /** The report's own total for the period, when it has one. */
  reportedTotal: z.number().nullable(),
  /**
   * The source file's own odometer at the trip's start and end (Motive). Begin Odo is its
   * `begin` unless a reading was typed for the truck.
   */
  fileOdometer: z.object({ begin: z.string(), end: z.string() }).nullable(),
});
export type TripSummary = z.infer<typeof TripSummarySchema>;

/**
 * Always 200: per-file problems are in `files[].needs` / `files[].error`, problems
 * across files (e.g. the same truck + month twice) in `errors`. `trips` lists what
 * would be written for the files that are ready. `ready` = convert will succeed.
 */
export const ConversionPreviewSchema = z.object({
  files: z.array(SourceFileSchema),
  trips: z.array(TripSummarySchema),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
  ready: z.boolean(),
  /**
   * `{ [truckKey(company, unit)]: SavedOdometer }` for the trucks whose saved reading is
   * used, because none was typed. The portal shows it in place of the placeholder.
   */
  savedOdometers: z.record(z.string(), SavedOdometerSchema),
});
export type ConversionPreview = z.infer<typeof ConversionPreviewSchema>;

export const OutputFileSchema = z.object({
  name: z.string(),
  size: z.number().int(),
  createdAt: z.string().datetime(),
});
export type OutputFile = z.infer<typeof OutputFileSchema>;

export const SavedOutputSchema = OutputFileSchema.extend({
  company: z.string(),
  units: z.array(z.string()),
});
export type SavedOutput = z.infer<typeof SavedOutputSchema>;

export const ConversionResultSchema = ConversionPreviewSchema.extend({
  /** One ProMiles file per company (each is imported under that customer). */
  outputs: z.array(SavedOutputSchema),
  /** Host folder the files were saved in (OUTPUT_DIR from .env). */
  outputDir: z.string(),
});
export type ConversionResult = z.infer<typeof ConversionResultSchema>;

export const OutputListSchema = z.object({
  outputDir: z.string(),
  files: z.array(OutputFileSchema),
});
export type OutputList = z.infer<typeof OutputListSchema>;
