/**
 * A small reader for legacy Excel `.xls` files (BIFF8 inside an OLE2 compound file), the
 * format Swift ELD and Vista ELD export. It returns each worksheet's cell VALUES only
 * (text, numbers, booleans): no formatting, so a date cell comes back as its Excel serial
 * number (see `excelDate`). Formulas give their cached result.
 *
 * Written in-house instead of adding a spreadsheet library: the exports are small, all we
 * need is the values, and it keeps the API free of a large parser dependency. References:
 * [MS-CFB] (the container) and [MS-XLS] (the BIFF8 records).
 */

export class XlsError extends Error {}

export type XlsCell = string | number | boolean | null;

export interface XlsSheet {
  name: string;
  /** Row-major, 0-based; missing cells are null and trailing ones are left out. */
  rows: XlsCell[][];
}

const MAGIC = Buffer.from('d0cf11e0a1b11ae1', 'hex');
const END_OF_CHAIN = 0xfffffffe;
const NO_STREAM = 0xffffffff;
const MAX_SECTORS = 1 << 20;

/** Cheap check: does the file start like an OLE2 compound file (any legacy Office file)? */
export function isOle2(bytes: Buffer): boolean {
  return bytes.length >= 512 && bytes.subarray(0, 8).equals(MAGIC);
}

// ---------------------------------------------------------------------------------------
// OLE2 / compound file: find one stream by name.
// ---------------------------------------------------------------------------------------

interface DirEntry {
  name: string;
  type: number;
  start: number;
  size: number;
}

function readStream(bytes: Buffer, wanted: string[]): Buffer | null {
  if (!isOle2(bytes)) throw new XlsError('not an Excel 97–2003 (.xls) file');
  const sectorShift = bytes.readUInt16LE(0x1e);
  const miniShift = bytes.readUInt16LE(0x20);
  if (sectorShift !== 9 && sectorShift !== 12) throw new XlsError('unsupported .xls sector size');
  const sectorSize = 1 << sectorShift;
  const miniSize = 1 << miniShift;
  const numFat = bytes.readUInt32LE(0x2c);
  const firstDir = bytes.readUInt32LE(0x30);
  const miniCutoff = bytes.readUInt32LE(0x38);
  const firstMiniFat = bytes.readUInt32LE(0x3c);
  let difatSector = bytes.readUInt32LE(0x44);

  const sector = (id: number) => {
    const start = (id + 1) * sectorSize;
    if (start >= bytes.length) throw new XlsError('truncated .xls file');
    return bytes.subarray(start, Math.min(start + sectorSize, bytes.length));
  };

  // The FAT's own sectors: 109 listed in the header, the rest in the DIFAT chain.
  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < numFat; i++) {
    fatSectors.push(bytes.readUInt32LE(0x4c + i * 4));
  }
  for (let guard = 0; fatSectors.length < numFat && difatSector < END_OF_CHAIN; guard++) {
    if (guard > MAX_SECTORS) throw new XlsError('broken .xls file (DIFAT loop)');
    const s = sector(difatSector);
    const perSector = sectorSize / 4 - 1;
    for (let i = 0; i < perSector && fatSectors.length < numFat; i++) {
      fatSectors.push(s.readUInt32LE(i * 4));
    }
    difatSector = s.readUInt32LE(perSector * 4);
  }
  const fat = Buffer.concat(fatSectors.map(sector));
  const next = (table: Buffer, id: number) =>
    id * 4 + 4 <= table.length ? table.readUInt32LE(id * 4) : END_OF_CHAIN;

  const chain = (start: number, read: (id: number) => Buffer, table: Buffer): Buffer => {
    const parts: Buffer[] = [];
    for (let id = start, guard = 0; id < END_OF_CHAIN; id = next(table, id), guard++) {
      if (guard > MAX_SECTORS) throw new XlsError('broken .xls file (sector loop)');
      parts.push(read(id));
    }
    return Buffer.concat(parts);
  };

  const dir = chain(firstDir, sector, fat);
  const entries: DirEntry[] = [];
  for (let off = 0; off + 128 <= dir.length; off += 128) {
    const nameLength = dir.readUInt16LE(off + 0x40);
    entries.push({
      name: dir.toString('utf16le', off, off + Math.max(0, nameLength - 2)),
      type: dir[off + 0x42],
      start: dir.readUInt32LE(off + 0x74),
      size: dir.readUInt32LE(off + 0x78),
    });
  }
  const root = entries[0];
  const entry = entries.find(
    (e) => e.type === 2 && wanted.includes(e.name.toLowerCase()) && e.start !== NO_STREAM,
  );
  if (!root || !entry) return null;

  if (entry.size >= miniCutoff) return chain(entry.start, sector, fat).subarray(0, entry.size);
  // Small streams live in the mini stream (the root entry's data), in 64-byte mini sectors.
  const miniFat = chain(firstMiniFat, sector, fat);
  const miniStream = chain(root.start, sector, fat);
  const miniSector = (id: number) => miniStream.subarray(id * miniSize, (id + 1) * miniSize);
  return chain(entry.start, miniSector, miniFat).subarray(0, entry.size);
}

