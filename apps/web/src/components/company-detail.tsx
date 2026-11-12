'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRightLeft, GitMerge, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  SOURCE_FORMATS,
  sourceName,
  type Company,
  type SourceFormatId,
  type Truck,
  type TruckMoved,
} from '@haulbook/shared';
import {
  addTruck,
  deleteCompany,
  deleteTruck,
  mergeCompany,
  updateCompany,
  updateTruck,
} from '@/lib/api';
import {
  EMPTY_TRUCK,
  changedDetails,
  detailsDraft,
  formatIsoDate,
  truckChanges,
  truckDraft,
  type DetailField,
  type TruckDraft,
} from '@/lib/companies';
import {
  deleteCompanyConfirm,
  deleteTruckConfirm,
  mergeCompanyConfirm,
  replaceSourceConfirm,
} from '@/lib/confirm';
import { formatDateTime } from '@/lib/format';
import { useConfirm } from './confirm-dialog';
import { MoveTruck } from './move-truck';
import { fieldClass } from './sources-panel';
import { Button, buttonClass, cx } from './ui';

/** busy + error around one API call; `run` resolves to its result, or undefined on failure. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

const DETAIL_LABELS: Record<DetailField, string> = {
  name: 'Company name',
  dotNumber: 'USDOT #',
  iftaAccount: 'IFTA account #',
  contactName: 'Contact',
  phone: 'Phone',
  email: 'Email',
  notes: 'Notes',
};

/** One company, expanded: its details, approved source, trucks, and merge / delete. */
export function CompanyDetail({
  company,
  others,
  onSaved,
  onDeleted,
  onMerged,
  onTruckMoved,
}: {
  company: Company;
  /** The other companies, to merge this one into or move a truck to. */
  others: Company[];
  onSaved: (company: Company) => void;
  onDeleted: () => void;
  onMerged: (target: Company) => void;
  onTruckMoved: (moved: TruckMoved) => void;
}) {
  return (
    <div className="space-y-6 border-t border-border px-4 py-4">
      <DetailsForm company={company} onSaved={onSaved} />
      <SourceEditor company={company} onSaved={onSaved} />
      <TrucksTable
        company={company}
        others={others}
        onSaved={onSaved}
        onTruckMoved={onTruckMoved}
      />
      <DangerZone company={company} others={others} onDeleted={onDeleted} onMerged={onMerged} />
    </div>
  );
}

function DetailsForm({ company, onSaved }: { company: Company; onSaved: (c: Company) => void }) {
  const [draft, setDraft] = useState(() => detailsDraft(company));
  const { busy, error, run } = useAction();
  const changes = changedDetails(company, draft);
  const dirty = Object.keys(changes).length > 0;

  const field = (f: DetailField, wide = false) => (
    <label
      key={f}
      className={cx('block text-xs font-medium text-muted-foreground', wide && 'sm:col-span-2')}
    >
      {DETAIL_LABELS[f]}
      {f === 'notes' ? (
        <textarea
          rows={2}
          value={draft[f]}
          onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
          className={cx(fieldClass(false), 'mt-1')}
        />
      ) : (
        <input
          type={f === 'email' ? 'email' : 'text'}
          value={draft[f]}
          onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
          className={cx(fieldClass(f === 'name' && !draft.name.trim()), 'mt-1')}
        />
      )}
    </label>
  );

  const save = async () => {
    const saved = await run(() => updateCompany(company.id, changes));
    if (saved) {
      onSaved(saved);
      setDraft(detailsDraft(saved));
    }
  };

  return (
    <Section title="Details">
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty) void save();
        }}
      >
        {field('name', true)}
        {field('dotNumber')}
        {field('iftaAccount')}
        {field('contactName')}
        {field('phone')}
        {field('email', true)}
        {field('notes', true)}
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <button
            type="submit"
            disabled={!dirty || busy || !draft.name.trim()}
            className={buttonClass()}
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Save details
          </button>
          {dirty && (
            <Button variant="ghost" onClick={() => setDraft(detailsDraft(company))}>
              Undo changes
            </Button>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      </form>
    </Section>
  );
}

function SourceEditor({ company, onSaved }: { company: Company; onSaved: (c: Company) => void }) {
  const { busy, error, run } = useAction();
  const confirm = useConfirm();
  const save = async (source: SourceFormatId | null) => {
    if (
      source &&
      company.source &&
      !(await confirm(replaceSourceConfirm(company.name, company.source, source)))
    )
      return;
    const saved = await run(() => updateCompany(company.id, { source }));
    if (saved) onSaved(saved);
  };

  return (
    <Section title="Approved source">
      <p className="text-xs text-muted-foreground">
        A company has one approved source. Its files convert automatically; a file from any other
        source waits on the Dashboard until you confirm the switch, which makes that source the
        approved one instead.
        {!company.source && ' None yet: the next converted file’s source is approved.'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={company.source ?? ''}
          disabled={busy}
          onChange={(e) => void save((e.target.value || null) as SourceFormatId | null)}
          className={cx(fieldClass(false), 'w-auto min-w-[16rem]')}
          aria-label="Approved source"
        >
          <option value="">None yet — the next file’s source</option>
          {SOURCE_FORMATS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
              {f.available ? '' : ' (coming soon)'}
            </option>
          ))}
        </select>
        {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </Section>
  );
}

