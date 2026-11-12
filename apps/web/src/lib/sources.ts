import {
  companyKey,
  sourceName,
  type Company,
  type CompanyOrigin,
  type Period,
  type SourceChoice,
  type SourceFile,
  type SourceFormatId,
} from '@haulbook/shared';
import { formatIsoDate } from './companies';

/**
 * What the user has set for one dropped file. `undefined` = not touched: the
 * API's detection (shown in the field) stands. An empty string = cleared on
 * purpose, which is sent as "not given" so the API asks for it again.
 */
export interface SourceDraft {
  format?: SourceFormatId;
  company?: string;
  unit?: string;
  /** For a file with no dates of its own; sent once both ends are filled in. */
  period?: { begin: string; end: string };
  /** The user confirmed converting from a source other than the company's approved one. */
  confirmSource?: boolean;
  /** The unit # ProMiles gets per new truck (truck # → ProMiles unit #). */
  promilesUnits?: Record<string, string>;
}

/**
 * The trucks of a file whose ProMiles unit # the portal asks for: the new ones the API
 * reports, and those it already has an entry for (they stop being "new" once sent).
 */
export function askedTrucks(source: SourceFile, draft: SourceDraft): string[] {
  const entered = Object.keys(draft.promilesUnits ?? {});
  const trucks = source.units.length > 0 ? source.units : source.unit ? [source.unit] : [];
  return trucks.filter((t) => source.newTrucks.includes(t) || entered.includes(t));
}

/**
 * New trucks the API reports with nothing entered yet, offered as their own truck # (the
 * user sees the field and can change it before converting). Undefined when there's none.
 */
export function offeredProMilesUnits(
  source: SourceFile,
  draft: SourceDraft,
): Record<string, string> | undefined {
  const missing = source.newTrucks.filter((t) => draft.promilesUnits?.[t] === undefined);
  if (missing.length === 0) return undefined;
  return {
    ...draft.promilesUnits,
    ...Object.fromEntries(missing.map((t) => [t, source.promilesUnits[t] ?? t])),
  };
}

/** Stable identity for a dropped file (same rule as the duplicate check). */
export function fileKey(file: { name: string; size: number }): string {
  return `${file.name}:${file.size}`;
}

/**
 * The drafts with every new truck's ProMiles unit # offered (offeredProMilesUnits); the
 * same object when nothing was missing, so a re-check doesn't loop.
 */
export function withOfferedProMilesUnits(
  drafts: Record<string, SourceDraft>,
  files: { name: string; size: number }[],
  sources: SourceFile[],
): Record<string, SourceDraft> {
  let next = drafts;
  files.forEach((file, i) => {
    const source = sources[i];
    if (source?.name !== file.name) return;
    const key = fileKey(file);
    const offered = offeredProMilesUnits(source, drafts[key] ?? {});
    if (offered) next = { ...next, [key]: { ...drafts[key], promilesUnits: offered } };
  });
  return next;
}

/** The `sources` field for the API: only what the user actually set, trimmed. */
export function toChoices(drafts: SourceDraft[]): SourceChoice[] {
  return drafts.map(({ format, company, unit, period, confirmSource, promilesUnits }) => {
    const entered = Object.entries(promilesUnits ?? {})
      .map(([truck, value]) => [truck, value.trim()] as const)
      .filter(([, value]) => value);
    return {
      ...(format ? { format } : {}),
      ...(company?.trim() ? { company: company.trim() } : {}),
      ...(unit?.trim() ? { unit: unit.trim() } : {}),
      ...(period?.begin && period.end ? { period } : {}),
      ...(confirmSource ? { confirmSource } : {}),
      ...(entered.length > 0 ? { promilesUnits: Object.fromEntries(entered) } : {}),
    };
  });
}

/** The value a field shows: the user's text if they touched it, else what the API found. */
export function shownValue(draft: string | undefined, found: string | null | undefined): string {
  return draft !== undefined ? draft : (found ?? '');
}

