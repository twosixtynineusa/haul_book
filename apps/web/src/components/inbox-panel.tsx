'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Copy,
  Hourglass,
  Inbox,
  Loader2,
  XCircle,
} from 'lucide-react';
import {
  sourceName,
  type Company,
  type InboxEntry,
  type InboxList,
  type SourceFormatId,
} from '@haulbook/shared';
import { dismissInbox, listInbox, resolveInbox, retryInbox, scanInbox } from '@/lib/api';
import { plural } from '@/lib/format';
import { STATUS_LABEL } from '@/lib/inbox';
import {
  companyOptions,
  shownValue,
  sourceSwitchText,
  toChoices,
  unitOptions,
  type SourceDraft,
} from '@/lib/sources';
import { Combobox } from './combobox';
import { FormatSelect, NeedsText, PeriodFields, SourceSwitch } from './sources-panel';
import { Alert, Badge, Button, Card, cx, type Tone } from './ui';

/** How often the portal re-reads the inbox (the worker scans on its own schedule). */
const REFRESH_MS = 10_000;

export const STATUS_TONE: Record<InboxEntry['status'], Tone> = {
  waiting: 'muted',
  processing: 'muted',
  needs_input: 'warning',
  failed: 'danger',
  converted: 'success',
  duplicate: 'muted',
  dismissed: 'muted',
};

export function StatusIcon({ status }: { status: InboxEntry['status'] }) {
  const cls = 'size-4 shrink-0';
  switch (status) {
    case 'waiting':
      return <Hourglass className={cls} aria-hidden />;
    case 'processing':
      return <Loader2 className={cx(cls, 'animate-spin')} aria-hidden />;
    case 'needs_input':
      return <AlertTriangle className={cls} aria-hidden />;
    case 'failed':
      return <XCircle className={cls} aria-hidden />;
    case 'converted':
      return <CheckCircle2 className={cls} aria-hidden />;
    case 'duplicate':
      return <Copy className={cls} aria-hidden />;
    default:
      return <Archive className={cls} aria-hidden />;
  }
}

/** The input folder as the dashboard's cards share it: one poll, one "scan now". */
export interface InboxState {
  inbox: InboxList | null;
  error: string | null;
  scanning: boolean;
  /** Re-read the inbox, and tell the page something was converted, changed or deleted. */
  changed: () => void;
  scanNow: () => void;
}

export function useInbox(
  /** Something was converted, changed or deleted: refresh the outputs and the companies. */
  onChanged: () => void,
): InboxState {
  const [inbox, setInbox] = useState<InboxList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  /** Newest processed id seen so far (undefined until the first load). */
  const latest = useRef<string | null | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const next = await listInbox();
      const newest = next.recent[0]?.id ?? null;
      // New conversions by the worker → refresh the panels that show them.
      if (latest.current !== undefined && newest !== latest.current) onChanged();
      latest.current = newest;
      setInbox(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [onChanged]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const changed = useCallback(() => {
    void refresh();
    onChanged();
  }, [refresh, onChanged]);

  const scanNow = useCallback(() => {
    setScanning(true);
    scanInbox()
      .then(() => setTimeout(() => void refresh(), 1500))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setTimeout(() => setScanning(false), 1500));
  }, [refresh]);

  return { inbox, error, scanning, changed, scanNow };
}

/** What an input-folder file's form holds: the user's edits over what the row has. */
export function entryValues(entry: InboxEntry, draft: SourceDraft) {
  const company = shownValue(draft.company, entry.company);
  // A file with several trucks: their unit #s come from the file and can't be edited.
  const manyUnits = entry.units.length > 1;
  const unit = manyUnits ? entry.units.join(', ') : shownValue(draft.unit, entry.unit);
  const format: SourceFormatId | '' = draft.format ?? entry.format ?? '';
  const period = draft.period ?? entry.period ?? { begin: '', end: '' };
  const needsPeriod = entry.needs.includes('period') || !!entry.period;
  const complete =
    !!company.trim() &&
    !!unit.trim() &&
    !!format &&
    (!needsPeriod || (!!period.begin && !!period.end));
  /** What to send: only what's set, a file's own truck #s left to the file. */
  const choice = (confirmSource?: boolean) =>
    toChoices([
      {
        format: format || undefined,
        company,
        unit: manyUnits ? '' : unit,
        period: needsPeriod ? period : undefined,
        confirmSource,
      },
    ])[0];
  return { company, manyUnits, unit, format, period, needsPeriod, complete, choice };
}