function TrucksTable({
  company,
  others,
  onSaved,
  onTruckMoved,
}: {
  company: Company;
  others: Company[];
  onSaved: (c: Company) => void;
  onTruckMoved: (moved: TruckMoved) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <Section title={`Trucks (${company.trucks.length})`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-2 pr-3 font-medium">Truck #</th>
              <th className="py-2 pr-3 font-medium" title="The unit # written to ProMiles">
                ProMiles unit #
              </th>
              <th className="py-2 pr-3 font-medium">VIN</th>
              <th className="py-2 pr-3 font-medium">Plate</th>
              <th className="py-2 pr-3 font-medium">Odometer</th>
              <th className="py-2 pr-3 font-medium">Last converted</th>
              <th className="py-2 pr-3 font-medium">Notes</th>
              <th className="py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {company.trucks.map((t) =>
              editing === t.id ? (
                <TruckEditor
                  key={t.id}
                  companyId={company.id}
                  truck={t}
                  onDone={(saved) => {
                    if (saved) onSaved(saved);
                    setEditing(null);
                  }}
                />
              ) : (
                <TruckRow
                  key={t.id}
                  companyId={company.id}
                  companyName={company.name}
                  truck={t}
                  others={others}
                  onEdit={() => setEditing(t.id)}
                  onSaved={onSaved}
                  onMoved={onTruckMoved}
                />
              ),
            )}
            {adding && (
              <TruckEditor
                companyId={company.id}
                onDone={(saved) => {
                  if (saved) onSaved(saved);
                  setAdding(false);
                }}
              />
            )}
            {company.trucks.length === 0 && !adding && (
              <tr>
                <td colSpan={8} className="py-4 text-center text-sm text-muted-foreground">
                  No trucks yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!adding && (
        <Button variant="secondary" onClick={() => setAdding(true)}>
          <Plus className="size-4" aria-hidden />
          Add truck
        </Button>
      )}
    </Section>
  );
}

function TruckRow({
  companyId,
  companyName,
  truck,
  others,
  onEdit,
  onSaved,
  onMoved,
}: {
  companyId: string;
  companyName: string;
  truck: Truck;
  others: Company[];
  onEdit: () => void;
  onSaved: (c: Company) => void;
  onMoved: (moved: TruckMoved) => void;
}) {
  const [moving, setMoving] = useState(false);
  const { busy, error, run } = useAction();
  const confirm = useConfirm();
  const remove = async () => {
    if (!(await confirm(deleteTruckConfirm(companyName, truck)))) return;
    const saved = await run(() => deleteTruck(companyId, truck.id));
    if (saved) onSaved(saved);
  };
  return (
    <>
      <tr className={cx('border-b border-border align-top', !moving && 'last:border-0')}>
        <td className="whitespace-nowrap py-2.5 pr-3 font-semibold">
          <Link
            href={`/trucks/${truck.id}`}
            className="text-primary hover:underline"
            title="See this truck and its converted reports"
          >
            {truck.unit}
          </Link>
        </td>
        <td className="whitespace-nowrap py-2.5 pr-3">
          {truck.promilesUnit === truck.unit ? (
            <span className="text-muted-foreground" title="The same as the truck #">
              {truck.promilesUnit}
            </span>
          ) : (
            <span className="font-medium">{truck.promilesUnit}</span>
          )}
        </td>
        <td className="py-2.5 pr-3 font-mono text-xs">{truck.vin ?? '—'}</td>
        <td className="py-2.5 pr-3">{truck.plate ?? '—'}</td>
        <td className="py-2.5 pr-3 tabular-nums">
          {truck.odometer ? (
            <>
              {Number(truck.odometer).toLocaleString('en-US')}
              <p className="text-xs text-muted-foreground">
                end of {formatIsoDate(truck.odometerAsOf)}
              </p>
            </>
          ) : (
            '—'
          )}
        </td>
        <td className="py-2.5 pr-3 text-xs">
          {truck.lastConvertedAt ? (
            <>
              {formatDateTime(truck.lastConvertedAt)}
              <p className="text-muted-foreground">
                {truck.lastSource && sourceName(truck.lastSource)}
                {truck.lastPeriodEnd && ` · through ${formatIsoDate(truck.lastPeriodEnd)}`}
              </p>
            </>
          ) : (
            <span className="text-muted-foreground">Never</span>
          )}
        </td>
        <td className="max-w-[14rem] py-2.5 pr-3 text-xs text-muted-foreground">
          <p className="line-clamp-2" title={truck.notes ?? undefined}>
            {truck.notes ?? ''}
          </p>
          {error && <p className="text-danger">{error}</p>}
        </td>
        <td className="whitespace-nowrap py-1.5 text-right">
          <Button
            variant="ghost"
            className="px-2"
            onClick={onEdit}
            aria-label={`Edit truck ${truck.unit}`}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            className="px-2"
            onClick={() => setMoving((m) => !m)}
            aria-label={`Move truck ${truck.unit} to another company`}
            title="Move to another company"
          >
            <ArrowRightLeft className="size-4" />
          </Button>
          <Button
            variant="ghost"
            className="px-2 hover:text-danger"
            disabled={busy}
            onClick={() => void remove()}
            aria-label={`Delete truck ${truck.unit}`}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          </Button>
        </td>
      </tr>
      {moving && (
        <tr className="border-b border-border bg-muted/40 last:border-0">
          <td colSpan={8} className="px-2 py-2">
            <MoveTruck
              companyId={companyId}
              truck={truck}
              others={others}
              onMoved={onMoved}
              onCancel={() => setMoving(false)}
            />
          </td>
        </tr>
      )}
    </>
  );
}

