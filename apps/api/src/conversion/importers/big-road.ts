import {
  ConversionError,
  parseDistance,
  stateCode,
  type ReportTruck,
  type SourceReport,
} from '../common';
import { isOle2, readXls, type XlsCell, type XlsSheet } from '../xls';
import type { Importer } from './types';

const text = (cell: XlsCell | undefined) => (cell == null ? '' : String(cell).trim());
function layout(sheets: XlsSheet[]): XlsSheet | undefined {
  return sheets.find(
    (s) =>
      s.name.trim().toLowerCase() === 'vehicle mileage' &&
      text(s.rows[0]?.[0]).toLowerCase() === 'truck' &&
      s.rows[0]?.some((c) => text(c).toLowerCase() === 'total (mi)'),
  );
}

export const bigRoadImporter: Importer = {
  id: 'big-road',
  detect(file) {
    if (!/\.xls$/i.test(file.name) || !isOle2(file.bytes)) return false;
    try {
      return !!layout(readXls(file.bytes));
    } catch {
      return false;
    }
  },
  read(file, _warnings, options = {}): SourceReport {
    let sheets: XlsSheet[];
    try {
      sheets = readXls(file.bytes);
    } catch {
      throw new ConversionError(
        `${file.name}: can't read this Big Road workbook; export it again as .xls`,
      );
    }
    const sheet = layout(sheets);
    if (!sheet)
      throw new ConversionError(
        `${file.name}: no Vehicle Mileage sheet with Truck and Total (mi) columns`,
      );
    const headers = sheet.rows[0].map(text);
    const totalIndex = headers.findIndex((h) => h.toLowerCase() === 'total (mi)');
    const states = new Set<string>();
    const columns = headers.map((h, i) => {
      if (i === 0 || i === totalIndex) return null;
      if (h.toLowerCase() === 'unknown') return 'Unknown';
      const code = stateCode(h);
      if (!code) throw new ConversionError(`${file.name}: unknown state/province column "${h}"`);
      if (states.has(code)) throw new ConversionError(`${file.name}: ${code} appears twice`);
      states.add(code);
      return code;
    });
    if (!states.size) throw new ConversionError(`${file.name}: no state mileage columns`);
    const trucks: ReportTruck[] = [];
    const period = options.period;
    if (
      period &&
      (!period.every((d) => Number.isFinite(d.getTime())) ||
        period[1] < period[0] ||
        period[0].getUTCFullYear() !== period[1].getUTCFullYear() ||
        Math.floor(period[0].getUTCMonth() / 3) !== Math.floor(period[1].getUTCMonth() / 3))
    ) {
      throw new ConversionError(
        `${file.name}: the period must stay inside one quarter and end on or after it starts`,
      );
    }
    const miles = (cell: XlsCell | undefined, where: string, blank = false): number => {
      if (blank && !text(cell)) return 0;
      const [value, suffix] = parseDistance(text(cell), where);
      const n = Number(value);
      if (!Number.isFinite(n) || suffix === 'K')
        throw new ConversionError(`${where}: expected finite miles`);
      return n;
    };
    for (const [index, row] of sheet.rows.entries()) {
      if (index === 0 || row.every((c) => !text(c))) continue;
      const unit = text(row[0]);
      if (unit.toLowerCase() === 'total') continue; // Fleet aggregate, never another truck.
      const where = `${file.name}: truck ${unit || '(missing)'} row ${index + 1}`;
      if (!unit) throw new ConversionError(`${where}: no Truck`);
      if (trucks.some((t) => t.unit === unit))
        throw new ConversionError(`${where}: truck appears twice`);
      const total = miles(row[totalIndex], where);
      const legs = columns.flatMap((state, col) => {
        if (!state) return [];
        const distance = miles(row[col], where, true);
        if (state === 'Unknown') {
          if (distance > 0)
            throw new ConversionError(
              `${where}: ${distance} Unknown miles have no state; correct the source report before converting`,
            );
          return [];
        }
        if (!distance) return [];
        return [
          {
            state,
            begin: period?.[0] ?? new Date(0),
            end: period?.[1] ?? new Date(0),
            distance: String(Math.round(distance)),
          },
        ];
      });
      if (!legs.length) {
        if (total > 0) throw new ConversionError(`${where}: positive total but no state mileage`);
        continue;
      }
      trucks.push({ unit, trips: period ? [{ period, reportedTotal: total, legs }] : [] });
    }
    if (!trucks.length) throw new ConversionError(`${file.name}: no truck mileage rows`);
    const base = {
      distanceUnit: 'M' as const,
      detectedCompany: null,
      suggestedPeriod: null,
      ...(period ? {} : { needsPeriod: true }),
    };
    if (trucks.length === 1)
      return { ...base, detectedUnit: trucks[0].unit, trips: trucks[0].trips };
    return { ...base, detectedUnit: null, trips: [], trucks };
  },
};
