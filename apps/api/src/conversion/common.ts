/**
 * Shared building blocks for every source importer (importers/*) and the
 * ProMiles writer (promiles.ts): the intermediate trip model plus parsers for
 * the values every provider reports — states, dates, distances.
 */

export class ConversionError extends Error {}

export type DistanceUnit = 'M' | 'K';

/** A raw upload: importers sniff and parse the bytes (CSV today, Excel later). */
export interface UploadedFile {
  name: string;
  bytes: Buffer;
}

/** Miles/km driven in one state during one trip period. */
export interface Leg {
  state: string;
  /** First entry into the state — legs are written in this order. */
  begin: Date;
  end: Date;
  distance: string;
}

/** One reporting period (usually a month) of one truck. */
export interface PeriodTrip {
  /** Null when the report gives no period; the writer then uses the leg dates. */
  period: [Date, Date] | null;
  /** The source's own total for the period, used as a cross-check. */
  reportedTotal: number | null;
  legs: Leg[];
  /**
   * The truck's odometer at the start and end of the period, when the source records it
   * (Motive). Begin Odo uses it unless a reading is typed for the truck.
   */
  odometer?: { begin: number; end: number } | null;
}

/** One truck of a file that holds several (see SourceReport.trucks). */
export interface ReportTruck {
  unit: string;
  trips: PeriodTrip[];
}

/** A truck's odometer where an earlier conversion ended (Unit.odometer in Postgres). */
export interface SavedReading {
  reading: number;
  /** End date of that period, as a UTC midnight date. */
  asOf: Date;
}

/** What an importer extracts from one file. */
export interface SourceReport {
  trips: PeriodTrip[];
  distanceUnit: DistanceUnit;
  /** Found in the file or its name; null = the user must supply it. */
  detectedUnit: string | null;
  detectedCompany: string | null;
  /**
   * Set when the file holds several trucks (Motive): each one's unit # and trips, converted
   * as separate trucks. `trips` is then empty and `detectedUnit` null.
   */
  trucks?: ReportTruck[];
}

// prettier-ignore
const JURISDICTIONS: Record<string, string> = {
  // US states + DC
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN',
  iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY',
  // Canadian provinces/territories (IFTA members)
  alberta: 'AB', 'british columbia': 'BC', manitoba: 'MB', 'new brunswick': 'NB',
  'newfoundland and labrador': 'NL', newfoundland: 'NL', 'nova scotia': 'NS', ontario: 'ON',
  'prince edward island': 'PE', quebec: 'QC', québec: 'QC', saskatchewan: 'SK',
  'northwest territories': 'NT', nunavut: 'NU', yukon: 'YT',
};
const CODES = new Set(Object.values(JURISDICTIONS));

// prettier-ignore
export const MONTHS = new Set([
  'january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december',
]);

const DISTANCE_RE = /^\s*([\d,]+(?:\.\d+)?)\s*(mi|km)?\s*$/i;
// YYYY-MM-DD [HH:MM[:SS]]  or  M/D/YYYY [H:MM[:SS]]
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[\sT](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const US_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

/** Exports are often in a Windows codepage; accept UTF-8 too in case a file was re-saved. */
export function decodeText(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return bytes.toString('latin1');
  }
}

export function tryParseDate(value: string): Date | null {
  const v = value.trim();
  const iso = ISO_DATE_RE.exec(v);
  const us = iso ? null : US_DATE_RE.exec(v);
  // Normalised to [year, month, day, hour, minute, second].
  const parts = iso ? iso.slice(1, 7) : us ? [us[3], us[1], us[2], us[4], us[5], us[6]] : null;
  if (!parts) return null;
  const [y, mo, d, h, mi, s] = parts.map((p) => Number(p ?? 0));
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  const valid =
    date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && h < 24 && mi < 60 && s < 60;
  return valid ? date : null;
}

/** Dates are wall-clock values with no zone; they're held as UTC so the host TZ never shifts them. */
export function parseDate(value: string, where: string): Date {
  const date = tryParseDate(value);
  if (!date) throw new ConversionError(`${where}: unrecognised date "${value}"`);
  return date;
}

export function parseDistance(value: string, where: string): [string, DistanceUnit | null] {
  const m = DISTANCE_RE.exec(value);
  if (!m) throw new ConversionError(`${where}: unrecognised distance "${value}"`);
  let number = m[1].replace(/,/g, '');
  if (number.includes('.')) number = number.replace(/0+$/, '').replace(/\.$/, '');
  const suffix = m[2]?.toLowerCase();
  return [number, suffix ? (suffix === 'mi' ? 'M' : 'K') : null];
}

export function stateCode(name: string): string | null {
  const key = name.trim().toLowerCase().split(/\s+/).join(' ');
  if (CODES.has(key.toUpperCase())) return key.toUpperCase();
  return JURISDICTIONS[key] ?? null;
}

export function sumLegs(legs: Leg[]): number {
  return legs.reduce((total, leg) => total + Number(leg.distance), 0);
}

/** Beyond rounding: sources round each total independently, so allow max(5, 1%). */
export function totalsDisagree(summed: number, reported: number): boolean {
  return Math.abs(summed - reported) > Math.max(5, reported * 0.01);
}
