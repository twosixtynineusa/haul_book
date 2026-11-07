import type { SourceFormatId } from '@haulbook/shared';
import type { UploadedFile } from '../common';
import { ezlogzImporter } from './ezlogz';
import { bellamspAnirImporter, hos247Importer } from './ifta-mileage-by-state';
import { motiveImporter, swiftImporter, vistaEldImporter } from './placeholders';
import type { Importer } from './types';
import { wialonImporter } from './wialon';

export type { Importer } from './types';

/** Every source format, keyed by its id in @haulbook/shared SOURCE_FORMATS. */
export const IMPORTERS: Record<SourceFormatId, Importer> = {
  wialon: wialonImporter,
  'bellamsp-anir': bellamspAnirImporter,
  ezlogz: ezlogzImporter,
  hos247: hos247Importer,
  motive: motiveImporter,
  swift: swiftImporter,
  'vista-eld': vistaEldImporter,
};

/**
 * Every format whose `detect` recognises the file. Usually one; several when providers
 * export the same layout (BELLAMSP-ANIR and HOS247), and the file alone can't tell them apart.
 */
export function detectFormats(file: UploadedFile): SourceFormatId[] {
  return Object.values(IMPORTERS)
    .filter((importer) => {
      try {
        return importer.detect(file);
      } catch {
        return false; // A detector must never break detection for the others.
      }
    })
    .map((importer) => importer.id);
}

/** The one format that recognises the file, or null when none or several do. */
export function detectFormat(file: UploadedFile): SourceFormatId | null {
  const formats = detectFormats(file);
  return formats.length === 1 ? formats[0] : null;
}