/** Edits a truck in place, or adds one (`truck` undefined). */
function TruckEditor({
  companyId,
  truck,
  onDone,
}: {
  companyId: string;
  truck?: Truck;
  onDone: (saved?: Company) => void;
}) {
  const [draft, setDraft] = useState<TruckDraft>(() => (truck ? truckDraft(truck) : EMPTY_TRUCK));
  const { busy, error, run } = useAction();
  const set = (f: keyof TruckDraft) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [f]: e.target.value }));
  const input = (f: keyof TruckDraft, label: string, props: object = {}) => (
    <input
      value={draft[f]}
      onChange={set(f)}
      aria-label={label}
      placeholder={label}
      className={cx(fieldClass(f === 'unit' && !draft.unit.trim()), 'py-1')}
      {...props}
    />
  );

  const save = async () => {
    const changes = truckChanges(draft, truck);
    if (truck && Object.keys(changes).length === 0) return onDone();
    const saved = await run(() =>
      truck
        ? updateTruck(companyId, truck.id, changes)
        : addTruck(companyId, { ...changes, unit: draft.unit.trim() }),
    );
    if (saved) onDone(saved);
  };

  return (
    <tr className="border-b border-border bg-muted/40 align-top">
      <td className="py-2 pr-2">{input('unit', 'Truck #', { autoFocus: !truck })}</td>
      <td className="py-2 pr-2">
        {input('promilesUnit', 'ProMiles unit #', {
          placeholder: draft.unit.trim() ? `Same: ${draft.unit.trim()}` : 'Same as truck #',
        })}
      </td>
      <td className="py-2 pr-2">{input('vin', 'VIN', { maxLength: 17 })}</td>
      <td className="py-2 pr-2">{input('plate', 'Plate')}</td>
      <td className="space-y-1 py-2 pr-2">
        {input('odometer', 'Odometer', { inputMode: 'decimal' })}
        {input('odometerAsOf', 'As of', { type: 'date' })}
      </td>
      <td className="py-2 pr-2 text-xs text-muted-foreground">
        The odometer is where the truck&apos;s last converted period ended; the next one starts
        there.
      </td>
      <td className="py-2 pr-2">
        {input('notes', 'Notes')}
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </td>
      <td className="whitespace-nowrap py-2 text-right">
        <Button onClick={() => void save()} disabled={busy || !draft.unit.trim()} className="px-3">
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Save
        </Button>
        <Button variant="ghost" onClick={() => onDone()} className="px-2">
          Cancel
        </Button>
      </td>
    </tr>
  );
}

function DangerZone({
  company,
  others,
  onDeleted,
  onMerged,
}: {
  company: Company;
  others: Company[];
  onDeleted: () => void;
  onMerged: (target: Company) => void;
}) {
  const [into, setInto] = useState('');
  const { busy, error, run } = useAction();
  const confirm = useConfirm();
  const target = others.find((o) => o.id === into);

  const merge = async () => {
    if (!target || !(await confirm(mergeCompanyConfirm(company, target)))) return;
    const merged = await run(() => mergeCompany(company.id, target.id));
    if (merged) onMerged(merged);
  };

  const remove = async () => {
    if (!(await confirm(deleteCompanyConfirm(company)))) return;
    const done = await run(async () => {
      await deleteCompany(company.id);
      return true;
    });
    if (done) onDeleted();
  };

  return (
    <Section title="Merge or delete">
      <div className="flex flex-wrap items-center gap-2">
        {others.length > 0 && (
          <>
            <select
              value={into}
              onChange={(e) => setInto(e.target.value)}
              className={cx(fieldClass(false), 'w-auto min-w-[14rem]')}
              aria-label="Company to merge into"
            >
              <option value="">Merge into… (e.g. another spelling)</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <Button variant="secondary" disabled={!target || busy} onClick={() => void merge()}>
              <GitMerge className="size-4" aria-hidden />
              Merge
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          className="text-danger hover:bg-danger-bg hover:text-danger sm:ml-auto"
          disabled={busy}
          onClick={() => void remove()}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Trash2 className="size-4" aria-hidden />
          )}
          Delete company
        </Button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </Section>
  );
}