// ---------------------------------------------------------------------------------------
// BIFF8 records.
// ---------------------------------------------------------------------------------------

const BOF = 0x0809;
const EOF = 0x000a;
const BOUNDSHEET = 0x0085;
const SST = 0x00fc;
const CONTINUE = 0x003c;
const LABELSST = 0x00fd;
const LABEL = 0x0204;
const NUMBER = 0x0203;
const RK = 0x027e;
const MULRK = 0x00bd;
const BOOLERR = 0x0205;
const FORMULA = 0x0006;
const STRING = 0x0207;

interface Rec {
  type: number;
  data: Buffer;
  /** Offset of the record header in the stream. */
  at: number;
}

function records(stream: Buffer, from: number): Rec[] {
  const out: Rec[] = [];
  for (let off = from; off + 4 <= stream.length;) {
    const type = stream.readUInt16LE(off);
    const length = stream.readUInt16LE(off + 2);
    if (off + 4 + length > stream.length) throw new XlsError('truncated .xls workbook');
    out.push({ type, data: stream.subarray(off + 4, off + 4 + length), at: off });
    off += 4 + length;
  }
  return out;
}

/**
 * Reads across a record and its CONTINUE records. Inside a string's characters, each new
 * piece starts with a fresh option byte (1 = two-byte characters); elsewhere it doesn't.
 */
class Pieces {
  private i = 0;
  private pos = 0;
  constructor(private readonly pieces: Buffer[]) {}

  private ensure(): Buffer {
    while (this.i < this.pieces.length && this.pos >= this.pieces[this.i].length) {
      this.i++;
      this.pos = 0;
    }
    if (this.i >= this.pieces.length) throw new XlsError('broken .xls shared strings');
    return this.pieces[this.i];
  }
  /** True when the current piece is used up (the next read starts a CONTINUE). */
  private atBoundary(): boolean {
    return this.pos >= this.pieces[this.i].length;
  }
  u8(): number {
    const piece = this.ensure();
    return piece[this.pos++];
  }
  u16(): number {
    return this.u8() | (this.u8() << 8);
  }
  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }
  skip(n: number): void {
    for (let k = 0; k < n; k++) this.u8();
  }
  /** One XLUnicodeRichExtendedString (an SST entry). */
  string(): string {
    const cch = this.u16();
    const flags = this.u8();
    let wide = (flags & 0x01) !== 0;
    const runs = flags & 0x08 ? this.u16() : 0;
    const ext = flags & 0x04 ? this.u32() : 0;
    let text = '';
    for (let k = 0; k < cch; k++) {
      if (this.i < this.pieces.length && this.atBoundary()) {
        this.i++;
        this.pos = 0;
        wide = (this.u8() & 0x01) !== 0;
      }
      text += String.fromCharCode(wide ? this.u16() : this.u8());
    }
    this.skip(runs * 4 + ext);
    return text;
  }
}

/** XLUnicodeString inside one record: `cch` (1 or 2 bytes), option byte, characters. */
function unicodeString(data: Buffer, at: number, cchBytes: 1 | 2): string {
  const cch = cchBytes === 1 ? data[at] : data.readUInt16LE(at);
  const flags = data[at + cchBytes];
  let pos = at + cchBytes + 1;
  if (flags & 0x08) pos += 2;
  if (flags & 0x04) pos += 4;
  return flags & 0x01
    ? data.toString('utf16le', pos, pos + cch * 2)
    : data.toString('latin1', pos, pos + cch);
}

