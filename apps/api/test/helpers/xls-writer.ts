/**
 * Test-only writer for legacy Excel `.xls` files (BIFF8 in an OLE2 compound file), the
 * mirror of src/conversion/xls.ts. It builds made-up fixtures in the exact workbook layout
 * Swift ELD / Vista ELD export, so no real export ever lands in the repository. Strings go
 * through the shared-string table (LABELSST, split across CONTINUE records when long, as
 * Excel does), whole numbers as RK, the rest as NUMBER.
 */

export type Cell = string | number | boolean | null;

export interface SheetSpec {
  name: string;
  rows?: Cell[][];
  /** Raw cell records written instead of `rows` (to exercise other record types). */
  records?: Buffer[];
}

const SECTOR = 512;
const MINI = 64;
const MINI_CUTOFF = 4096;
const END = 0xfffffffe;
const FREE = 0xffffffff;
const FAT_SECTOR = 0xfffffffd;
/** The most data one BIFF record holds; the rest goes in CONTINUE records. */
const MAX_RECORD = 8224;

const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};

export function record(type: number, data: Buffer): Buffer {
  return Buffer.concat([u16(type), u16(data.length), data]);
}

const isWide = (s: string) => [...s].some((c) => c.charCodeAt(0) > 0xff);
const chars = (s: string, wide: boolean) =>
  wide ? Buffer.from(s, 'utf16le') : Buffer.from(s, 'latin1');

/** XLUnicodeString: `cch` (1 or 2 bytes), option byte, characters. */
export function unicodeString(s: string, cchBytes: 1 | 2): Buffer {
  const wide = isWide(s);
  const cch = cchBytes === 1 ? Buffer.from([s.length]) : u16(s.length);
  return Buffer.concat([cch, Buffer.from([wide ? 1 : 0]), chars(s, wide)]);
}

/** SST, then CONTINUE records; a string split across them restarts with its option byte. */
function sstRecords(strings: string[]): Buffer[] {
  const pieces: Buffer[][] = [[u32(strings.length), u32(strings.length)]];
  let size = 8;
  const push = (b: Buffer) => {
    pieces[pieces.length - 1].push(b);
    size += b.length;
  };
  const next = () => {
    pieces.push([]);
    size = 0;
  };
  for (const s of strings) {
    const wide = isWide(s);
    const width = wide ? 2 : 1;
    if (size + 3 + width > MAX_RECORD) next(); // header + one character never split
    push(Buffer.concat([u16(s.length), Buffer.from([wide ? 1 : 0])]));
    let rest = chars(s, wide);
    while (rest.length > 0) {
      const room = Math.floor((MAX_RECORD - size) / width) * width;
      if (room === 0) {
        next();
        push(Buffer.from([wide ? 1 : 0]));
        continue;
      }
      push(rest.subarray(0, room));
      rest = rest.subarray(room);
    }
  }
  return pieces.map((p, i) => record(i === 0 ? 0x00fc : 0x003c, Buffer.concat(p)));
}

function cellRecords(rows: Cell[][], sst: string[]): Buffer[] {
  const out: Buffer[] = [];
  rows.forEach((row, r) =>
    row.forEach((value, c) => {
      const at = Buffer.concat([u16(r), u16(c), u16(0x0f)]);
      if (value === null) return;
      if (typeof value === 'string') {
        let index = sst.indexOf(value);
        if (index < 0) index = sst.push(value) - 1;
        out.push(record(0x00fd, Buffer.concat([at, u32(index)])));
      } else if (typeof value === 'boolean') {
        out.push(record(0x0205, Buffer.concat([at, Buffer.from([value ? 1 : 0, 0])])));
      } else if (Number.isInteger(value) && Math.abs(value) < 2 ** 29) {
        out.push(record(0x027e, Buffer.concat([at, u32(((value << 2) | 0x02) >>> 0)])));
      } else {
        const num = Buffer.alloc(8);
        num.writeDoubleLE(value);
        out.push(record(0x0203, Buffer.concat([at, num])));
      }
    }),
  );
  return out;
}

const bof = (type: number, version = 0x0600) =>
  record(0x0809, Buffer.concat([u16(version), u16(type), Buffer.alloc(12)]));
const eof = () => record(0x000a, Buffer.alloc(0));

