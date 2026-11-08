import type { SourceFormatId } from '@haulbook/shared';
import type { UploadedFile } from '../common';
import { ezlogzImporter } from './ezlogz';
import { bellamspAnirImporter, hos247Importer } from './ifta-mileage-by-state';
import { swiftImporter, vistaEldImporter } from './ifta-spreadsheet';
import { motiveImporter } from './motive';
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
 * export the same layout (Bellfam ELD and HOS 247; Swift ELD and Vista ELD), and the file alone
 * can't tell them apart.
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

/** The likely period of a dateless file (Motive's distance summary), as YYYY-MM-DD. */
export function suggestedPeriod(
  format: SourceFormatId,
  name: string,
): { begin: string; end: string } | null {
  const period = IMPORTERS[format].suggestPeriod?.(name);
  if (!period) return null;
  const [begin, end] = period.map((d) => d.toISOString().slice(0, 10));
  return { begin, end };
}

/** The one format that recognises the file, or null when none or several do. */
export function detectFormat(file: UploadedFile): SourceFormatId | null {
  const formats = detectFormats(file);
  return formats.length === 1 ? formats[0] : null;
}
