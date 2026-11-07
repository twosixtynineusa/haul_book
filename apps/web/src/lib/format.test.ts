import { describe, expect, it } from 'vitest';
import { displayPath, formatBytes, formatDistance, plural } from './format';

describe('format', () => {
  it('formats byte sizes', () => {
    expect(formatBytes(701)).toBe('701 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });

  it('formats distances with their unit', () => {
    expect(formatDistance(12581, 'M')).toBe('12,581 mi');
    expect(formatDistance(42.5, 'K')).toBe('42.5 km');
  });

  it('pluralizes', () => {
    expect(plural(1, 'state')).toBe('1 state');
    expect(plural(23, 'state')).toBe('23 states');
  });

  it('joins display paths', () => {
    expect(displayPath('./output', 'a.csv')).toBe('./output/a.csv');
    expect(displayPath('/srv/out/', 'a.csv')).toBe('/srv/out/a.csv');
    expect(displayPath('C:\\HaulBook', 'a.csv')).toBe('C:\\HaulBook\\a.csv');
  });
});
