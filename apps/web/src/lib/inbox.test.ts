import { describe, expect, it } from 'vitest';
import { deleteEntryText, entryOwner, reprocessEntryText } from './inbox';

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

  it('warns that deleting a converted file deletes its ProMiles file and history', () => {
    expect(
      deleteEntryText({ name: 'report.csv', status: 'converted', outputs: ['ACME_unit-22.csv'] }),
    ).toBe(
      'Delete report.csv? Its ProMiles file (ACME_unit-22.csv) and its history are deleted too. ' +
        'The original report is kept.',
    );
    expect(deleteEntryText({ name: 'report.csv', status: 'duplicate', outputs: [] })).toBe(
      'Remove report.csv from this list? The original report is kept.',
    );
  });

  it('warns that converting again replaces what a converted file produced', () => {
    expect(reprocessEntryText({ name: 'report.csv', status: 'converted' })).toMatch(
      /^Convert report\.csv again\? Its ProMiles file and history are replaced/,
    );
    expect(reprocessEntryText({ name: 'report.csv', status: 'dismissed' })).toBe(
      'Try report.csv again?',
    );
  });
});
