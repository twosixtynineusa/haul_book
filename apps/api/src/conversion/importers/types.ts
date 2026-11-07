import type { SourceFormatId } from '@haulbook/shared';
import type { SourceReport, UploadedFile } from '../common';

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
  /** Full parse; throws ConversionError with a reason the user can act on. */
  read(file: UploadedFile, warnings: string[]): SourceReport;
}
