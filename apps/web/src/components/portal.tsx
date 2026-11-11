'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Loader2, RotateCcw } from 'lucide-react';
import {
  OdometerReadingSchema,
  type Company,
  type ConversionPreview,
  type ConversionResult,
  type OutputList,
} from '@haulbook/shared';
import {
  convertFiles,
  downloadUrl,
  listCompanies,
  listOutputs,
  previewConversion,
} from '@/lib/api';
import { mergeFiles } from '@/lib/files';
import { plural } from '@/lib/format';
import { fileKey, toChoices, type SourceDraft } from '@/lib/sources';
import { Dropzone } from './dropzone';
import { InboxPending, useInbox } from './inbox-panel';
import { InboxRecent } from './inbox-recent';
import { OutputFiles } from './output-files';
import { ReviewTable } from './review-table';
import { SourcesPanel } from './sources-panel';
import { Alert, Button, Card, buttonClass } from './ui';

/** Wait this long after the last keystroke before re-checking the files. */
const RECHECK_DELAY_MS = 350;

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * The whole portal: drop mileage reports → confirm each file's format, company
 * and unit # → review trips (+ optional odometers) → convert & save one ProMiles
 * file per company → download or pick up from the output folder.
 */
export function Portal() {
  const [files, setFiles] = useState<File[]>([]);
  const [drafts, setDrafts] = useState<Record<string, SourceDraft>>({});
  const [rejected, setRejected] = useState<string[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);

  const [preview, setPreview] = useState<ConversionPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const [odometers, setOdometers] = useState<Record<string, string>>({});
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [result, setResult] = useState<ConversionResult | null>(null);

  const [outputs, setOutputs] = useState<OutputList | null>(null);
  const [outputsError, setOutputsError] = useState<string | null>(null);
  const [outputsLoading, setOutputsLoading] = useState(false);

  const refreshOutputs = useCallback(async () => {
    setOutputsLoading(true);
    try {
      setOutputs(await listOutputs());
      setOutputsError(null);
    } catch (e) {
      setOutputsError(errorText(e));
    } finally {
      setOutputsLoading(false);
    }
  }, []);

  const refreshCompanies = useCallback(async () => {
    try {
      setCompanies((await listCompanies()).companies);
    } catch {
      // The pickers still work as plain text fields without the saved list.
    }
  }, []);

  useEffect(() => {
    void refreshOutputs();
    void refreshCompanies();
  }, [refreshOutputs, refreshCompanies]);

  const refreshAfterInbox = useCallback(() => {
    void refreshOutputs();
    void refreshCompanies();
  }, [refreshOutputs, refreshCompanies]);
  const inbox = useInbox(refreshAfterInbox);

  const choices = useMemo(
    () => toChoices(files.map((f) => drafts[fileKey(f)] ?? {})),
    [files, drafts],
  );
  const choicesKey = JSON.stringify(choices);

  // Re-check whenever the files or what the user set for them change (debounced
  // for typing). Odometers don't affect the check, so they never re-upload.
  useEffect(() => {
    setConvertError(null);
    if (files.length === 0) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const timer = setTimeout(() => {
      previewConversion(files, JSON.parse(choicesKey))
        .then((p) => {
          if (cancelled) return;
          setPreview(p);
          setPreviewError(null);
        })
        .catch((e) => !cancelled && setPreviewError(errorText(e)))
        .finally(() => !cancelled && setChecking(false));
    }, RECHECK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [files, choicesKey]);

  const invalidOdometers = useMemo(
    () =>
      new Set(
        Object.entries(odometers)
          .filter(([, v]) => v.trim() !== '' && !OdometerReadingSchema.safeParse(v).success)
          .map(([truck]) => truck),
      ),
    [odometers],
  );

  const addFiles = (incoming: File[]) => {
    const merged = mergeFiles(files, incoming);
    setRejected(merged.rejected);
    if (merged.files.length !== files.length) setFiles(merged.files);
  };

  // A confirmed source switch is for that company + format: changing either asks again.
  const updateDraft = (key: string, patch: SourceDraft) =>
    setDrafts((prev) => {
      const reset = 'company' in patch || 'format' in patch ? { confirmSource: undefined } : {};
      return { ...prev, [key]: { ...prev[key], ...reset, ...patch } };
    });

  const companyForAll = (company: string) =>
    setDrafts((prev) =>
      Object.fromEntries(files.map((f) => [fileKey(f), { ...prev[fileKey(f)], company }])),
    );

  const convert = async () => {
    setConverting(true);
    setConvertError(null);
    try {
      setResult(await convertFiles(files, choices, odometers));
      void refreshOutputs();
      void refreshCompanies();
    } catch (e) {
      setConvertError(errorText(e));
    } finally {
      setConverting(false);
    }
  };

  const startOver = () => {
    setFiles([]);
    setDrafts({});
    setRejected([]);
    setOdometers({});
    setResult(null);
  };

  const done = result !== null;
  // The preview must describe the current files + choices, not a stale request.
  const current = !!preview && !checking && preview.files.length === files.length;
  const canConvert =
    current && preview.ready && !converting && !done && invalidOdometers.size === 0;
  const pending = preview?.files.filter((f) => f.needs.length > 0 || f.error).length ?? 0;

  return (
    <>
      <div className="space-y-6">
        <div className="space-y-6">
          <InboxPending state={inbox} companies={companies} />
          <Card title="Add mileage reports" step={1}>
            <Dropzone disabled={done || converting} onAdd={addFiles} />
            {rejected.length > 0 && (
              <div className="mt-3">
                <Alert tone="warning" title="Some files were skipped">
                  <ul className="list-inside list-disc">
                    {rejected.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </Alert>
              </div>
            )}
          </Card>

          {files.length > 0 && (
            <Card
              title="Company & truck"
              step={2}
              action={
                <span className="text-xs text-muted-foreground">
                  {checking
                    ? 'Checking…'
                    : pending > 0
                      ? `${plural(pending, 'file')} need${pending === 1 ? 's' : ''} attention`
                      : `${plural(files.length, 'file')} ready`}
                </span>
              }
            >
              <SourcesPanel
                files={files}
                drafts={drafts}
                sources={preview?.files}
                companies={companies}
                checking={checking}
                readOnly={done}
                onChange={updateDraft}
                onRemove={(file) => setFiles(files.filter((f) => f !== file))}
                onCompanyForAll={companyForAll}
              />
              {previewError && (
                <div className="mt-3">
                  <Alert tone="danger" title="The files couldn't be checked">
                    <p>{previewError}</p>
                  </Alert>
                </div>
              )}
              {preview && preview.errors.length > 0 && (
                <div className="mt-3">
                  <Alert tone="danger" title="These files can't be converted together">
                    <ul className="list-inside list-disc">
                      {preview.errors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  </Alert>
                </div>
              )}
            </Card>
          )}

          {preview && preview.trips.length > 0 && (
            <Card
              title="Review trips"
              step={3}
              action={
                <span className="text-xs text-muted-foreground">
                  {plural(
                    new Set(preview.trips.map((t) => t.company)).size,
                    'company',
                    'companies',
                  )}{' '}
                  · {plural(preview.trips.length, 'trip')}
                </span>
              }
            >
              <div className="space-y-4">
                <ReviewTable
                  trips={preview.trips}
                  odometers={odometers}
                  saved={preview.savedOdometers}
                  invalid={invalidOdometers}
                  readOnly={done}
                  onOdometerChange={(truck, value) =>
                    setOdometers((prev) => ({ ...prev, [truck]: value }))
                  }
                />
                {preview.warnings.length > 0 && (
                  <Alert tone="warning" title="Check before importing">
                    <ul className="list-inside list-disc">
                      {preview.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </Alert>
                )}
                {!done && (
                  <p className="text-xs text-muted-foreground">
                    Begin odometer is optional. Enter a truck&apos;s reading at the start of its
                    first trip once: later months carry it forward, and where it ends is saved, so
                    the truck&apos;s next conversion (from here or the input folder) starts there.
                    Type a value to override a saved one. With nothing typed or saved, ProMiles
                    still needs a value, so <code>1</code> is written, which imports fine.
                  </p>
                )}
              </div>
            </Card>
          )}

          {files.length > 0 && (
            <Card title="Convert & save" step={4}>
              {!done ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Button onClick={convert} disabled={!canConvert}>
                      {converting && <Loader2 className="size-4 animate-spin" aria-hidden />}
                      Convert &amp; save
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      {current && !preview.ready
                        ? 'Finish the company & truck details above first.'
                        : 'One file per company, named by company and truck #, saved to the output folder.'}
                    </span>
                  </div>
                  {convertError && <Alert tone="danger">{convertError}</Alert>}
                </div>
              ) : (
                <div className="space-y-4">
                  <Alert
                    tone="success"
                    title={`Ready to import into ProMiles — ${plural(result.outputs.length, 'file')}`}
                  >
                    <ul className="space-y-1">
                      {result.outputs.map((o) => (
                        <li key={o.name}>
                          <span className="font-semibold">{o.company}</span> (truck{' '}
                          {o.units.join(', ')}): <code className="break-all">{o.name}</code>
                        </li>
                      ))}
                    </ul>
                    <p>
                      In FuelTaxOnline pick that company as the customer, then Import Data → Choose
                      File → Upload.
                    </p>
                  </Alert>
                  <div className="flex flex-wrap gap-3">
                    {result.outputs.map((o) => (
                      <a
                        key={o.name}
                        href={downloadUrl(o.name)}
                        download={o.name}
                        className={buttonClass('primary', 'max-w-full')}
                      >
                        <Download className="size-4 shrink-0" aria-hidden />
                        <span className="truncate">Download {o.name}</span>
                      </a>
                    ))}
                    <Button variant="secondary" onClick={startOver}>
                      <RotateCcw className="size-4" aria-hidden /> Convert more files
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-2">
          <InboxRecent state={inbox} companies={companies} />
          <OutputFiles
            outputs={outputs}
            error={outputsError}
            loading={outputsLoading}
            highlight={result?.outputs.map((o) => o.name)}
            onRefresh={() => void refreshOutputs()}
          />
        </div>
      </div>
    </>
  );
}
