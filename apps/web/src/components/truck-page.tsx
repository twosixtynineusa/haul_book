'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRightLeft, Building2, FileUp, Loader2, Pencil, Truck } from 'lucide-react';
import { sourceName, type Company, type TruckDetail, type TruckMoved } from '@haulbook/shared';
import { getTruck, listCompanies, updateTruck } from '@/lib/api';
import { formatIsoDate, truckChanges, truckDraft, type TruckDraft } from '@/lib/companies';
import { formatDateTime, formatDistance, plural } from '@/lib/format';
import { formatOdo, historyTotals, rangeText } from '@/lib/history';
import { HistoryTable } from './history-table';
import { CompanyFiles } from './company-files';
import { MoveTruck } from './move-truck';
import { fieldClass } from './sources-panel';
import { Alert, Button, Card, buttonClass, cx } from './ui';

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

const EDIT_FIELDS: [keyof TruckDraft, string, object?][] = [
  ['unit', 'Truck #'],
  ['promilesUnit', 'ProMiles unit #', { placeholder: 'Same as the truck #' }],
  ['vin', 'VIN', { maxLength: 17 }],
  ['plate', 'Plate'],
  ['odometer', 'Odometer', { inputMode: 'decimal' }],
  ['odometerAsOf', 'Odometer as of', { type: 'date' }],
  ['notes', 'Notes'],
];

/**
 * One truck (the unit # links on the Companies and History tabs open it): its company and
 * approved source, its details and saved odometer (editable here), what its converted
 * reports add up to, and every one of them.
 */
