import type { SourceFormatId } from '@haulbook/shared';
import type { UploadedFile } from '../common';
import { ezLogsImporter, motiveImporter, vistaEldImporter } from './placeholders';
import type { Importer } from './types';
import { wialonImporter } from './wialon';

export type { Importer } from './types';

/** Every source format, keyed by its id in @haulbook/shared SOURCE_FORMATS. */
export const IMPORTERS: Record<SourceFormatId, Importer> = {
  wialon: wialonImporter,
  'ez-logs': ezLogsImporter,
  motive: motiveImporter,
  'vista-eld': vistaEldImporter,
};

/** The format whose `detect` recognises the file, or null when none does. */
export function detectFormat(file: UploadedFile): SourceFormatId | null {
  for (const importer of Object.values(IMPORTERS)) {
    try {
      if (importer.detect(file)) return importer.id;
    } catch {
      // A detector must never break detection for the others.
    }
  }
  return null;
}
