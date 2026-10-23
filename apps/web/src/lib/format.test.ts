import { describe, expect, it } from 'vitest';
import { bytes, duration, initials, pct, titleCase, tokens, usd } from './format';

describe('format helpers', () => {
  it('formats durations across units', () => {
    expect(duration(null)).toBe('—');
    expect(duration(450)).toBe('450ms');
    expect(duration(42_000)).toBe('42s');
    expect(duration(125_000)).toBe('2m 5s');
    expect(duration(3_900_000)).toBe('1h 5m');
  });

  it('formats token counts, costs and sizes', () => {
    expect(tokens(null)).toBe('n/a');
    expect(tokens(950)).toBe('950');
    expect(tokens(12_345)).toBe('12.3k');
    expect(tokens(2_500_000)).toBe('2.50M');
    expect(usd(0.004)).toBe('$0.0040');
    expect(usd(1.5, { estimate: true })).toBe('~$1.50');
    expect(bytes(2048)).toBe('2.0 KB');
    expect(pct(0.876)).toBe('88%');
  });

  it('formats names and enum labels', () => {
    expect(initials('Olivia Owner')).toBe('OO');
    expect(titleCase('WAITING_APPROVAL')).toBe('Waiting Approval');
  });
});
