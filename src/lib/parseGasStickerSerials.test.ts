import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseGasStickerSerials } from './parseGasStickerSerials.ts';

describe('parseGasStickerSerials', () => {
  it('splits commas, spaces, and newlines; uppercases; dedupes', () => {
    assert.deepEqual(
      parseGasStickerSerials('g0585, X00796\nG0585  x00797;G0586'),
      {
        valid: ['G0585', 'X00796', 'X00797', 'G0586'],
        invalid: [],
      },
    );
  });

  it('keeps YJ, digits-only, and mixed tokens — no format gate', () => {
    assert.deepEqual(
      parseGasStickerSerials('G0540, YJ01001, 1130, hello, X00301, YJ00498'),
      {
        valid: ['G0540', 'YJ01001', '1130', 'HELLO', 'X00301', 'YJ00498'],
        invalid: [],
      },
    );
  });

  it('returns empty for blank input', () => {
    assert.deepEqual(parseGasStickerSerials('  , \n\t '), { valid: [], invalid: [] });
    assert.deepEqual(parseGasStickerSerials(null), { valid: [], invalid: [] });
  });
});