export function TruckPage({ id }: { id: string }) {
  const [detail, setDetail] = useState<TruckDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TruckDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** The companies it can move to, once "Move" is clicked. */
  const [moveTargets, setMoveTargets] = useState<Company[] | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      setDetail(await getTruck(id));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="space-y-4">
        <Link href="/companies" className={buttonClass('ghost', 'px-2')}>
          <ArrowLeft className="size-4" aria-hidden /> Companies
        </Link>
        <Alert tone="danger" title="This truck can't be shown">
          <p>{error}</p>
        </Alert>
      </div>
    );
  }
  if (!detail) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
      </p>
    );
  }

  const { company, truck, history } = detail;
  const totals = historyTotals(history);
  const latest = history.find((h) => h.endOdo !== null);

  const startEdit = () => {
    setDraft(truckDraft(truck));
    setSaveError(null);
    setEditing(true);
  };
  const save = async () => {
    if (!draft) return;
    const changes = truckChanges(draft, truck);
    if (Object.keys(changes).length === 0) return setEditing(false);
    setSaving(true);
    setSaveError(null);
    try {
      await updateTruck(company.id, truck.id, changes);
      await load();
      setEditing(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const startMove = async () => {
    setMoveError(null);
    try {
      const { companies } = await listCompanies();
      setMoveTargets(companies.filter((c) => c.id !== company.id));
    } catch (e) {
      setMoveError(e instanceof Error ? e.message : String(e));
    }
  };
  const moved = async ({ truckId }: TruckMoved) => {
    setMoveTargets(null);
    // Merged into the other company's truck of the same number: that one's page.
    if (truckId !== truck.id) router.replace(`/trucks/${truckId}`);
    else await load();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/companies/${company.id}`} className={buttonClass('ghost', 'px-2')}>
          <ArrowLeft className="size-4" aria-hidden /> {company.name}
        </Link>
      </div>

      <Card
        title={`Truck ${truck.unit}`}
        action={
          !editing && (
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => void startMove()} disabled={!!moveTargets}>
                <ArrowRightLeft className="size-4" aria-hidden /> Move
              </Button>
              <Button variant="secondary" onClick={startEdit}>
                <Pencil className="size-4" aria-hidden /> Edit truck
              </Button>
            </div>
          )
        }
      >
        <div className="space-y-5">
          {moveError && <Alert tone="danger">{moveError}</Alert>}
          {moveTargets && (
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <MoveTruck
                companyId={company.id}
                truck={truck}
                others={moveTargets}
                onMoved={(m) => void moved(m)}
                onCancel={() => setMoveTargets(null)}
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="flex items-center gap-2">
              <Truck className="size-4 text-muted-foreground" aria-hidden />
              <span className="font-semibold">{truck.unit}</span>
            </span>
            <span className="flex items-center gap-2">
              <Building2 className="size-4 text-muted-foreground" aria-hidden />
              <Link href={`/companies/${company.id}`} className="text-primary hover:underline">
                {company.name}
              </Link>
            </span>
            <span className="text-xs text-muted-foreground">
              Approved source:{' '}
              {company.source ? (
                <span className="rounded bg-primary-soft px-1.5 py-0.5 font-medium text-primary">
                  {sourceName(company.source)}
                </span>
              ) : (
                'none yet'
              )}
            </span>
          </div>

          {editing && draft ? (
            <form
              className="grid gap-3 sm:grid-cols-3"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              {EDIT_FIELDS.map(([f, label, props]) => (
                <label key={f} className="block text-xs font-medium text-muted-foreground">
                  {label}
                  <input
                    value={draft[f]}
                    onChange={(e) => setDraft((d) => d && { ...d, [f]: e.target.value })}
                    className={cx(fieldClass(f === 'unit' && !draft.unit.trim()), 'mt-1')}
                    {...props}
                  />
                </label>
              ))}
              <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
                <button
                  type="submit"
                  disabled={saving || !draft.unit.trim()}
                  className={buttonClass()}
                >
                  {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  Save
                </button>
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <p className="text-xs text-muted-foreground">
                  The odometer is where the truck&apos;s last converted period ended; its next
                  conversion starts there.
                </p>
                {saveError && <p className="w-full text-xs text-danger">{saveError}</p>}
              </div>
            </form>
          ) : (
            <dl className="grid gap-4 sm:grid-cols-3">
              <Fact label="ProMiles unit #">
                {truck.promilesUnit}
                {truck.promilesUnit === truck.unit && (
                  <span className="text-xs text-muted-foreground"> · same as the truck #</span>
                )}
              </Fact>
              <Fact label="VIN">
                <span className="font-mono text-xs">{truck.vin ?? '—'}</span>
              </Fact>
              <Fact label="Plate">{truck.plate ?? '—'}</Fact>
              <Fact label="Saved odometer">
                {truck.odometer ? (
                  <>
                    {formatOdo(truck.odometer)}
                    <span className="text-xs text-muted-foreground">
                      {' '}
                      · end of {formatIsoDate(truck.odometerAsOf)}
                    </span>
                  </>
                ) : (
                  '—'
                )}
              </Fact>
              <Fact label="Last converted">
                {truck.lastConvertedAt ? (
                  <>
                    {formatDateTime(truck.lastConvertedAt)}
                    <span className="block text-xs text-muted-foreground">
                      {truck.lastSource && sourceName(truck.lastSource)}
                      {truck.lastPeriodEnd && ` · through ${formatIsoDate(truck.lastPeriodEnd)}`}
                    </span>
                  </>
                ) : (
                  'Never'
                )}
              </Fact>
              <Fact label="Added">{formatDateTime(truck.createdAt)}</Fact>
              <Fact label="Notes">
                <span className="whitespace-pre-line text-muted-foreground">
                  {truck.notes ?? '—'}
                </span>
              </Fact>
            </dl>
          )}

          <div className="grid gap-3 sm:grid-cols-4">
            <Tile label="Reports converted" value={String(totals.reports)} />
            <Tile
              label="Total distance"
              value={
                totals.km > 0 && totals.miles === 0
                  ? formatDistance(totals.km, 'K')
                  : formatDistance(totals.miles, 'M')
              }
              sub={
                totals.km > 0 && totals.miles > 0
                  ? `+ ${formatDistance(totals.km, 'K')}`
                  : undefined
              }
            />
            <Tile
              label="Dates covered"
              value={totals.from && totals.to ? rangeText(totals.from, totals.to) : '—'}
            />
            <Tile
              label="Latest end odometer"
              value={latest ? formatOdo(latest.endOdo) : '—'}
              sub={latest ? `end of ${formatIsoDate(latest.endDate)}` : undefined}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Link href="/" className={buttonClass('secondary')}>
              <FileUp className="size-4" aria-hidden /> Convert a report
            </Link>
            <Link href={`/companies/${company.id}`} className={buttonClass('ghost')}>
              <Building2 className="size-4" aria-hidden /> Company &amp; its trucks
            </Link>
          </div>
        </div>
      </Card>

      <CompanyFiles
        key={`${company.id}:${truck.id}`}
        companyId={company.id}
        truckId={truck.id}
        onUpdated={load}
      />
      <Card
        title="Converted reports"
        action={
          <span className="text-xs text-muted-foreground">{plural(history.length, 'report')}</span>
        }
      >
        {history.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nothing converted for this truck yet.
          </p>
        ) : (
          <HistoryTable entries={history} showTruck={false} />
        )}
      </Card>
    </div>
  );
}