/** Source format, company, truck # (and the period, for a file with no dates) of one file. */
export function EntryFields({
  entry,
  companies,
  draft,
  narrow,
  onChange,
}: {
  entry: InboxEntry;
  companies: Company[];
  draft: SourceDraft;
  /** In a half-width card: the format on its own line, company and truck # under it. */
  narrow?: boolean;
  onChange: (patch: SourceDraft) => void;
}) {
  const { company, manyUnits, unit, format, period, needsPeriod } = entryValues(entry, draft);
  const needs = new Set(entry.needs);
  return (
    <>
      <div
        className={cx(
          'grid gap-3',
          narrow
            ? 'sm:grid-cols-[minmax(0,1fr)_minmax(0,8rem)]'
            : 'sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,10rem)]',
        )}
      >
        <label
          className={cx(
            'block text-xs font-medium text-muted-foreground',
            narrow && 'sm:col-span-2',
          )}
        >
          Source format
          <FormatSelect
            value={format}
            invalid={needs.has('format')}
            empty={entry.formatOptions.length ? 'Pick the source…' : 'Not recognised — choose…'}
            onChange={(f) => onChange({ format: f })}
          />
        </label>
        <label className="block text-xs font-medium text-muted-foreground">
          Company
          <Combobox
            className="mt-1"
            value={company}
            options={companyOptions(companies, entry.companyOptions)}
            invalid={needs.has('company')}
            placeholder={companies.length ? 'Pick or type a company' : 'Type the company name'}
            onChange={(value) => onChange({ company: value })}
          />
        </label>
        <label className="block text-xs font-medium text-muted-foreground">
          {manyUnits ? `${entry.units.length} trucks (from file)` : 'Truck #'}
          <Combobox
            className="mt-1"
            value={unit}
            options={unitOptions(companies, company)}
            readOnly={manyUnits}
            invalid={needs.has('unit')}
            placeholder="e.g. 22"
            onChange={(value) => onChange({ unit: value })}
          />
        </label>
      </div>
      {needsPeriod && (
        <PeriodFields
          value={period}
          suggested={entry.suggestedPeriod}
          missing={needs.has('period')}
          onChange={(p) => onChange({ period: p })}
        />
      )}
    </>
  );
}

function PendingRow({
  entry,
  companies,
  onDone,
}: {
  entry: InboxEntry;
  companies: Company[];
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<SourceDraft>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actionable = entry.status === 'needs_input' || entry.status === 'failed';
  const { unit, complete, choice } = entryValues(entry, draft);
  const needs = new Set(entry.needs);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setDraft({});
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const convert = (confirmSource?: boolean) =>
    run(() => resolveInbox(entry.id, choice(confirmSource)));
  // Only the source switch is open (format, company and unit are all known): one button.
  const onlySource = needs.has('source') && needs.size === 1 && !entry.error;

  return (
    <li
      className={cx(
        'rounded-lg border p-3',
        entry.status === 'needs_input' && 'border-warning/60',
        entry.status === 'failed' && 'border-danger/60',
        !actionable && 'border-border',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={entry.path}>
          {entry.name}
        </span>
        <Badge tone={STATUS_TONE[entry.status]}>
          <StatusIcon status={entry.status} />
          {STATUS_LABEL[entry.status]}
        </Badge>
      </div>

      {actionable && (
        <>
          <div className="mt-3">
            <EntryFields
              entry={entry}
              companies={companies}
              draft={draft}
              onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            />
          </div>

          {entry.error && <p className="mt-2 text-xs text-danger">{entry.error}</p>}
          {!entry.error && (
            <NeedsText
              needs={needs}
              formatOptions={entry.formatOptions}
              companyOptions={entry.companyOptions}
              unit={unit}
            />
          )}
          {needs.has('company') && entry.companyOptions.length === 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Tip: drop files in a sub-folder named after the company.
            </p>
          )}
          {needs.has('source') && (
            <SourceSwitch
              text={sourceSwitchText(entry.company, entry.format, entry.knownSource)}
              format={entry.format}
              busy={busy}
              disabled={!complete}
              confirmLabel={`Confirm & convert${entry.format ? ` from ${sourceName(entry.format)}` : ''}`}
              onConfirm={() => convert(true)}
            />
          )}
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => convert()} disabled={busy || onlySource || !complete}>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Convert
            </Button>
            {entry.status === 'failed' && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => run(() => retryInbox(entry.id))}
              >
                Retry
              </Button>
            )}
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => run(() => dismissInbox(entry.id))}
              title="Take the file out of the input folder and stop showing it here"
            >
              Set aside
            </Button>
          </div>
        </>
      )}
    </li>
  );
}

/**
 * Input-folder files that aren't converted yet: the ones the worker couldn't convert on its
 * own wait here for a format / company / truck # / period, or for a source switch to be
 * confirmed. Shown only while there are any.
 */
export function InboxPending({ state, companies }: { state: InboxState; companies: Company[] }) {
  const pending = state.inbox?.pending ?? [];
  if (pending.length === 0) return null;

  const attention = pending.filter((p) => p.status === 'needs_input' || p.status === 'failed');
  const switches = attention.filter((p) => p.needs.includes('source'));

  return (
    <Card
      title={attention.length > 0 ? 'Waiting for you' : 'Coming in'}
      subtitle={
        attention.length > 0
          ? 'From the input folder: fill in what’s missing and they convert.'
          : 'From the input folder: converting on their own.'
      }
      icon={<Inbox className="size-4 text-muted-foreground" aria-hidden />}
      action={
        attention.length > 0 && <Badge tone="warning">{plural(attention.length, 'file')}</Badge>
      }
    >
      {switches.length > 0 && (
        <div className="mb-4">
          <Alert tone="warning" title="A company is coming in from a different source">
            <ul className="list-inside list-disc">
              {switches.map((s) => (
                <li key={s.id}>{sourceSwitchText(s.company, s.format, s.knownSource)}</li>
              ))}
            </ul>
            <p>
              These files wait below until you confirm. Confirming makes the new source the
              company&apos;s approved one (it replaces the old), and its files from it then convert
              automatically.
            </p>
          </Alert>
        </div>
      )}

      <ul className="space-y-3">
        {pending.map((entry) => (
          <PendingRow
            key={`${entry.id}:${entry.status}`}
            entry={entry}
            companies={companies}
            onDone={state.changed}
          />
        ))}
      </ul>
    </Card>
  );
}
