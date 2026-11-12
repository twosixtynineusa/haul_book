import PDFDocument from 'pdfkit';
import * as path from 'node:path';
import type { HistoryEntry, HistoryTrip } from '@haulbook/shared';

export interface ReportPeriod {
  from?: string;
  to?: string;
}
export interface ReportTrip {
  entry: HistoryEntry;
  trip: HistoryTrip;
}

/** Latest saved conversion for the same linked truck and exact period wins. Never prorate. */
export function selectReportTrips(entries: HistoryEntry[], period: ReportPeriod) {
  const selected = new Map<string, ReportTrip>();
  let partial = 0;
  for (const entry of [...entries].sort(
    (a, b) => b.convertedAt.localeCompare(a.convertedAt) || b.id.localeCompare(a.id),
  )) {
    for (const trip of entry.trips) {
      if ((period.from && trip.endDate < period.from) || (period.to && trip.beginDate > period.to))
        continue;
      if (
        (period.from && trip.beginDate < period.from) ||
        (period.to && trip.endDate > period.to)
      ) {
        partial++;
        continue;
      }
      const key = `${entry.truckId ?? entry.unit}\u001f${trip.beginDate}\u001f${trip.endDate}`;
      if (!selected.has(key)) selected.set(key, { entry, trip });
    }
  }
  const trips = [...selected.values()].sort(
    (a, b) =>
      a.entry.unit.localeCompare(b.entry.unit, 'en', { numeric: true }) ||
      a.trip.beginDate.localeCompare(b.trip.beginDate),
  );
  const overlap = trips.some((a, i) =>
    trips
      .slice(i + 1)
      .some(
        (b) =>
          (a.entry.truckId ?? a.entry.unit) === (b.entry.truckId ?? b.entry.unit) &&
          a.trip.beginDate <= b.trip.endDate &&
          b.trip.beginDate <= a.trip.endDate,
      ),
  );
  return { trips, partial, overlap };
}

