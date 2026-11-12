import { fixture } from '../../../test/helpers/wialon-report';
import { writeProMiles } from '../promiles';
import { detectFormats } from '.';
import { forzaEldImporter } from './forza-eld';

const sample = { name: 'random.csv', bytes: fixture('forza_ifta.csv') };
const changed = (from: string, to: string) => ({
  ...sample,
  bytes: Buffer.from(sample.bytes.toString().replace(from, to)),
});
describe('Forza ELD', () => {
  it('detects the layout, reads the company and preserves the truck number independently of the filename', () => {
    expect(detectFormats(sample)).toEqual(['forza-eld']);
    const warnings: string[] = [];
    const report = forzaEldImporter.read(sample, warnings);
    expect(report).toMatchObject({ detectedCompany: 'ACME TRUCKING LLC', detectedUnit: '07' });
    const output = writeProMiles([
      {
        company: report.detectedCompany!,
        unit: report.detectedUnit!,
        sourceFile: sample.name,
        report,
      },
    ]);
    expect(output.outputs[0].csv).toBe(fixture('promiles_expected_forza_oct2026.csv').toString());
    expect([...warnings, ...output.warnings]).toEqual([]);
  });
  it('supports BOM, CRLF, quoted names, and missing company/unit without inventing them', () => {
    const file = changed('07,VOLVO', '"Truck, 07",VOLVO');
    file.bytes = Buffer.from('\uFEFF' + file.bytes.toString().replace(/\n/g, '\r\n'));
    expect(forzaEldImporter.read(file, []).detectedUnit).toBe('Truck, 07');
    expect(
      forzaEldImporter.read(changed('Carrier: ACME TRUCKING LLC', 'Carrier:'), []).detectedCompany,
    ).toBeNull();
    expect(forzaEldImporter.read(changed('07,VOLVO', ',VOLVO'), []).detectedUnit).toBeNull();
  });
  it.each([
    ['10/31/2026', '02/30/2026', /unrecognised date/],
    ['10/31/2026', '09/30/2026', /ends before/],
    ['AR,412.49', 'Atlantis,412.49', /unknown state/],
    ['MO,388.50', 'AR,388.50', /appears twice/],
    ['AR,412.49', 'AR,-1', /unrecognised distance/],
    ['AR,412.49', 'AR,12 km', /expected miles/],
    ['AR,412.49', 'AR,"412', /malformed CSV/],
    ['07,VOLVO,VNL,2018', '07,VOLVO,VNL,2018\n08,VOLVO,VNL,2018', /exactly one vehicle/],
  ])('rejects invalid reports (%s)', (from, to, error) => {
    expect(() => forzaEldImporter.read(changed(from, to), [])).toThrow(error);
  });
  it('does not claim the shared IFTA layout or malformed bytes', () => {
    expect(
      forzaEldImporter.detect(changed('FORZAP - IFTA Mileage by State', 'IFTA Mileage By State')),
    ).toBe(false);
    expect(forzaEldImporter.detect({ name: 'x.csv', bytes: Buffer.from([0, 255]) })).toBe(false);
  });
});