/** The saved company typed/picked in a row (case/spacing-insensitive), if any. */
export function savedCompany(companies: Company[], company: string): Company | undefined {
  const key = companyKey(company);
  return key ? companies.find((c) => companyKey(c.name) === key) : undefined;
}

/** Units saved for the company typed/picked in a row. */
export function unitsFor(companies: Company[], company: string): string[] {
  return savedCompany(companies, company)?.trucks.map((t) => t.unit) ?? [];
}

/** A pick list entry: the value it fills in, and a hint shown beside it. */
export interface PickOption {
  value: string;
  hint?: string;
}

/**
 * The company list: every saved company with its approved source and truck count. When
 * the file's unit # is saved under several companies, those come first.
 */
export function companyOptions(companies: Company[], preferred: string[] = []): PickOption[] {
  const first = new Set(preferred.map(companyKey));
  const option = (c: Company): PickOption => ({
    value: c.name,
    hint: [
      first.has(companyKey(c.name)) ? 'has this truck #' : null,
      c.source ? sourceName(c.source) : null,
      `${c.trucks.length} truck${c.trucks.length === 1 ? '' : 's'}`,
    ]
      .filter(Boolean)
      .join(' · '),
  });
  return [
    ...companies.filter((c) => first.has(companyKey(c.name))).map(option),
    ...companies.filter((c) => !first.has(companyKey(c.name))).map(option),
  ];
}

/**
 * The unit list: the chosen company's trucks; with no (saved) company, every saved truck,
 * hinted with its company, so picking one lets its company be matched from the unit #.
 */
export function unitOptions(companies: Company[], company: string): PickOption[] {
  const saved = savedCompany(companies, company);
  if (saved) return saved.trucks.map((t) => ({ value: t.unit }));
  const byUnit = new Map<string, string[]>();
  for (const c of companies) {
    for (const t of c.trucks) byUnit.set(t.unit, [...(byUnit.get(t.unit) ?? []), c.name]);
  }
  return [...byUnit]
    .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
    .map(([value, names]) => ({ value, hint: names.join(', ') }));
}

/** The badge beside a company the API filled in. */
export function companyOriginLabel(origin: CompanyOrigin | null | undefined): string | null {
  switch (origin) {
    case 'file':
      return 'from file';
    case 'folder':
      return 'from folder';
    case 'unit':
      return 'by truck #';
    default:
      return null;
  }
}

/** A unit # saved under several companies: "Truck 22 is saved under ACME and XYZ: pick…". */
export function companyChoiceText(unit: string, options: string[]): string {
  const names =
    options.length === 2
      ? `${options[0]} and ${options[1]}`
      : options.slice(0, -1).join(', ') + `, and ${options[options.length - 1]}`;
  return `${unit ? `Truck ${unit} is` : 'These trucks are'} saved under ${names}: pick which company this file is for.`;
}

/**
 * The warning for a file whose format isn't its company's approved source, e.g. "ACME LLC
 * was imported from Wialon until now; this file is from Ezlogz."
 */
export function sourceSwitchText(
  company: string | null,
  format: SourceFormatId | null,
  known: SourceFormatId | null,
): string {
  const before = known ? sourceName(known) : 'another source';
  const now = format ? sourceName(format) : 'a different source';
  return `${company ?? 'This company'} was imported from ${before} until now; this file is from ${now}.`;
}

/** True when the API says this file still needs something or can't be read. */
export function needsAttention(file: SourceFile | undefined): boolean {
  return !!file && (file.needs.length > 0 || !!file.error);
}

/** For a file several sources export identically: "…either Bellfam ELD or HOS 247 — pick which." */
export function formatChoiceText(options: SourceFormatId[]): string {
  const names = options.map(sourceName);
  const list =
    names.length === 2 ? `either ${names[0]} or ${names[1]}` : `one of ${names.join(', ')}`;
  return `This layout is exported by ${list}, and nothing says which: pick the system it came from.`;
}

/** `Oct 1, 2026 – Oct 31, 2026`. */
export function periodText(period: Period): string {
  return `${formatIsoDate(period.begin)} – ${formatIsoDate(period.end)}`;
}
