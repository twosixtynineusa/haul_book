import { describe, expect, it } from 'vitest';
import { buildForm, downloadUrl, errorMessage } from './api';

describe('errorMessage', () => {
  it('uses the API message', () => {
    expect(errorMessage({ statusCode: 400, message: 'bad.csv: unknown state' }, 400)).toBe(
      'bad.csv: unknown state',
    );
    expect(errorMessage({ statusCode: 400, message: ['a', 'b'] }, 400)).toBe('a; b');
  });

  it('explains oversized uploads and unknown failures', () => {
    expect(errorMessage(null, 413)).toMatch(/2 MB/);
    expect(errorMessage('<html>', 502)).toMatch(/HTTP 502/);
  });
});

describe('buildForm', () => {
  it('sends every file, the per-file choices and only the filled-in odometers', () => {
    const blob = new Blob(['x']);
    const form = buildForm([blob, blob], ['a.csv', 'b.csv'], [{ company: 'ACME' }, {}], {
      a: ' 184310 ',
      b: '  ',
    });
    expect(form.getAll('files')).toHaveLength(2);
    expect((form.getAll('files')[1] as File).name).toBe('b.csv');
    expect(form.get('sources')).toBe('[{"company":"ACME"},{}]');
    expect(form.get('odometers')).toBe('{"a":"184310"}');
  });

  it('omits odometers when none are given', () => {
    expect(buildForm([new Blob(['x'])], ['a.csv'], [{}], {}).has('odometers')).toBe(false);
  });
});

describe('downloadUrl', () => {
  it('encodes the file name', () => {
    expect(downloadUrl('promiles_2026-10_unit-22.csv')).toBe(
      '/api/v1/outputs/promiles_2026-10_unit-22.csv',
    );
  });
});
