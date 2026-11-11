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

const KEPT = 'The original report is kept.';

/** The confirm before deleting a processed row: says what goes with it. */
export function deleteEntryText(entry: Pick<InboxEntry, 'name' | 'status' | 'outputs'>): string {
  if (entry.status !== 'converted' || entry.outputs.length === 0) {
    return `Remove ${entry.name} from this list? ${KEPT}`;
  }
  const files = entry.outputs.length === 1 ? 'file' : 'files';
  return (
    `Delete ${entry.name}? Its ProMiles ${files} (${entry.outputs.join(', ')}) and its ` +
    `history are deleted too. ${KEPT}`
  );
}

/** The confirm before converting a processed file again. */
export function reprocessEntryText(entry: Pick<InboxEntry, 'name' | 'status'>): string {
  return entry.status === 'converted'
    ? `Convert ${entry.name} again? Its ProMiles file and history are replaced by the new ones.`
    : `Try ${entry.name} again?`;
}
