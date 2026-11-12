'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Building2, Loader2 } from 'lucide-react';
import { sourceName, type Company } from '@haulbook/shared';
import { listCompanies } from '@/lib/api';
import { formatDateTime, plural } from '@/lib/format';
import { CompanyDetail } from './company-detail';
import { CompanyFiles } from './company-files';
import { CompanyReport } from './company-report';
import { Alert, Button, Card, buttonClass } from './ui';

/** A directly linkable company page, with the same edit, move and merge controls as before. */
export function CompanyPage({ id }: { id: string }) {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    setError(null);
    void listCompanies().then(
      (result) => {
        if (active) setCompanies(result.companies);
      },
      (reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      },
    );
    return () => {
      active = false;
    };
  }, [id, attempt]);

  const company = companies?.find((c) => c.id === id);
  const replace = (...saved: Company[]) =>
    setCompanies((previous) => previous?.map((c) => saved.find((s) => s.id === c.id) ?? c) ?? null);

  return (
    <div className="space-y-6">
      <Link href="/companies" className={buttonClass('ghost', 'px-2')}>
        <ArrowLeft className="size-4" aria-hidden /> All companies
      </Link>
      {error ? (
        <Alert tone="danger" title="This company can't be shown">
          <p>{error}</p>
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </Alert>
      ) : !companies ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Loading company…
        </p>
      ) : !company ? (
        <Alert tone="warning" title="Company not found">
          This company may have been deleted or merged. Choose a company from the list.
        </Alert>
      ) : (
        <>
          <header className="space-y-2">
            <div className="flex items-center gap-3">
              <Building2 className="size-6 shrink-0 text-muted-foreground" aria-hidden />
              <h1 className="break-words text-2xl font-semibold">{company.name}</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              {plural(company.trucks.length, 'truck')}
              {company.dotNumber && ` · USDOT ${company.dotNumber}`}
              {company.source && ` · ${sourceName(company.source)}`}
              {company.lastConvertedAt &&
                ` · Last converted ${formatDateTime(company.lastConvertedAt)}`}
            </p>
          </header>
          <CompanyReport companyId={id} />
          <Card title="Company details & trucks">
            <CompanyDetail
              company={company}
              others={companies.filter((c) => c.id !== id)}
              onSaved={replace}
              onDeleted={() => router.replace('/companies')}
              onMerged={(target) => router.replace(`/companies/${target.id}`)}
              onTruckMoved={(moved) => replace(moved.from, moved.into)}
            />
          </Card>
          <CompanyFiles companyId={id} onUpdated={refresh} />
        </>
      )}
    </div>
  );
}
