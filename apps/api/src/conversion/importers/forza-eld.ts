import { parse } from 'csv-parse/sync';
import {
  ConversionError,
  decodeText,
  parseDate,
  parseDistance,
  stateCode,
  type Leg,
  type UploadedFile,
  type SourceReport,
} from '../common';
import type { Importer } from './types';

const TITLE = /^.+ - IFTA Mileage by State$/i;
const VEHICLE = /^Name\s*,\s*Make\s*,\s*Model\s*,\s*Year$/i;
const STATES = /^State\s*,\s*Miles$/i;
const lines = (file: UploadedFile) =>
  decodeText(file.bytes)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

function detect(file: UploadedFile): boolean {
  if (!/\.csv$/i.test(file.name)) return false;
  const head = lines({ ...file, bytes: file.bytes.subarray(0, 4096) });
  return (
    TITLE.test(head[0] ?? '') &&
    head.some((l) => VEHICLE.test(l)) &&
    head.some((l) => STATES.test(l))
  );
}

function read(file: UploadedFile, warnings: string[]): SourceReport {
  const rows = lines(file);
  if (!detect(file))
    throw new ConversionError(`${file.name}: not a Forza ELD IFTA Mileage by State report`);
  const periodLine = rows.find((l) => /^Period:/i.test(l)) ?? '';
  const p = /^Period:\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})$/i.exec(periodLine);
  if (!p) throw new ConversionError(`${file.name}: no "Period: MM/DD/YYYY - MM/DD/YYYY" line`);
  const period: [Date, Date] = [parseDate(p[1], file.name), parseDate(p[2], file.name)];
  if (period[1] < period[0])
    throw new ConversionError(`${file.name}: the period ends before it starts`);
  const company =
    rows
      .find((l) => /^Carrier:/i.test(l))
      ?.replace(/^Carrier:\s*/i, '')
      .trim() || null;
  const vehicleIndex = rows.findIndex((l) => VEHICLE.test(l));
  const stateIndex = rows.findIndex((l) => STATES.test(l));
  if (stateIndex !== vehicleIndex + 2)
    throw new ConversionError(`${file.name}: expected exactly one vehicle Name row`);
  const cells = (line: string): string[] => {
    try {
      return parse(line, { trim: true })[0];
    } catch {
      throw new ConversionError(`${file.name}: malformed CSV row; export the report again`);
    }
  };
  const unit = cells(rows[vehicleIndex + 1])[0] || null;
  const legs: Leg[] = [];
  let total = 0;
  for (const line of rows.slice(stateIndex + 1)) {
    const [state, miles = ''] = cells(line);
    const code = stateCode(state ?? '');
    if (!code) throw new ConversionError(`${file.name}: unknown state/province "${state}"`);
    if (legs.some((l) => l.state === code))
      throw new ConversionError(`${file.name}: ${code} appears twice`);
    const [distance, suffix] = parseDistance(miles, file.name);
    if (suffix === 'K') throw new ConversionError(`${file.name}: expected miles, not kilometres`);
    if (!Number.isFinite(Number(distance)))
      throw new ConversionError(`${file.name}: expected finite miles`);
    total += Number(distance);
    legs.push({
      state: code,
      begin: period[0],
      end: period[1],
      distance: String(Math.round(Number(distance))),
    });
  }
  if (!legs.length) throw new ConversionError(`${file.name}: no state mileage rows`);
  if (
    period[0].getUTCMonth() !== period[1].getUTCMonth() ||
    period[0].getUTCFullYear() !== period[1].getUTCFullYear()
  ) {
    warnings.push(
      `${file.name}: covers more than one month; ProMiles gets one trip for the whole period (this export has no per-month split)`,
    );
  }
  return {
    trips: [{ period, reportedTotal: Math.round(total * 100) / 100, legs }],
    distanceUnit: 'M',
    detectedCompany: company,
    detectedUnit: unit,
  };
}

export const forzaEldImporter: Importer = { id: 'forza-eld', detect, read };