export async function companyReportPdf(
  company: { name: string; dotNumber: string | null; iftaAccount: string | null },
  entries: HistoryEntry[],
  period: ReportPeriod,
): Promise<Buffer> {
  const { trips, partial, overlap } = selectReportTrips(entries, period);
  const doc = new PDFDocument({
    size: 'LETTER',
    margin: 48,
    bufferPages: true,
    info: { Title: `${company.name} - Mileage report`, Author: 'Haul Book' },
  });
  doc.registerFont('Report', path.resolve(__dirname, '../../assets/fonts/DejaVuSans.ttf'));
  doc.registerFont(
    'Report-Bold',
    path.resolve(__dirname, '../../assets/fonts/DejaVuSans-Bold.ttf'),
  );
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  let y = 48;
  const nextPage = () => {
    doc.addPage();
    y = 48;
  };
  const space = (h: number) => {
    if (y + h > 730) nextPage();
  };
  const text = (value: string, size = 10, bold = false, color = '#243247') => {
    doc.font(bold ? 'Report-Bold' : 'Report').fontSize(size);
    const h = doc.heightOfString(value, { width: 516 });
    space(h + 8);
    doc.fillColor(color).text(value, 48, y, { width: 516 });
    y += h + 8;
  };
  const row = (left: string, right: string, bold = false) => {
    doc.font(bold ? 'Report-Bold' : 'Report').fontSize(10);
    const h =
      Math.max(
        doc.heightOfString(left, { width: 360 }),
        doc.heightOfString(right, { width: 144 }),
      ) + 12;
    space(h);
    doc.fillColor('#243247').text(left, 54, y + 5, { width: 354 });
    doc.text(right, 414, y + 5, { width: 144, align: 'right' });
    doc
      .strokeColor('#e2e8f0')
      .moveTo(48, y + h)
      .lineTo(564, y + h)
      .stroke();
    y += h;
  };
  text('HAUL BOOK  /  COMPANY MILEAGE REPORT', 10, true, '#2563eb');
  text(company.name, 22, true);
  text(
    [
      company.dotNumber && `USDOT ${company.dotNumber}`,
      company.iftaAccount && `IFTA account ${company.iftaAccount}`,
    ]
      .filter(Boolean)
      .join('  |  ') || 'Company conversion records',
  );
  text(`Reporting dates: ${period.from ?? 'Earliest saved'} to ${period.to ?? 'Latest saved'}`);
  text(
    `Generated: ${new Date().toISOString().slice(0, 10)} (UTC)  |  ${trips.length} trips  |  ${new Set(trips.map((t) => t.entry.truckId ?? t.entry.unit)).size} trucks`,
  );
  text(
    'Latest saved conversion per truck and exact trip period. Only trips fully inside the requested dates are included. Distances are the values exported to ProMiles.',
    9,
    false,
    '#64748b',
  );
  if (partial)
    text(
      `${partial} partially overlapping trip record(s) excluded; choose dates covering the complete trip to include them.`,
      10,
      true,
      '#92400e',
    );
  if (overlap)
    text(
      'Overlapping periods exist for the same truck. Aggregate totals are withheld to prevent double-counting; review the detailed trips below.',
      10,
      true,
      '#92400e',
    );
  const missing = trips.filter((t) => !t.trip.promiles).length;
  if (missing)
    text(
      `${missing} older trip(s) have summary data only. Their original CSV was unavailable or could not be matched; state totals below exclude those trips.`,
      10,
      true,
      '#92400e',
    );
  if (!trips.length) text('No converted trips match this reporting period.', 12, true);
  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (trips.length && !overlap) {
    text('DISTANCE SUMMARY', 12, true);
    for (const unit of ['M', 'K'] as const) {
      const own = trips.filter((t) => t.entry.distanceUnit === unit);
      if (!own.length) continue;
      row(
        unit === 'M'
          ? 'Total miles (including summary-only trips)'
          : 'Total kilometres (including summary-only trips)',
        fmt(own.reduce((n, t) => n + t.trip.distance, 0)),
        true,
      );
      const states = new Map<string, number>();
      for (const { trip } of own)
        for (const leg of trip.promiles?.legs ?? [])
          states.set(leg.state, (states.get(leg.state) ?? 0) + Number(leg.distance));
      for (const [state, distance] of [...states].sort(([a], [b]) => a.localeCompare(b)))
        row(state, `${fmt(distance)} ${unit === 'M' ? 'mi' : 'km'}`);
      y += 16;
    }
  }
  for (const { entry, trip } of trips) {
    space(150);
    text(`Truck ${entry.unit}  |  ProMiles ${entry.promilesUnit}`, 14, true);
    text(
      `${trip.beginDate} to ${trip.endDate}  |  ${fmt(trip.distance)} ${entry.distanceUnit === 'M' ? 'mi' : 'km'}`,
      11,
      true,
    );
    text(
      `Begin odometer: ${trip.beginOdo ?? 'Unknown (CSV placeholder 1)'}  |  End odometer: ${trip.endOdo ?? 'Unknown'}`,
      9,
    );
    text(`Source: ${entry.sourceFile}\nExport: ${entry.outputFile}`, 8, false, '#64748b');
    if (trip.promiles) {
      row('State / province', entry.distanceUnit === 'M' ? 'Miles' : 'Kilometres', true);
      for (const leg of trip.promiles.legs) row(leg.state, leg.distance);
    } else text('State detail unavailable for this older conversion.', 10, false, '#92400e');
    y += 20;
  }
  const pages = doc.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i++) {
    doc.switchToPage(i);
    doc.font('Report').fontSize(8).fillColor('#64748b');
    doc.text('Haul Book - Saved conversion data', 48, 754, { lineBreak: false });
    doc.text(`${i + 1} / ${pages.count}`, 510, 754, { lineBreak: false });
  }
  doc.end();
  return result;
}
