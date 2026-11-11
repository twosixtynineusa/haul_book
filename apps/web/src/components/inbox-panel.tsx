'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Copy,
  Download,
  FolderInput,
  Hourglass,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { sourceName, type Company, type InboxEntry, type InboxList } from '@haulbook/shared';
import {
  dismissInbox,
  downloadUrl,
  listInbox,
  resolveInbox,
  retryInbox,
  scanInbox,
} from '@/lib/api';
import { formatDateTime, plural } from '@/lib/format';
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
import { Alert, Button, Card, cx } from './ui';

/** How often the portal re-reads the inbox (the worker scans on its own schedule). */
const REFRESH_MS = 10_000;

const STATUS_TEXT: Record<InboxEntry['status'], string> = {
  waiting: 'Waiting for the file to finish copying…',
  processing: 'Converting…',
  needs_input: 'Needs your input',
  failed: 'Can’t convert',
  converted: 'Converted',
  duplicate: 'Duplicate — already converted',
  dismissed: 'Set aside in failed/',
};

function StatusIcon({ status }: { status: InboxEntry['status'] }) {
  const cls = 'size-4 shrink-0';
  switch (status) {
    case 'waiting':
      return <Hourglass className={cx(cls, 'text-muted-foreground')} aria-label="Waiting" />;
    case 'processing':
      return <Loader2 className={cx(cls, 'animate-spin text-muted-foreground')} />;
    case 'needs_input':
      return <AlertTriangle className={cx(cls, 'text-warning')} aria-label="Needs input" />;
    case 'failed':
      return <XCircle className={cx(cls, 'text-danger')} aria-label="Failed" />;
    case 'converted':
      return <CheckCircle2 className={cx(cls, 'text-success')} aria-label="Converted" />;
    default:
      return <Archive className={cx(cls, 'text-muted-foreground')} aria-label="Archived" />;
  }
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
  const company = shownValue(draft.company, entry.company);
  // A file with several trucks: their unit #s come from the file and can't be edited.
  const manyUnits = entry.units.length > 1;
  const unit = manyUnits ? entry.units.join(', ') : shownValue(draft.unit, entry.unit);
  const format = draft.format ?? entry.format ?? '';
  const period = draft.period ?? entry.period ?? { begin: '', end: '' };
  const needs = new Set(entry.needs);
  const needsPeriod = needs.has('period') || !!entry.period;
  const complete =
    !!company.trim() &&
    !!unit.trim() &&
    !!format &&
    (!needsPeriod || (!!period.begin && !!period.end));

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
    run(() =>
      resolveInbox(
        entry.id,
        toChoices([
          {
            format: format || undefined,
            company,
            unit: manyUnits ? '' : unit,
            period: needsPeriod ? period : undefined,
            confirmSource,
          },
        ])[0],
      ),
    );
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
        <StatusIcon status={entry.status} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={entry.path}>
          {entry.path}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{STATUS_TEXT[entry.status]}</span>
      </div>

      {actionable && (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,10rem)]">
            <label className="block text-xs font-medium text-muted-foreground">
              Source format
              <FormatSelect
                value={format}
                invalid={needs.has('format')}
                empty={entry.formatOptions.length ? 'Pick the source…' : 'Not recognised — choose…'}
                onChange={(f) => setDraft((d) => ({ ...d, format: f }))}
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
                onChange={(value) => setDraft((d) => ({ ...d, company: value }))}
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
                onChange={(value) => setDraft((d) => ({ ...d, unit: value }))}
              />
            </label>
          </div>

          {needsPeriod && (
            <PeriodFields
              value={period}
              suggested={entry.suggestedPeriod}
              missing={needs.has('period')}
              onChange={(p) => setDraft((d) => ({ ...d, period: p }))}
            />
          )}

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
              title="Move the file to failed/ and stop showing it here"
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
 * The watched input folder: files the worker couldn't convert on its own wait
 * here for a format / company / unit # / period; recently processed files show where
 * their output and archived source went.
 */
export function InboxPanel({
  companies,
  onChanged,
}: {
  companies: Company[];
  /** Something was converted — refresh the output list and the saved companies. */
  onChanged: () => void;
}) {
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

  const scanNow = async () => {
    setScanning(true);
    try {
      await scanInbox();
      setTimeout(() => void refresh(), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTimeout(() => setScanning(false), 1500);
    }
  };

  const attention = inbox?.pending.filter(
    (p) => p.status === 'needs_input' || p.status === 'failed',
  );
  const switches = attention?.filter((p) => p.needs.includes('source')) ?? [];

  return (
    <Card
      title="Input folder"
      action={
        <div className="flex items-center gap-2">
          {!!attention?.length && (
            <span className="rounded-full bg-warning-bg px-2 py-0.5 text-xs font-semibold text-warning">
              {plural(attention.length, 'file')} need{attention.length === 1 ? 's' : ''} you
            </span>
          )}
          <Button variant="ghost" onClick={scanNow} disabled={scanning} aria-label="Scan now">
            <RefreshCw className={cx('size-4', scanning && 'animate-spin')} />
          </Button>
        </div>
      }
    >
      {inbox && (
        <div className="mb-4 space-y-1">
          <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2">
            <FolderInput className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <code className="min-w-0 flex-1 truncate text-xs" title={inbox.inputDir}>
              {inbox.inputDir}
            </code>
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(inbox.inputDir).catch(() => {})}
              className="rounded p-1 text-muted-foreground hover:bg-card hover:text-foreground"
              aria-label="Copy folder path"
            >
              <Copy className="size-3.5" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Drop reports here (or in a sub-folder named after the company). They&apos;re checked
            every {inbox.scanSeconds}s, converted automatically, and moved to <code>archive/</code>.
          </p>
        </div>
      )}

      {error && <Alert tone="danger">{error}</Alert>}

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

      {inbox && inbox.pending.length > 0 && (
        <ul className="space-y-3">
          {inbox.pending.map((entry) => (
            <PendingRow
              key={`${entry.id}:${entry.status}`}
              entry={entry}
              companies={companies}
              onDone={() => {
                void refresh();
                onChanged();
              }}
            />
          ))}
        </ul>
      )}

      {inbox && inbox.pending.length === 0 && (
        <p className="py-2 text-sm text-muted-foreground">Nothing waiting — the folder is clear.</p>
      )}

      {inbox && inbox.recent.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Recently processed
          </p>
          <ul className="max-h-64 divide-y divide-border overflow-y-auto">
            {inbox.recent.map((entry) => (
              <li key={entry.id} className="flex items-start gap-2 py-2 text-xs">
                <StatusIcon status={entry.status} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium" title={entry.path}>
                    {entry.path}
                  </p>
                  <p className="truncate text-muted-foreground" title={entry.error ?? undefined}>
                    {STATUS_TEXT[entry.status]}
                    {entry.company && ` · ${entry.company}`}
                    {entry.unit && ` · truck ${entry.unit}`}
                    {entry.units.length > 1 && ` · trucks ${entry.units.join(', ')}`}
                    {entry.processedAt && ` · ${formatDateTime(entry.processedAt)}`}
                  </p>
                  {entry.archivedPath && (
                    <p className="truncate text-muted-foreground" title={entry.archivedPath}>
                      Source → <code>{entry.archivedPath}</code>
                    </p>
                  )}
                </div>
                {entry.outputs.map((name) => (
                  <a
                    key={name}
                    href={downloadUrl(name)}
                    download={name}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={`Download ${name}`}
                    title={name}
                  >
                    <Download className="size-4" />
                  </a>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