/** The Workbook stream: globals (sheet list, shared strings), then each worksheet. */
export function workbookStream(sheets: SheetSpec[], version = 0x0600): Buffer {
  const sst: string[] = [];
  const bodies = sheets.map((s) =>
    Buffer.concat([bof(0x0010, version), ...(s.records ?? cellRecords(s.rows ?? [], sst)), eof()]),
  );
  const boundSheet = (s: SheetSpec, pos: number) =>
    record(0x0085, Buffer.concat([u32(pos), Buffer.from([0, 0]), unicodeString(s.name, 1)]));
  const globalsSize = (positions: number[]) =>
    Buffer.concat([
      bof(0x0005, version),
      ...sheets.map((s, i) => boundSheet(s, positions[i])),
      ...sstRecords(sst),
      eof(),
    ]).length;
  const start = globalsSize(sheets.map(() => 0));
  const positions = bodies.map((_, i) =>
    bodies.slice(0, i).reduce((at, b) => at + b.length, start),
  );
  return Buffer.concat([
    bof(0x0005, version),
    ...sheets.map((s, i) => boundSheet(s, positions[i])),
    ...sstRecords(sst),
    eof(),
    ...bodies,
  ]);
}

function dirEntry(name: string, type: number, start: number, size: number, child = FREE) {
  const e = Buffer.alloc(128);
  if (name) {
    e.write(name, 0, 'utf16le');
    e.writeUInt16LE((name.length + 1) * 2, 0x40);
  }
  e[0x42] = type;
  e[0x43] = 1; // black
  e.writeUInt32LE(FREE, 0x44);
  e.writeUInt32LE(FREE, 0x48);
  e.writeUInt32LE(child, 0x4c);
  e.writeUInt32LE(start, 0x74);
  e.writeUInt32LE(size, 0x78);
  return e;
}

const padTo = (b: Buffer, size: number) =>
  Buffer.concat([b, Buffer.alloc((size - (b.length % size)) % size)]);

/** An OLE2 compound file holding one stream (in the mini stream when it's under 4096 bytes). */
export function compoundFile(stream: Buffer, name = 'Workbook'): Buffer {
  const mini = stream.length < MINI_CUTOFF;
  const data = mini ? padTo(stream, MINI) : padTo(stream, SECTOR);
  const miniSectors = mini ? data.length / MINI : 0;
  const dataSectors = Math.ceil(data.length / SECTOR);
  const others = 1 + (mini ? 1 : 0) + dataSectors; // directory, mini FAT, data
  let fatSectors = 1;
  while (fatSectors * (SECTOR / 4) < fatSectors + others) fatSectors++;

  const dirAt = fatSectors;
  const miniFatAt = mini ? dirAt + 1 : END;
  const dataAt = dirAt + 1 + (mini ? 1 : 0);
  const fat = Buffer.alloc(fatSectors * SECTOR, 0xff);
  for (let i = 0; i < fatSectors; i++) fat.writeUInt32LE(FAT_SECTOR, i * 4);
  fat.writeUInt32LE(END, dirAt * 4);
  if (mini) fat.writeUInt32LE(END, miniFatAt * 4);
  for (let i = 0; i < dataSectors; i++) {
    fat.writeUInt32LE(i === dataSectors - 1 ? END : dataAt + i + 1, (dataAt + i) * 4);
  }

  const dir = Buffer.concat([
    dirEntry('Root Entry', 5, mini ? dataAt : END, mini ? data.length : 0, 1),
    dirEntry(name, 2, mini ? 0 : dataAt, stream.length),
    dirEntry('', 0, 0, 0),
    dirEntry('', 0, 0, 0),
  ]);
  const miniFat = Buffer.alloc(mini ? SECTOR : 0, 0xff);
  for (let i = 0; i < miniSectors; i++) {
    miniFat.writeUInt32LE(i === miniSectors - 1 ? END : i + 1, i * 4);
  }

  const header = Buffer.alloc(SECTOR);
  Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(header, 0);
  header.writeUInt16LE(0x3e, 0x18);
  header.writeUInt16LE(3, 0x1a);
  header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(9, 0x1e);
  header.writeUInt16LE(6, 0x20);
  header.writeUInt32LE(fatSectors, 0x2c);
  header.writeUInt32LE(dirAt, 0x30);
  header.writeUInt32LE(MINI_CUTOFF, 0x38);
  header.writeUInt32LE(miniFatAt, 0x3c);
  header.writeUInt32LE(mini ? 1 : 0, 0x40);
  header.writeUInt32LE(END, 0x44);
  header.fill(0xff, 0x4c);
  for (let i = 0; i < fatSectors; i++) header.writeUInt32LE(i, 0x4c + i * 4);

  return Buffer.concat([header, fat, dir, miniFat, padTo(data, SECTOR)]);
}

/** A whole `.xls` file with these sheets. */
export function xlsFile(sheets: SheetSpec[]): Buffer {
  return compoundFile(workbookStream(sheets));
}
