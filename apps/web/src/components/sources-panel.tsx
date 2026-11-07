'use client';

import {
  AlertTriangle,
  ArrowLeftRight,
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
  type SourceFile,
  type SourceFormatId,
} from '@haulbook/shared';
import { formatBytes } from '@/lib/format';
import { fileKey, shownValue, sourceSwitchText, unitsFor, type SourceDraft } from '@/lib/sources';
import { buttonClass, cx } from './ui';

const COMPANY_LIST_ID = 'saved-companies';

export const fieldClass = (missing: boolean, readOnly?: boolean) =>
  cx(
    'w-full rounded-md border bg-background px-2.5 py-1.5 text-sm',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    missing ? 'border-danger' : 'border-input',
    readOnly && 'bg-muted text-muted-foreground',
  );

export function Found({ show, children }: { show: boolean; children: string }) {
  if (!show) return null;
  return (
    <span className="ml-1.5 rounded bg-success-bg px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-success">
      {children}
    </span>
  );
}

/**
 * A known company's file from a source it hasn't been converted from before:
 * nothing converts until the user confirms the switch. Confirming approves that
 * source for the company, so its later files convert on their own.
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

/**
 * One row per dropped file: its source format (auto-detected, or picked from the
 * list when detection fails), and the company + unit # it belongs to — read from
 * the file when it carries them, otherwise typed or picked from the saved list.
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
        const unit = shownValue(draft.unit, source?.unit);
        const format = draft.format ?? source?.format ?? '';
        const needs = new Set(source?.needs ?? []);
        const unitsListId = `saved-units-${i}`;
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

            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,9rem)]">
              <label className="block text-xs font-medium text-muted-foreground">
                Source format
                <Found show={!!source?.formatDetected && !draft.format}>detected</Found>
                <select
                  value={format}
                  disabled={readOnly}
                  onChange={(e) =>
                    onChange(key, { format: (e.target.value || undefined) as SourceFormatId })
                  }
                  className={cx(fieldClass(needs.has('format'), readOnly), 'mt-1')}
                >
                  <option value="">
                    {source && !source.format ? 'Not recognised — choose…' : 'Detect automatically'}
                  </option>
                  {SOURCE_FORMATS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                      {f.available ? '' : ' (coming soon)'}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs font-medium text-muted-foreground">
                Company
                <Found show={!!source?.companyDetected && draft.company === undefined}>
                  from file
                </Found>
                <input
                  type="text"
                  list={COMPANY_LIST_ID}
                  value={company}
                  readOnly={readOnly}
                  placeholder={
                    companies.length ? 'Pick or type a company' : 'Type the company name'
                  }
                  onChange={(e) => onChange(key, { company: e.target.value })}
                  aria-invalid={needs.has('company')}
                  className={cx(fieldClass(needs.has('company'), readOnly), 'mt-1')}
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
                Unit #
                <Found show={!!source?.unitDetected && draft.unit === undefined}>
                  from file name
                </Found>
                <input
                  type="text"
                  list={unitsListId}
                  value={unit}
                  readOnly={readOnly}
                  placeholder="e.g. 22"
                  onChange={(e) => onChange(key, { unit: e.target.value })}
                  aria-invalid={needs.has('unit')}
                  className={cx(fieldClass(needs.has('unit'), readOnly), 'mt-1')}
                />
                <datalist id={unitsListId}>
                  {unitsFor(companies, company).map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
              </label>
            </div>

            {source?.error && <p className="mt-2 text-xs text-danger">{source.error}</p>}
            {!source?.error &&
              (needs.has('format') || needs.has('company') || needs.has('unit')) && (
                <p className="mt-2 text-xs text-warning">
                  {needs.has('format') &&
                    'The format wasn’t recognised — choose which system this report came from. '}
                  {needs.has('company') && 'Enter or pick the company these miles belong to. '}
                  {needs.has('unit') && 'The unit # isn’t in this file — enter or pick it.'}
                </p>
              )}
            {source && needs.has('source') && (
              <SourceSwitch
                text={sourceSwitchText(source.company, source.format, source.knownSources)}
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
