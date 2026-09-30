import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  recordHasSerialPlatePhoto,
  recordHasStandardWeightPhoto,
} from './verificationDeviceImages.ts';

describe('serial plate photo evidence', () => {
  it('counts stamping url or path', () => {
    assert.equal(recordHasSerialPlatePhoto({ stampingImageUrl: 'https://x/plate.jpg' }), true);
    assert.equal(
      recordHasSerialPlatePhoto({ stampingImagePath: 'siteCalibrations/a/stamping-image/1.jpg' }),
      true,
    );
  });

  it('counts plate aliases', () => {
    assert.equal(recordHasSerialPlatePhoto({ serialPlateImageUrl: 'https://x/p.jpg' }), true);
    assert.equal(recordHasSerialPlatePhoto({ plateImagePath: 'p/1.jpg' }), true);
  });

  it('false when only weight/seal shots exist', () => {
    assert.equal(
      recordHasSerialPlatePhoto({
        scaleImageUrl: 'https://x/f2.jpg',
        verificationSealImageUrl: 'https://x/seal.jpg',
      }),
      false,
    );
  });
});

describe('standard weight photo evidence', () => {
  it('counts F2 test weight as standard weight', () => {
    assert.equal(
      recordHasStandardWeightPhoto({ scaleImageUrl: 'https://x/f2-test.jpg' }),
      true,
    );
  });

  it('counts F2 corner as standard weight', () => {
    assert.equal(
      recordHasStandardWeightPhoto({ instrumentRearImagePath: 'siteCalibrations/a/rear.jpg' }),
      true,
    );
  });

  it('counts small-weights slot and legacy aliases', () => {
    assert.equal(
      recordHasStandardWeightPhoto({ standardWeightImageUrl: 'https://x/small.jpg' }),
      true,
    );
    assert.equal(recordHasStandardWeightPhoto({ weightImageUrl: 'https://x/w.jpg' }), true);
    assert.equal(recordHasStandardWeightPhoto({ weightsImagePath: 'w/path.jpg' }), true);
  });

  it('false when no weight-related slots', () => {
    assert.equal(
      recordHasStandardWeightPhoto({
        stampingImageUrl: 'https://x/plate.jpg',
        verificationSealImageUrl: 'https://x/seal.jpg',
      }),
      false,
    );
  });
});
