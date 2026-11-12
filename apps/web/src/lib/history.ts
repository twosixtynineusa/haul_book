import { sourceName, type HistoryEntry } from '@haulbook/shared';
import { formatIsoDate } from './companies';

/** `431,000` — an odometer as written in the history, or a dash when it isn't known. */
export function formatOdo(odo: string | null): string {
  return odo === null ? '—' : Number(odo).toLocaleString('en-US', { maximumFractionDigits: 1 });
}

/** `Oct 1 – Nov 30, 2026`, or `Oct 1, 2025 – Jan 31, 2026` across a year end. */
export function rangeText(begin: string, end: string): string {
  if (begin === end) return formatIsoDate(begin);
  const sameYear = begin.slice(0, 4) === end.slice(0, 4);
  const from = sameYear ? formatIsoDate(begin).replace(/, \d{4}$/, '') : formatIsoDate(begin);
  return `${from} – ${formatIsoDate(end)}`;
}

/** Search by company, unit #, source, file names or state. */
export function filterHistory(entries: HistoryEntry[], query: string): HistoryEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  const has = (v: string | null) => !!v && v.toLowerCase().includes(q);
  return entries.filter(
    (e) =>
      has(e.company) ||
      has(e.unit) ||
      has(e.promilesUnit) ||
      has(e.source && sourceName(e.source)) ||
      has(e.sourceFile) ||
      has(e.outputFile) ||
      e.states.some((s) => s.toLowerCase() === q),
  );
}

/** What a list of reports adds up to: how many, the miles per unit, the dates covered. */
export function historyTotals(entries: HistoryEntry[]) {
  const miles = { M: 0, K: 0 };
  for (const e of entries) miles[e.distanceUnit] += e.distance;
  const begins = entries.map((e) => e.beginDate).sort();
  const ends = entries.map((e) => e.endDate).sort();
  return {
    reports: entries.length,
    miles: Math.round(miles.M * 100) / 100,
    km: Math.round(miles.K * 100) / 100,
    from: begins[0] ?? null,
    to: ends[ends.length - 1] ?? null,
  };
}
