import type { SourceFormatId } from '@haulbook/shared';
import type { ReadOptions, SourceReport, UploadedFile } from '../common';

/**
 * One source format (ELD / telematics provider). To add a provider: implement
 * this in `importers/<provider>.ts`, register it in `importers/index.ts`, flip
 * its `available` flag in @haulbook/shared SOURCE_FORMATS, and document the
 * format in docs/data-contracts.md with a real sample as a test fixture.
 */
export interface Importer {
  id: SourceFormatId;
  /** Cheap check on the raw upload: is this file in my format? Must never throw. */
  detect(file: UploadedFile): boolean;
  /**
   * Full parse; throws ConversionError with a reason the user can act on. A format with no
   * dates of its own uses `options.period`, and without one returns `needsPeriod`.
   */
  read(file: UploadedFile, warnings: string[], options?: ReadOptions): SourceReport;
  /** For a format with no dates: the likely period of a file with this name, if any. */
  suggestPeriod?(name: string): [Date, Date] | null;
}
