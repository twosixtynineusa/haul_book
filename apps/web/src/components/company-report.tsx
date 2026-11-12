'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { fieldClass } from './sources-panel';
import { Alert, Card, buttonClass } from './ui';

export function CompanyReport({ companyId }: { companyId: string }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const response = await fetch(
        `/api/v1/history/companies/${encodeURIComponent(companyId)}/report.pdf?${params}`,
      );
      if (!response.ok)
        throw new Error('Could not create the report. Check the dates and try again.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'company-mileage-report.pdf';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="Company PDF report"
      subtitle="Mileage by state and truck, from saved conversion data."
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void download();
        }}
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              max={to || undefined}
              className={fieldClass(false)}
            />
          </label>
          <label className="text-xs font-medium">
            Through
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              min={from || undefined}
              className={fieldClass(false)}
            />
          </label>
          <button
            type="submit"
            className={buttonClass()}
            disabled={busy || (!!from && !!to && from > to)}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Download className="size-4" aria-hidden />
            )}{' '}
            Download PDF
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Leave dates empty for all saved periods. Only complete trips within the dates are
          included. Repeated conversions of the same truck and period use the latest version;
          overlapping periods are flagged.
        </p>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Card>
  );
}
