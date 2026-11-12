import type { InboxEntry } from '@haulbook/shared';

/** Short status words for the input folder lists. */
export const STATUS_LABEL: Record<InboxEntry['status'], string> = {
  waiting: 'Copying',
  processing: 'Converting',
  needs_input: 'Needs your input',
  failed: 'Can’t convert',
  converted: 'Converted',
  duplicate: 'Duplicate',
  dismissed: 'Set aside',
};

/** "ACME TRUCKING LLC · Truck 22" (or "Trucks 7, 31"): who a processed file was for. */
export function entryOwner(entry: Pick<InboxEntry, 'company' | 'unit' | 'units'>): string {
  const trucks =
    entry.units.length > 1
      ? `Trucks ${entry.units.join(', ')}`
      : entry.unit
        ? `Truck ${entry.unit}`
        : null;
  return [entry.company, trucks].filter(Boolean).join(' · ');
}
