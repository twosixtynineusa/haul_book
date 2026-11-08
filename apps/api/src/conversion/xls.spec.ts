import {
  compoundFile,
  record,
  unicodeString,
  workbookStream,
  xlsFile,
} from '../../test/helpers/xls-writer';
import { XlsError, excelDate, isOle2, readXls } from './xls';

/** A cell record's row / column / format prefix. */
const at = (row: number, col: number) => {
  const b = Buffer.alloc(6);
  b.writeUInt16LE(row, 0);
  b.writeUInt16LE(col, 2);
  b.writeUInt16LE(0x0f, 4);
  return b;
};
const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const rk = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const double = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(n);
  return b;
};

describe('readXls', () => {
  it('reads every worksheet with its text, numbers and booleans', () => {
    const bytes = xlsFile([
      {
        name: 'First',
        rows: [
          ['Truck', 'Miles'],
          ['0412', 1204.55],
          [null, 7, true],
        ],
      },
      { name: 'Second', rows: [[], ['Ünit ✓', -3]] },
    ]);
    expect(isOle2(bytes)).toBe(true);
    expect(readXls(bytes)).toEqual([
      {
        name: 'First',
        rows: [
          ['Truck', 'Miles'],
          ['0412', 1204.55],
          [null, 7, true],
        ],
      },
      { name: 'Second', rows: [[], ['Ünit ✓', -3]] },
    ]);
  });

  it('reads RK, MULRK, LABEL, FORMULA and error cells', () => {
    const formula = (row: number, col: number, result: Buffer) =>
      record(0x0006, Buffer.concat([at(row, col), result, Buffer.alloc(6)]));
    const records = [
      record(0x027e, Buffer.concat([at(0, 0), rk((12345 << 2) | 0x03)])), // int ÷ 100
      record(0x027e, Buffer.concat([at(0, 1), rk(0x3ff00000)])), // 1.0 as a float RK
      // MULRK: row 1, columns 0–1: xf + RK pairs, then the last column.
      record(
        0x00bd,
        Buffer.concat([
          u16(1),
          u16(0),
          u16(0x0f),
          rk((5 << 2) | 2),
          u16(0x0f),
          rk((-6 << 2) | 2),
          u16(1),
        ]),
      ),
      record(0x0204, Buffer.concat([at(2, 0), unicodeString('Wide ✓', 2)])),
      formula(3, 0, double(42.5)),
      formula(3, 1, Buffer.from([0, 0, 0, 0, 0, 0, 0xff, 0xff])),
      record(0x0207, unicodeString('from a formula', 2)),
      formula(3, 2, Buffer.from([1, 0, 1, 0, 0, 0, 0xff, 0xff])),
      record(0x0205, Buffer.concat([at(4, 0), Buffer.from([0x07, 1])])), // #DIV/0!
    ];
    const [sheet] = readXls(compoundFile(workbookStream([{ name: 'Raw', records }])));
    expect(sheet.rows).toEqual([
      [123.45, 1],
      [5, -6],
      ['Wide ✓'],
      [42.5, 'from a formula', true],
      [null],
    ]);
  });

  it('reads shared strings split across CONTINUE records, even mid-string', () => {
    // ~30 KB of strings: several CONTINUE records, some breaking inside a string, and a wide
    // string so a continued piece switches character width.
    const strings = Array.from({ length: 1500 }, (_, i) =>
      i % 97 === 0 ? `wïde ✓ string ${i}` : `state row number ${i}`,
    );
    const stream = workbookStream([{ name: 'Big', rows: strings.map((s) => [s]) }]);
    const sheet = readXls(compoundFile(stream))[0];
    expect(sheet.rows.map((r) => r[0])).toEqual(strings);
  });

  it('reads a small workbook kept in the mini stream', () => {
    const stream = workbookStream([{ name: 'Tiny', rows: [['TX', 1]] }]);
    expect(stream.length).toBeLessThan(4096);
    expect(readXls(compoundFile(stream))[0].rows).toEqual([['TX', 1]]);
  });

  it.each([
    [Buffer.from('Truck,State\n22,TX\n'), /not an Excel 97–2003/],
    [compoundFile(Buffer.alloc(8000), 'Something else'), /no workbook/],
    [compoundFile(workbookStream([{ name: 'Old', rows: [] }], 0x0500)), /only Excel 97–2003/],
  ])('refuses what it can’t read (%#)', (bytes, reason) => {
    expect(() => readXls(bytes)).toThrow(XlsError);
    expect(() => readXls(bytes)).toThrow(reason);
  });

  it('turns an Excel date serial into a date', () => {
    expect(excelDate(46296).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
});
