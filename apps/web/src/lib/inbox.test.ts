import { describe, expect, it } from 'vitest';
import { entryOwner } from './inbox';

describe('processed input-folder files', () => {
  it('says who a file was for', () => {
    expect(entryOwner({ company: 'ACME TRUCKING LLC', unit: '22', units: [] })).toBe(
      'ACME TRUCKING LLC · Truck 22',
    );
    expect(entryOwner({ company: 'ACME TRUCKING LLC', unit: null, units: ['Volvo 7', '31'] })).toBe(
      'ACME TRUCKING LLC · Trucks Volvo 7, 31',
    );
    expect(entryOwner({ company: null, unit: null, units: [] })).toBe('');
  });
});
