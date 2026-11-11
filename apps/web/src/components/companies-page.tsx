'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, ChevronDown, ChevronRight, Loader2, Plus, Search } from 'lucide-react';
import { sourceName, type Company } from '@haulbook/shared';
import { createCompany, listCompanies } from '@/lib/api';
import { filterCompanies } from '@/lib/companies';
import { formatDateTime, plural } from '@/lib/format';
import { CompanyDetail } from './company-detail';
import { fieldClass } from './sources-panel';
import { Alert, Button, Card, buttonClass, cx } from './ui';

const byName = (a: Company, b: Company) =>
  a.name.localeCompare(b.name, 'en', { numeric: true, sensitivity: 'base' });

/**
 * The Companies tab: every saved company with its trucks. Conversions add them
 * automatically; here they're searched, added, edited, merged and deleted.
 */
export function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setCompanies((await listCompanies()).companies);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    // `/companies?company=<id>` (a truck page's links) opens that company.
    const wanted = new URLSearchParams(window.location.search).get('company');
    if (wanted) setOpenId(wanted);
  }, [refresh]);

  const replace = (company: Company) =>
    setCompanies((prev) =>
      [...(prev ?? []).filter((c) => c.id !== company.id), company].sort(byName),
    );
  const drop = (id: string) => setCompanies((prev) => prev?.filter((c) => c.id !== id) ?? null);

  const add = async () => {
    setSaving(true);
    setAddError(null);
    try {
      const company = await createCompany({ name: newName });
      replace(company);
      setOpenId(company.id);
      setAdding(false);
      setNewName('');
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const shown = useMemo(() => filterCompanies(companies ?? [], query), [companies, query]);
  const truckCount = companies?.reduce((n, c) => n + c.trucks.length, 0) ?? 0;

  return (
    <Card
      title="Companies"
      action={
        companies && (
          <span className="text-xs text-muted-foreground">
            {plural(companies.length, 'company', 'companies')} · {plural(truckCount, 'truck')}
          </span>
        )
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Companies and trucks are added automatically when a file is converted. Each company
          imports from its one approved source: a file from a different source waits on the
          Dashboard until you confirm it, which makes that source the approved one. Click a truck #
          to see the truck and every report converted for it.
        </p>

        <div className="flex flex-wrap gap-2">
          <label className="relative min-w-[14rem] flex-1">
            <span className="sr-only">Search companies</span>
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by company, USDOT #, truck #, VIN or plate"
              className={cx(fieldClass(false), 'pl-8')}
            />
          </label>
          <Button onClick={() => setAdding((a) => !a)} variant={adding ? 'secondary' : 'primary'}>
            <Plus className="size-4" aria-hidden />
            Add company
          </Button>
        </div>

        {adding && (
          <form
            className="flex flex-wrap items-start gap-2 rounded-lg border border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <label className="min-w-[14rem] flex-1 text-xs font-medium text-muted-foreground">
              Company name
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. ACME TRUCKING LLC"
                className={cx(fieldClass(false), 'mt-1')}
              />
            </label>
            <div className="flex gap-2 pt-5">
              <button type="submit" disabled={saving || !newName.trim()} className={buttonClass()}>
                {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
                Save
              </button>
              <Button variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
            {addError && <p className="w-full text-xs text-danger">{addError}</p>}
          </form>
        )}

        {error && <Alert tone="danger">{error}</Alert>}
        {!companies && !error && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
          </p>
        )}
        {companies?.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No companies yet. Convert a report, or add one above.
          </p>
        )}
        {companies && companies.length > 0 && shown.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No company matches “{query}”.
          </p>
        )}

        <ul className="space-y-2">
          {shown.map((c) => {
            const open = openId === c.id;
            return (
              <li key={c.id} className="rounded-lg border border-border">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : c.id)}
                  aria-expanded={open}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-muted/50"
                >
                  {open ? (
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                  {c.source && (
                    <span
                      className="rounded bg-primary-soft px-1.5 py-0.5 text-[11px] font-medium text-primary"
                      title="Approved source"
                    >
                      {sourceName(c.source)}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {plural(c.trucks.length, 'truck')}
                    {c.dotNumber && ` · USDOT ${c.dotNumber}`}
                    {c.lastConvertedAt && ` · last converted ${formatDateTime(c.lastConvertedAt)}`}
                  </span>
                </button>
                {open && (
                  <CompanyDetail
                    company={c}
                    others={(companies ?? []).filter((o) => o.id !== c.id)}
                    onSaved={replace}
                    onDeleted={() => {
                      drop(c.id);
                      setOpenId(null);
                    }}
                    onMerged={(target) => {
                      drop(c.id);
                      replace(target);
                      setOpenId(target.id);
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}
