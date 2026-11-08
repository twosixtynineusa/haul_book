import { sourceFormat, type SourceFormatId } from '@haulbook/shared';
import { ConversionError } from '../common';
import type { Importer } from './types';

/**
 * Providers whose export formats aren't built yet (ROADMAP.md → "Source
 * importers"). They're listed in the portal so a file can be tagged with them,
 * but they never auto-detect and reading one explains it isn't supported yet.
 */
function placeholder(id: SourceFormatId): Importer {
  const { label } = sourceFormat(id);
  return {
    id,
    detect: () => false,
    read(file) {
      throw new ConversionError(
        `${file.name}: ${label} files can't be converted yet — that importer is still to be ` +
          `built (ROADMAP.md). Send a sample export so it can be added.`,
      );
    },
  };
}

export const swiftImporter = placeholder('swift');
export const vistaEldImporter = placeholder('vista-eld');
