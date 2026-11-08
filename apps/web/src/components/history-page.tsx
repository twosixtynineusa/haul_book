'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Search } from 'lucide-react';
import type { HistoryList } from '@haulbook/shared';
import { listHistory } from '@/lib/api';
import { formatDistance, plural } from '@/lib/format';
import { filterHistory, historyTotals, rangeText } from '@/lib/history';
import { HistoryTable } from './history-table';
import { fieldClass } from './sources-panel';
import { Alert, Button, Card, cx } from './ui';

const PAGE = 200;
/** The most the API returns at once (HistoryQuerySchema). */
const MAX_LIMIT = 1000;

/**
 * The History tab: every report converted, from an upload or the input folder, newest
 * first, with its dates, odometers and miles. A unit # opens that truck's page.
 */
export function HistoryPage() {
  const [history, setHistory] = useState<HistoryList | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setHistory(await listHistory({ limit }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const shown = useMemo(() => filterHistory(history?.entries ?? [], query), [history, query]);
  const totals = historyTotals(shown);

  return (
    <Card
      title="Conversion history"
      action={
        <div className="flex items-center gap-2">
          {history && (
            <span className="text-xs text-muted-foreground">
              {plural(totals.reports, 'report')}
              {totals.miles > 0 && ` · ${formatDistance(totals.miles, 'M')}`}
              {totals.km > 0 && ` · ${formatDistance(totals.km, 'K')}`}
              {totals.from && totals.to && ` · ${rangeText(totals.from, totals.to)}`}
            </span>
          )}
          <Button
            variant="ghost"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Refresh"
          >
            <RefreshCw className={cx('size-4', loading && 'animate-spin')} />
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Every report written to a ProMiles file is logged here, one row per truck: the dates it
          covers, the odometer at its start and end, and its total miles. Open a row for its trips;
          click a unit # to see that truck.
        </p>
        <label className="relative block">
          <span className="sr-only">Search the history</span>
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by company, unit #, source, file name or state"
            className={cx(fieldClass(false), 'pl-8')}
          />
        </label>

        {error && <Alert tone="danger">{error}</Alert>}
        {!history && !error && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
          </p>
        )}
        {history?.entries.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing converted yet. Reports show up here as soon as they&apos;re converted.
          </p>
        )}
        {history && history.entries.length > 0 && shown.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No report matches “{query}”.
          </p>
        )}
        {shown.length > 0 && <HistoryTable entries={shown} />}
        {history?.more && limit < MAX_LIMIT && (
          <Button
            variant="secondary"
            disabled={loading}
            onClick={() => setLimit((l) => Math.min(l + PAGE, MAX_LIMIT))}
          >
            {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Show older reports
          </Button>
        )}
      </div>
    </Card>
  );
}
