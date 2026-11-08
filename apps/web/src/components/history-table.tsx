'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Download, FolderInput, Upload } from 'lucide-react';
import { sourceName, type HistoryEntry } from '@haulbook/shared';
import { downloadUrl } from '@/lib/api';
import { formatDateTime, formatDistance } from '@/lib/format';
import { formatOdo, rangeText } from '@/lib/history';
import { cx } from './ui';

/**
 * Converted reports, one row per truck per source file: when, which truck, the dates it
 * covers, the odometer where it began and ended, and its miles. A row opens to show its
 * trips (usually one per month). The unit # opens the truck's own page.
 */
export function HistoryTable({
  entries,
  showTruck = true,
}: {
  entries: HistoryEntry[];
  /** False on a truck's own page, where company and unit # go without saying. */
  showTruck?: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const columns = showTruck ? 10 : 8;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-muted-foreground">
          <tr className="border-b border-border">
            <th className="w-6 py-2" aria-label="Trips" />
            <th className="py-2 pr-3 font-medium">Converted</th>
            {showTruck && <th className="py-2 pr-3 font-medium">Company</th>}
            {showTruck && <th className="py-2 pr-3 font-medium">Unit #</th>}
            <th className="py-2 pr-3 font-medium">Source</th>
            <th className="py-2 pr-3 font-medium">Dates</th>
            <th className="py-2 pr-3 text-right font-medium">Begin odo</th>
            <th className="py-2 pr-3 text-right font-medium">End odo</th>
            <th className="py-2 pr-3 text-right font-medium">Total</th>
            <th className="py-2 font-medium">
              <span className="sr-only">Download</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const expanded = open.has(e.id);
            return (
              <Fragment key={e.id}>
                <tr className={cx('border-b border-border align-top', expanded && 'bg-muted/40')}>
                  <td className="py-2.5">
                    <button
                      type="button"
                      onClick={() => toggle(e.id)}
                      aria-expanded={expanded}
                      aria-label={`${expanded ? 'Hide' : 'Show'} the trips of ${e.sourceFile}`}
                      className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {expanded ? (
                        <ChevronDown className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </button>
                  </td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-xs">
                    {formatDateTime(e.convertedAt)}
                    <p
                      className="flex items-center gap-1 text-muted-foreground"
                      title={e.origin === 'inbox' ? 'From the input folder' : 'Uploaded here'}
                    >
                      {e.origin === 'inbox' ? (
                        <FolderInput className="size-3" aria-hidden />
                      ) : (
                        <Upload className="size-3" aria-hidden />
                      )}
                      {e.origin === 'inbox' ? 'input folder' : 'upload'}
                    </p>
                  </td>
                  {showTruck && <td className="py-2.5 pr-3">{e.company}</td>}
                  {showTruck && (
                    <td className="whitespace-nowrap py-2.5 pr-3 font-semibold">
                      {e.truckId ? (
                        <Link
                          href={`/trucks/${e.truckId}`}
                          className="text-primary hover:underline"
                          title="See this truck and all its reports"
                        >
                          {e.unit}
                        </Link>
                      ) : (
                        <span title="This truck was deleted">{e.unit}</span>
                      )}
                    </td>
                  )}
                  <td className="py-2.5 pr-3 text-xs">
                    {e.source ? sourceName(e.source) : '—'}
                    <p
                      className="max-w-[12rem] truncate text-muted-foreground"
                      title={e.sourceFile}
                    >
                      {e.sourceFile}
                    </p>
                  </td>
                  <td className="whitespace-nowrap py-2.5 pr-3">
                    {rangeText(e.beginDate, e.endDate)}
                    {e.trips.length > 1 && (
                      <p className="text-xs text-muted-foreground">{e.trips.length} trips</p>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{formatOdo(e.beginOdo)}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{formatOdo(e.endOdo)}</td>
                  <td className="whitespace-nowrap py-2.5 pr-3 text-right font-medium tabular-nums">
                    {formatDistance(e.distance, e.distanceUnit)}
                  </td>
                  <td className="py-1.5 text-right">
                    <a
                      href={downloadUrl(e.outputFile)}
                      download={e.outputFile}
                      className="inline-flex rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={`Download ${e.outputFile}`}
                      title={e.outputFile}
                    >
                      <Download className="size-4" />
                    </a>
                  </td>
                </tr>
                {expanded && (
                  <tr className="border-b border-border bg-muted/40">
                    <td />
                    <td colSpan={columns - 1} className="pb-3 pr-3">
                      <p className="mb-1 text-xs text-muted-foreground">
                        ProMiles file <code>{e.outputFile}</code>
                      </p>
                      <table className="w-full text-xs">
                        <thead className="text-muted-foreground">
                          <tr>
                            <th className="py-1 pr-3 text-left font-medium">Trip</th>
                            <th className="py-1 pr-3 text-right font-medium">Begin odo</th>
                            <th className="py-1 pr-3 text-right font-medium">End odo</th>
                            <th className="py-1 pr-3 text-right font-medium">Miles</th>
                            <th className="py-1 text-left font-medium">States</th>
                          </tr>
                        </thead>
                        <tbody>
                          {e.trips.map((t) => (
                            <tr key={`${t.beginDate}:${t.endDate}`}>
                              <td className="py-1 pr-3">{rangeText(t.beginDate, t.endDate)}</td>
                              <td className="py-1 pr-3 text-right tabular-nums">
                                {formatOdo(t.beginOdo)}
                              </td>
                              <td className="py-1 pr-3 text-right tabular-nums">
                                {formatOdo(t.endOdo)}
                              </td>
                              <td className="py-1 pr-3 text-right tabular-nums">
                                {formatDistance(t.distance, e.distanceUnit)}
                              </td>
                              <td className="py-1">{t.states.join(' → ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {e.beginOdo === null && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          No odometer was known for this report, so ProMiles got the placeholder
                          Begin Odo 1.
                        </p>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