function rkValue(rk: number): number {
  let value: number;
  if (rk & 0x02) {
    value = rk >> 2; // signed 30-bit integer
  } else {
    const buf = Buffer.alloc(8);
    buf.writeUInt32LE((rk & 0xfffffffc) >>> 0, 4);
    value = buf.readDoubleLE(0);
  }
  return rk & 0x01 ? value / 100 : value;
}

function sharedStrings(recs: Rec[]): string[] {
  const at = recs.findIndex((r) => r.type === SST);
  if (at < 0) return [];
  const pieces = [recs[at].data];
  for (let k = at + 1; k < recs.length && recs[k].type === CONTINUE; k++) pieces.push(recs[k].data);
  const reader = new Pieces(pieces);
  reader.u32(); // total uses
  const unique = reader.u32();
  const strings: string[] = [];
  for (let k = 0; k < unique; k++) strings.push(reader.string());
  return strings;
}

function readSheet(stream: Buffer, name: string, from: number, sst: string[]): XlsSheet {
  const rows: XlsCell[][] = [];
  const set = (row: number, col: number, value: XlsCell) => {
    (rows[row] ??= [])[col] = value;
  };
  let pendingString: [number, number] | null = null;

  for (const { type, data } of records(stream, from)) {
    if (type === EOF) break;
    switch (type) {
      case LABELSST:
        set(data.readUInt16LE(0), data.readUInt16LE(2), sst[data.readUInt32LE(6)] ?? '');
        break;
      case LABEL:
        set(data.readUInt16LE(0), data.readUInt16LE(2), unicodeString(data, 6, 2));
        break;
      case NUMBER:
        set(data.readUInt16LE(0), data.readUInt16LE(2), data.readDoubleLE(6));
        break;
      case RK:
        set(data.readUInt16LE(0), data.readUInt16LE(2), rkValue(data.readUInt32LE(6)));
        break;
      case MULRK: {
        const row = data.readUInt16LE(0);
        const first = data.readUInt16LE(2);
        const count = (data.length - 6) / 6;
        for (let k = 0; k < count; k++) {
          set(row, first + k, rkValue(data.readUInt32LE(4 + k * 6 + 2)));
        }
        break;
      }
      case BOOLERR:
        set(data.readUInt16LE(0), data.readUInt16LE(2), data[7] ? null : data[6] !== 0);
        break;
      case FORMULA: {
        const [row, col] = [data.readUInt16LE(0), data.readUInt16LE(2)];
        if (data.readUInt16LE(12) !== 0xffff) {
          set(row, col, data.readDoubleLE(6));
        } else if (data[6] === 0) {
          pendingString = [row, col]; // its text is in the STRING record that follows
        } else {
          set(row, col, data[6] === 1 ? data[8] !== 0 : null);
        }
        break;
      }
      case STRING:
        if (pendingString) set(pendingString[0], pendingString[1], unicodeString(data, 0, 2));
        pendingString = null;
        break;
    }
  }
  // Holes become null so every row is a dense array.
  return { name, rows: Array.from(rows, (r) => Array.from(r ?? [], (c) => c ?? null)) };
}

/** Every worksheet of a BIFF8 `.xls` file, in workbook order. Throws XlsError. */
export function readXls(bytes: Buffer): XlsSheet[] {
  const stream = readStream(bytes, ['workbook', 'book']);
  if (!stream) throw new XlsError('no workbook inside this .xls file');
  const globals = records(stream, 0);
  const bof = globals[0];
  if (bof?.type !== BOF || bof.data.readUInt16LE(0) !== 0x0600) {
    throw new XlsError('only Excel 97–2003 (BIFF8) .xls files can be read');
  }
  const end = globals.findIndex((r) => r.type === EOF);
  const head = globals.slice(0, end < 0 ? globals.length : end + 1);
  const sst = sharedStrings(head);
  return head
    .filter((r) => r.type === BOUNDSHEET && r.data[5] === 0) // worksheets only
    .map((r) => readSheet(stream, unicodeString(r.data, 6, 1), r.data.readUInt32LE(0), sst));
}

/** An Excel date serial (1900 system) → a UTC date: 46296 → 2026-10-01. */
export function excelDate(serial: number): Date {
  const ms = Math.round((serial - 25569) * 86_400_000);
  return new Date(ms);
}
