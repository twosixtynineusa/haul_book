'use client';

import {
  AlertTriangle,
  ArrowLeftRight,
  CalendarRange,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  X,
  XCircle,
} from 'lucide-react';
import {
  SOURCE_FORMATS,
  sourceName,
  type Company,
  type Period,
  type SourceFile,
  type SourceFormatId,
} from '@haulbook/shared';
import { formatBytes } from '@/lib/format';
import {
  companyChoiceText,
  companyOptions,
  companyOriginLabel,
  fileKey,
  formatChoiceText,
  periodText,
  shownValue,
  sourceSwitchText,
  unitOptions,
  type SourceDraft,
} from '@/lib/sources';
import { Combobox } from './combobox';
import { buttonClass, cx } from './ui';

export const fieldClass = (missing: boolean, readOnly?: boolean) =>
  cx(
    'w-full rounded-md border bg-background px-2.5 py-1.5 text-sm',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    missing ? 'border-danger' : 'border-input',
    readOnly && 'bg-muted text-muted-foreground',
  );

export function Found({ show, children }: { show: boolean; children: string | null }) {
  if (!show || !children) return null;
  return (
    <span className="ml-1.5 rounded bg-success-bg px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-success">
      {children}
    </span>
  );
}

/** The source format picker: every source, the placeholders marked "coming soon". */
export function FormatSelect({
  value,
  empty,
  invalid,
  readOnly,
  onChange,
}: {
  value: SourceFormatId | '';
  /** The blank entry's text. */
  empty: string;
  invalid: boolean;
  readOnly?: boolean;
  onChange: (format: SourceFormatId | undefined) => void;
}) {
  return (
    <select
      value={value}
      disabled={readOnly}
      onChange={(e) => onChange((e.target.value || undefined) as SourceFormatId | undefined)}
      className={cx(fieldClass(invalid, readOnly), 'mt-1')}
    >
      <option value="">{empty}</option>
      {SOURCE_FORMATS.map((f) => (
        <option key={f.id} value={f.id}>
          {f.label}
          {f.available ? '' : ' (coming soon)'}
        </option>
      ))}
    </select>
  );
}

/**
 * The dates a report with none of its own covers (Motive's distance summary). It becomes
 * one trip, so it stays inside one quarter; the likely month is offered in one click.
 */
