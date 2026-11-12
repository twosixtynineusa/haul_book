import {
  sourceName,
  type Company,
  type InboxEntry,
  type SourceFormatId,
  type Truck,
} from '@haulbook/shared';
import { formatIsoDate } from './companies';
import { entryOwner } from './inbox';

/**
 * What the in-app confirm dialog (components/confirm-dialog.tsx) asks before an action:
 * spelled out item by item, so the user sees exactly what goes and what stays.
 */
export interface ConfirmOptions {
  title: string;
  /** What the action takes away or changes, item by item. */
  items?: string[];
  /** The heading over `items`: "This deletes", "This replaces", … */
  itemsLabel?: string;
  /** What stays as it is. */
  kept?: string[];
  /** A closing sentence: what happens after. */
  message?: string;
  confirmLabel: string;
  /** `danger`: a red button, and Cancel has the focus. */
  tone?: 'danger' | 'primary';
}

const KEPT_ORIGINAL = 'The original report, in the archive folder';
const MAX_LISTED = 8;

/** "22, 25 and 31", or "22, 25, … and 9 more". */
function listed(values: string[]): string {
  if (values.length <= 1) return values.join('');
  const shown = values.slice(0, MAX_LISTED);
  const more = values.length - shown.length;
  return more > 0
    ? `${shown.join(', ')} and ${more} more`
    : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Truck Volvo 01 (ProMiles unit # 2011)". */
function truckName(truck: Truck): string {
  const promiles =
    truck.promilesUnit !== truck.unit ? ` (ProMiles unit # ${truck.promilesUnit})` : '';
  return `Truck ${truck.unit}${promiles}`;
}

export function deleteTruckConfirm(company: string, truck: Truck): ConfirmOptions {
  const details = [truck.vin && 'VIN', truck.plate && 'plate', truck.notes && 'notes'].filter(
    (d): d is string => !!d,
  );
  return {
    title: `Delete truck ${truck.unit}?`,
    itemsLabel: 'This deletes',
    items: [
      `${truckName(truck)} from ${company}`,
      ...(truck.odometer
        ? [
            `Its saved odometer: ${Number(truck.odometer).toLocaleString('en-US')} (end of ` +
              `${formatIsoDate(truck.odometerAsOf)})`,
          ]
        : []),
      ...(details.length > 0 ? [`Its ${listed(details)}`] : []),
    ],
    kept: [
      'Its converted reports in History (no longer linked to the truck)',
      'ProMiles files already written',
    ],
    message: 'A report for it dropped in the input folder again converts as a new truck.',
    confirmLabel: `Delete truck ${truck.unit}`,
    tone: 'danger',
  };
}

export function deleteCompanyConfirm(company: Company): ConfirmOptions {
  const trucks = company.trucks.map((t) => t.unit);
  const odometers = company.trucks.filter((t) => t.odometer).length;
  return {
    title: `Delete ${company.name}?`,
    itemsLabel: 'This deletes',
    items: [
      `The company ${company.name}, its details and its approved source`,
      ...(trucks.length > 0 ? [`${plural(trucks.length, 'truck')}: ${listed(trucks)}`] : []),
      ...(odometers > 0 ? [`${plural(odometers, 'saved odometer')}`] : []),
    ],
    kept: [
      'Its converted reports in History (no longer linked to it)',
      'ProMiles files already written',
    ],
    message: "This can't be undone.",
    confirmLabel: 'Delete company',
    tone: 'danger',
  };
}

export function mergeCompanyConfirm(company: Company, target: Company): ConfirmOptions {
  const twins = company.trucks.filter((t) => target.trucks.some((u) => u.unit === t.unit));
  return {
    title: `Merge ${company.name} into ${target.name}?`,
    itemsLabel: `Moves to ${target.name}`,
    items: [
      `${plural(company.trucks.length, 'truck')} with their odometers and history`,
      ...(twins.length > 0
        ? [`${listed(twins.map((t) => t.unit))} become one truck with ${target.name}'s`]
        : []),
    ],
    message: `${company.name} is then removed.`,
    confirmLabel: 'Merge',
    tone: 'primary',
  };
}

export function moveTruckConfirm(truck: Truck, target: Company): ConfirmOptions {
  const twin = target.trucks.some((t) => t.unit === truck.unit);
  return {
    title: `Move truck ${truck.unit} to ${target.name}?`,
    itemsLabel: 'Moves with it',
    items: ['Its saved odometer and details', 'Its converted reports in History'],
    kept: ['ProMiles files already written'],
    message: twin
      ? `${target.name} already has truck ${truck.unit}: the two become one truck. The later ` +
        'odometer is kept, blank details are filled in, and both histories are kept.'
      : undefined,
    confirmLabel: twin ? 'Move and merge' : 'Move truck',
    tone: 'primary',
  };
}

export function replaceSourceConfirm(
  company: string,
  from: SourceFormatId,
  to: SourceFormatId,
): ConfirmOptions {
  return {
    title: `Make ${sourceName(to)} ${company}'s approved source?`,
    message:
      `It replaces ${sourceName(from)}: ${company}'s ${sourceName(from)} files will then wait ` +
      'for you to confirm them.',
    confirmLabel: `Use ${sourceName(to)}`,
    tone: 'primary',
  };
}

/** What a converted input-folder row produced: its ProMiles file(s) and history entries. */
function produced(entry: InboxEntry): string[] {
  const owner = entryOwner(entry);
  return [
    ...entry.outputs.map((name) => `ProMiles file ${name}`),
    `Its History ${entry.units.length > 1 ? 'entries' : 'entry'}${owner ? ` for ${owner}` : ''}`,
  ];
}

export function deleteEntryConfirm(entry: InboxEntry): ConfirmOptions {
  const converted = entry.status === 'converted' && entry.outputs.length > 0;
  return {
    title: converted ? `Delete ${entry.name}?` : `Remove ${entry.name} from the list?`,
    itemsLabel: 'This deletes',
    items: ['Its row in the input folder list', ...(converted ? produced(entry) : [])],
    kept: [KEPT_ORIGINAL],
    message: converted
      ? 'The same report can then be dropped in the input folder and converted again.'
      : 'It produced no ProMiles file, so nothing else goes.',
    confirmLabel: converted ? 'Delete' : 'Remove',
    tone: 'danger',
  };
}

export function reprocessEntryConfirm(entry: InboxEntry): ConfirmOptions {
  const converted = entry.status === 'converted' && entry.outputs.length > 0;
  return {
    title: converted ? `Convert ${entry.name} again?` : `Try ${entry.name} again?`,
    ...(converted ? { itemsLabel: 'This replaces', items: produced(entry) } : {}),
    message:
      'It goes through the same checks as a new file, with the saved companies and trucks as ' +
      'they are now, and may wait for your input.',
    confirmLabel: converted ? 'Convert again' : 'Try again',
    tone: 'primary',
  };
}
