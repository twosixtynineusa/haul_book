import {
  companyKey,
  sourceName,
  type Company,
  type SourceChoice,
  type SourceFile,
  type SourceFormatId,
} from '@haulbook/shared';

/**
 * What the user has set for one dropped file. `undefined` = not touched: the
 * API's detection (shown in the field) stands. An empty string = cleared on
 * purpose, which is sent as "not given" so the API asks for it again.
 */
export interface SourceDraft {
  format?: SourceFormatId;
  company?: string;
  unit?: string;
  /** The user confirmed converting from a source new for the company. */
  confirmSource?: boolean;
}

/** Stable identity for a dropped file (same rule as the duplicate check). */
export function fileKey(file: { name: string; size: number }): string {
  return `${file.name}:${file.size}`;
}

/** The `sources` field for the API: only what the user actually set, trimmed. */
export function toChoices(drafts: SourceDraft[]): SourceChoice[] {
  return drafts.map(({ format, company, unit, confirmSource }) => ({
    ...(format ? { format } : {}),
    ...(company?.trim() ? { company: company.trim() } : {}),
    ...(unit?.trim() ? { unit: unit.trim() } : {}),
    ...(confirmSource ? { confirmSource } : {}),
  }));
}

/** The value a field shows: the user's text if they touched it, else what the API found. */
export function shownValue(draft: string | undefined, found: string | null | undefined): string {
  return draft !== undefined ? draft : (found ?? '');
}

/** Units saved for the company typed/picked in a row (case/spacing-insensitive). */
export function unitsFor(companies: Company[], company: string): string[] {
  const key = companyKey(company);
  const found = key ? companies.find((c) => companyKey(c.name) === key) : undefined;
  return found?.trucks.map((t) => t.unit) ?? [];
}

/**
 * The warning for a file whose format is new for its company, e.g. "ACME LLC was
 * imported from Wialon until now; this file is from EZ Logs."
 */
export function sourceSwitchText(
  company: string | null,
  format: SourceFormatId | null,
  known: SourceFormatId[],
): string {
  const before = known.map(sourceName).join(' or ') || 'another source';
  const now = format ? sourceName(format) : 'a different source';
  return `${company ?? 'This company'} was imported from ${before} until now; this file is from ${now}.`;
}

/** True when the API says this file still needs something or can't be read. */
export function needsAttention(file: SourceFile | undefined): boolean {
  return !!file && (file.needs.length > 0 || !!file.error);
}
