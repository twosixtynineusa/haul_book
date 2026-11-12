'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Company, HistoryList, OutputList } from '@haulbook/shared';
import { listCompanies, listHistory, listOutputs } from '@/lib/api';
import { InboxPending, useInbox } from './inbox-panel';
import { InboxRecent } from './inbox-recent';
import { OutputFiles } from './output-files';
import { HistoryTable } from './history-table';
import { Alert, Card } from './ui';

/** Files are selected server-side by saved company/truck links, never filename prefixes. */
export function CompanyFiles({
  companyId,
  truckId,
  onUpdated,
}: {
  companyId: string;
  truckId?: string;
  onUpdated?: () => void;
}) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [outputs, setOutputs] = useState<OutputList | null>(null);
  const [history, setHistory] = useState<HistoryList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [saved, files, reports] = await Promise.all([
        listCompanies(),
        listOutputs({ companyId, truckId }),
        listHistory({ companyId, truckId, limit: 1000 }),
      ]);
      setCompanies(saved.companies);
      setOutputs(files);
      setHistory(reports);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [companyId, truckId]);
  const changed = useCallback(() => {
    void refresh();
    onUpdated?.();
  }, [refresh, onUpdated]);
  const inbox = useInbox(changed, { companyId, truckId });
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <div className="space-y-6">
      <InboxPending state={inbox} companies={companies} />
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <InboxRecent state={inbox} companies={companies} />
        <OutputFiles outputs={outputs} error={error} loading={loading} onRefresh={changed} />
      </div>
      {!truckId && (
        <Card title="Converted reports">
          {error && <Alert tone="danger">{error}</Alert>}
          {history?.entries.length ? (
            <HistoryTable entries={history.entries} />
          ) : (
            <p className="text-sm text-muted-foreground">No converted reports yet.</p>
          )}
          {history?.more && (
            <p className="text-sm text-muted-foreground">
              Showing the latest 1,000 records. Company PDFs include all matching records.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
