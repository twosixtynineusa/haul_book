import {
  ApiErrorSchema,
  CompanyListSchema,
  CompanySchema,
  HistoryListSchema,
  InboxEntrySchema,
  InboxListSchema,
  ConversionPreviewSchema,
  ConversionResultSchema,
  OutputListSchema,
  TruckDetailSchema,
  type Company,
  type CompanyInput,
  type CompanyList,
  type CompanyUpdate,
  type HistoryList,
  type HistoryQuery,
  type TruckDetail,
  type TruckInput,
  type TruckUpdate,
  type InboxEntry,
  type InboxList,
  type ConversionPreview,
  type ConversionResult,
  type OutputList,
  type SourceChoice,
} from '@haulbook/shared';
import type { ZodType } from 'zod';

/**
 * Browser-side client for the NestJS API. Every path is same-origin — Next.js
 * rewrites `/api/v1/*` to the api container (see next.config.ts).
 */

export class ApiRequestError extends Error {}

export function errorMessage(body: unknown, status: number): string {
  if (status === 413) return 'File too large — the limit is 2 MB per file.';
  const parsed = ApiErrorSchema.safeParse(body);
  if (parsed.success) {
    const { message } = parsed.data;
    return Array.isArray(message) ? message.join('; ') : message;
  }
  return `Request failed (HTTP ${status}). Is the API running? Try: make ps`;
}

/**
 * Multipart body: every file under `files`, the per-file choices as `sources`
 * (aligned with the files), and the non-empty odometer readings as JSON.
 */
export function buildForm(
  files: Blob[],
  names: string[],
  sources: SourceChoice[],
  odometers: Record<string, string>,
) {
  const form = new FormData();
  files.forEach((file, i) => form.append('files', file, names[i]));
  form.append('sources', JSON.stringify(sources));
  const readings = Object.fromEntries(
    Object.entries(odometers)
      .map(([key, value]) => [key, value.trim()])
      .filter(([, value]) => value !== ''),
  );
  if (Object.keys(readings).length > 0) form.append('odometers', JSON.stringify(readings));
  return form;
}

async function request<T>(path: string, init: RequestInit, schema: ZodType<T>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { cache: 'no-store', ...init });
  } catch {
    throw new ApiRequestError('Could not reach the portal API. Is it running? Try: make up');
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ApiRequestError(errorMessage(body, res.status));
  return schema.parse(body);
}

function post<T>(
  path: string,
  files: File[],
  sources: SourceChoice[],
  odometers: Record<string, string>,
  schema: ZodType<T>,
) {
  const form = buildForm(
    files,
    files.map((f) => f.name),
    sources,
    odometers,
  );
  return request<T>(path, { method: 'POST', body: form }, schema);
}

export function previewConversion(
  files: File[],
  sources: SourceChoice[],
  odometers: Record<string, string> = {},
) {
  return post<ConversionPreview>(
    '/api/v1/conversions/preview',
    files,
    sources,
    odometers,
    ConversionPreviewSchema,
  );
}

export function convertFiles(
  files: File[],
  sources: SourceChoice[],
  odometers: Record<string, string>,
) {
  return post<ConversionResult>(
    '/api/v1/conversions',
    files,
    sources,
    odometers,
    ConversionResultSchema,
  );
}

export function listOutputs() {
  return request<OutputList>('/api/v1/outputs', { method: 'GET' }, OutputListSchema);
}

export function listCompanies() {
  return request<CompanyList>('/api/v1/companies', { method: 'GET' }, CompanyListSchema);
}

const jsonBody = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const companyPath = (id: string, ...rest: string[]) =>
  ['/api/v1/companies', id, ...rest].map((p, i) => (i ? encodeURIComponent(p) : p)).join('/');

/** Companies tab: every call returns the company as saved (contracts in companies.ts). */
export const createCompany = (input: CompanyInput) =>
  request<Company>('/api/v1/companies', jsonBody('POST', input), CompanySchema);
export const updateCompany = (id: string, input: CompanyUpdate) =>
  request<Company>(companyPath(id), jsonBody('PATCH', input), CompanySchema);
export const mergeCompany = (id: string, into: string) =>
  request<Company>(companyPath(id, 'merge'), jsonBody('POST', { into }), CompanySchema);
export const addTruck = (id: string, input: TruckInput) =>
  request<Company>(companyPath(id, 'trucks'), jsonBody('POST', input), CompanySchema);
export const updateTruck = (id: string, truckId: string, input: TruckUpdate) =>
  request<Company>(companyPath(id, 'trucks', truckId), jsonBody('PATCH', input), CompanySchema);
export const deleteTruck = (id: string, truckId: string) =>
  request<Company>(companyPath(id, 'trucks', truckId), { method: 'DELETE' }, CompanySchema);

export async function deleteCompany(id: string): Promise<void> {
  const res = await fetch(companyPath(id), { method: 'DELETE' }).catch(() => null);
  if (!res)
    throw new ApiRequestError('Could not reach the portal API. Is it running? Try: make up');
  if (!res.ok)
    throw new ApiRequestError(errorMessage(await res.json().catch(() => null), res.status));
}

export function downloadUrl(name: string): string {
  return `/api/v1/outputs/${encodeURIComponent(name)}`;
}

/** The watched input folder (INPUT_DIR): files needing attention + recently processed. */
export function listInbox() {
  return request<InboxList>('/api/v1/inbox', { method: 'GET' }, InboxListSchema);
}

function inboxAction(id: string, action: 'retry' | 'dismiss') {
  return request<InboxEntry>(
    `/api/v1/inbox/${encodeURIComponent(id)}/${action}`,
    { method: 'POST' },
    InboxEntrySchema,
  );
}

/** Fill in what a waiting file is missing; the API converts and archives it right away. */
export function resolveInbox(id: string, choice: SourceChoice) {
  return request<InboxEntry>(
    `/api/v1/inbox/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(choice),
    },
    InboxEntrySchema,
  );
}

export const retryInbox = (id: string) => inboxAction(id, 'retry');
export const dismissInbox = (id: string) => inboxAction(id, 'dismiss');

/** Ask the worker to scan the input folder now. */
export async function scanInbox(): Promise<void> {
  const res = await fetch('/api/v1/inbox/scan', { method: 'POST' }).catch(() => null);
  if (!res?.ok)
    throw new ApiRequestError('Could not start a scan. Is the worker running? Try: make ps');
}

/** Converted reports, newest first; optionally one company's or one truck's. */
export function listHistory(query: HistoryQuery = {}) {
  const params = new URLSearchParams(
    Object.entries(query)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  );
  const qs = params.size ? `?${params}` : '';
  return request<HistoryList>(`/api/v1/history${qs}`, { method: 'GET' }, HistoryListSchema);
}

/** One truck, its company and every report converted for it. */
export function getTruck(id: string) {
  return request<TruckDetail>(
    `/api/v1/trucks/${encodeURIComponent(id)}`,
    { method: 'GET' },
    TruckDetailSchema,
  );
}