export function PeriodFields({
  value,
  suggested,
  missing,
  readOnly,
  onChange,
}: {
  value: { begin: string; end: string };
  suggested: Period | null;
  missing: boolean;
  readOnly?: boolean;
  onChange: (period: { begin: string; end: string }) => void;
}) {
  const same = suggested && suggested.begin === value.begin && suggested.end === value.end;
  return (
    <div className="mt-3 rounded-md border border-dashed border-border p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <CalendarRange className="size-3.5" aria-hidden />
        Dates this report covers
        <span className="font-normal">
          — the file has none, so ProMiles gets one trip for this period (inside one quarter).
        </span>
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-muted-foreground">
          From
          <input
            type="date"
            value={value.begin}
            readOnly={readOnly}
            onChange={(e) => onChange({ ...value, begin: e.target.value })}
            className={cx(fieldClass(missing && !value.begin, readOnly), 'mt-1 w-auto')}
          />
        </label>
        <label className="text-xs font-medium text-muted-foreground">
          To
          <input
            type="date"
            value={value.end}
            readOnly={readOnly}
            onChange={(e) => onChange({ ...value, end: e.target.value })}
            className={cx(fieldClass(missing && !value.end, readOnly), 'mt-1 w-auto')}
          />
        </label>
        {suggested && !same && !readOnly && (
          <button
            type="button"
            onClick={() => onChange(suggested)}
            className={buttonClass('secondary', 'px-2.5 py-1.5 text-xs')}
            title="The whole month before the file was exported"
          >
            Use {periodText(suggested)}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A known company's file in a format other than its approved source: nothing converts
 * until the user confirms the switch. Confirming makes that format the company's one
 * approved source (replacing the old one), so its later files convert on their own.
 */
export function SourceSwitch({
  text,
  format,
  disabled,
  busy,
  confirmLabel,
  onConfirm,
}: {
  text: string;
  format: SourceFormatId | null;
  disabled?: boolean;
  busy?: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md bg-warning-bg px-3 py-2 text-xs text-warning">
      <ArrowLeftRight className="size-4 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Different source. </span>
        {text} Check it&apos;s the right company before converting.
      </p>
      <button
        type="button"
        onClick={onConfirm}
        disabled={disabled || busy}
        className={buttonClass('secondary', 'px-2.5 py-1 text-xs')}
      >
        {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
        {confirmLabel ?? `Confirm — use ${format ? sourceName(format) : 'it'} from now on`}
      </button>
    </div>
  );
}

/** What a waiting file still needs, in words. */
export function NeedsText({
  needs,
  formatOptions,
  companyOptions: owners,
  unit,
}: {
  needs: Set<string>;
  formatOptions: SourceFormatId[];
  companyOptions: string[];
  unit: string;
}) {
  if (!needs.has('format') && !needs.has('company') && !needs.has('unit') && !needs.has('period'))
    return null;
  return (
    <p className="mt-2 text-xs text-warning">
      {needs.has('format') &&
        (formatOptions.length
          ? `${formatChoiceText(formatOptions)} `
          : 'The format wasn’t recognised — choose which system this report came from. ')}
      {needs.has('company') &&
        (owners.length > 1
          ? `${companyChoiceText(unit, owners)} `
          : 'Pick or type the company these miles belong to. ')}
      {needs.has('unit') && 'The unit # isn’t in this file — pick or type it. '}
      {needs.has('period') && 'Enter the dates this report covers.'}
    </p>
  );
}

/**
 * One row per dropped file: its source format (auto-detected, or picked from the
 * list when detection fails), and the company + unit # it belongs to — read from
 * the file when it carries them, else matched from its unit #, otherwise picked from
 * the saved lists or typed. A file with no dates also gets the period it covers.
 */
export function SourcesPanel({
  files,
  drafts,
  sources,
  companies,
  checking,
  readOnly,
  onChange,
  onRemove,
  onCompanyForAll,
}: {
  files: File[];
  drafts: Record<string, SourceDraft>;
  /** The API's reading of each file (aligned with `files`); absent while first checking. */
  sources: SourceFile[] | undefined;
  companies: Company[];
  checking: boolean;
  readOnly?: boolean;
  onChange: (key: string, patch: SourceDraft) => void;
  onRemove: (file: File) => void;
  onCompanyForAll: (company: string) => void;
}) {
  return (
    <div className="space-y-3">
      {files.map((file, i) => {
        const key = fileKey(file);
        const draft = drafts[key] ?? {};
        const source = sources?.[i]?.name === file.name ? sources[i] : undefined;
        const company = shownValue(draft.company, source?.company);
        // A file with several trucks: their unit #s come from the file and can't be edited.
        const manyUnits = (source?.units.length ?? 0) > 1;
        const unit = manyUnits ? source!.units.join(', ') : shownValue(draft.unit, source?.unit);
        const format = draft.format ?? source?.format ?? '';
        const needs = new Set(source?.needs ?? []);
        const period = draft.period ?? source?.period ?? { begin: '', end: '' };
        const status = !source
          ? 'checking'
          : source.error
            ? 'error'
            : needs.size > 0
              ? 'needs'
              : 'ready';

        return (
          <div
            key={key}
            className={cx(
              'rounded-lg border p-3',
              status === 'error' && 'border-danger/60',
              status === 'needs' && 'border-warning/60',
              (status === 'ready' || status === 'checking') && 'border-border',
            )}
          >
            <div className="flex items-center gap-2">
              {status === 'checking' || checking ? (
                <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
              ) : status === 'ready' ? (
                <CheckCircle2 className="size-4 shrink-0 text-success" aria-label="Ready" />
              ) : status === 'needs' ? (
                <AlertTriangle className="size-4 shrink-0 text-warning" aria-label="Needs input" />
              ) : (
                <XCircle className="size-4 shrink-0 text-danger" aria-label="Can't convert" />
              )}
              <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm font-medium" title={file.name}>
                {file.name}
              </span>
              <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => onRemove(file)}
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,10rem)]">
              <label className="block text-xs font-medium text-muted-foreground">
                Source format
                <Found show={!!source?.formatDetected && !draft.format}>detected</Found>
                <FormatSelect
                  value={format}
                  readOnly={readOnly}
                  invalid={needs.has('format')}
                  empty={
                    source && !source.format
                      ? source.formatOptions.length
                        ? 'Pick the source…'
                        : 'Not recognised — choose…'
                      : 'Detect automatically'
                  }
                  onChange={(f) => onChange(key, { format: f })}
                />
              </label>

              <label className="block text-xs font-medium text-muted-foreground">
                Company
                <Found show={draft.company === undefined}>
                  {companyOriginLabel(source?.companyOrigin)}
                </Found>
                <Combobox
                  className="mt-1"
                  value={company}
                  options={companyOptions(companies, source?.companyOptions)}
                  readOnly={readOnly}
                  invalid={needs.has('company')}
                  placeholder={
                    companies.length ? 'Pick or type a company' : 'Type the company name'
                  }
                  onChange={(value) => onChange(key, { company: value })}
                />
                {!readOnly && files.length > 1 && company.trim() && (
                  <button
                    type="button"
                    onClick={() => onCompanyForAll(company)}
                    className="mt-1 text-[11px] font-medium text-primary hover:underline"
                  >
                    Use for all files
                  </button>
                )}
              </label>

              <label className="block text-xs font-medium text-muted-foreground">
                {manyUnits ? `${source!.units.length} trucks` : 'Unit #'}
                <Found show={!!source?.unitDetected && (manyUnits || draft.unit === undefined)}>
                  from file
                </Found>
                <Combobox
                  className="mt-1"
                  value={unit}
                  options={unitOptions(companies, company)}
                  readOnly={readOnly || manyUnits}
                  invalid={needs.has('unit')}
                  title={
                    manyUnits ? 'Each truck in this file converts with its own unit #' : undefined
                  }
                  placeholder="e.g. 22"
                  onChange={(value) => onChange(key, { unit: value })}
                />
              </label>
            </div>

            {source && (source.period || needs.has('period')) && (
              <PeriodFields
                value={period}
                suggested={source.suggestedPeriod}
                missing={needs.has('period')}
                readOnly={readOnly}
                onChange={(p) => onChange(key, { period: p })}
              />
            )}

            {source?.error && <p className="mt-2 text-xs text-danger">{source.error}</p>}
            {source && !source.error && (
              <NeedsText
                needs={needs}
                formatOptions={source.formatOptions}
                companyOptions={source.companyOptions}
                unit={unit}
              />
            )}
            {source && needs.has('source') && (
              <SourceSwitch
                text={sourceSwitchText(source.company, source.format, source.knownSource)}
                format={source.format}
                disabled={readOnly}
                onConfirm={() => onChange(key, { confirmSource: true })}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
