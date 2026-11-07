import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES } from '@haulbook/shared';
import { mergeFiles } from './files';

const f = (name: string, size = 100) => ({ name, size });

describe('mergeFiles', () => {
  it('adds CSV and Excel files and skips exact duplicates', () => {
    const { files, rejected } = mergeFiles(
      [f('a.csv')],
      [f('a.csv'), f('B.CSV'), f('motive.xlsx'), f('vista.XLS')],
    );
    expect(files.map((x) => x.name)).toEqual(['a.csv', 'B.CSV', 'motive.xlsx', 'vista.XLS']);
    expect(rejected).toEqual([]);
  });

  it('rejects non-CSV and oversized files with a reason', () => {
    const { files, rejected } = mergeFiles([], [f('shot.png'), f('big.csv', MAX_UPLOAD_BYTES + 1)]);
    expect(files).toEqual([]);
    expect(rejected).toEqual([
      'shot.png: only .csv, .xlsx, .xls files are accepted',
      'big.csv: larger than 2 MB',
    ]);
  });

  it('caps the number of files', () => {
    const current = Array.from({ length: MAX_UPLOAD_FILES }, (_, i) => f(`${i}.csv`));
    const { files, rejected } = mergeFiles(current, [f('extra.csv')]);
    expect(files).toHaveLength(MAX_UPLOAD_FILES);
    expect(rejected[0]).toMatch(/at most 20 files/);
  });
});
