const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FieldValue } = require('firebase-admin/firestore');
const {
  AUTO_RESUBMIT_AFTER_MS,
  AUTO_RESUBMIT_MAX,
  BATCH_LIMIT,
  MISSING_SERIAL,
  MISSING_PLATE,
  MISSING_WEIGHT,
  isEligibleFailedSubmitAutoResubmit,
  investigateFailedSubmit,
  recordHasSerialPlatePhoto,
  recordHasStandardWeightPhoto,
  autoResubmitFailedSubmitVerificationsHandler,
} = require('./verificationFailedSubmitAutoResubmit');

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-09-30T12:00:00.000Z');

function failDoc(overrides = {}) {
  return {
    status: 'submitted',
    pipelineFailedPhase: 'submit',
    pipelineFailedAt: new Date(NOW - 2 * HOUR).toISOString(),
    serialNumber: 'X004655',
    stampingImageUrl: 'https://x/plate.jpg',
    scaleImageUrl: 'https://x/f2.jpg',
    ...overrides,
  };
}

test('auto eligibility: 1h after fail, not 12h', () => {
  assert.equal(AUTO_RESUBMIT_AFTER_MS, HOUR);
  assert.equal(BATCH_LIMIT <= AUTO_RESUBMIT_MAX, true);
  assert.equal(isEligibleFailedSubmitAutoResubmit(failDoc(), NOW), true);
  assert.equal(
    isEligibleFailedSubmitAutoResubmit(
      failDoc({ pipelineFailedAt: new Date(NOW - 30 * 60 * 1000).toISOString() }),
      NOW,
    ),
    false,
  );
  assert.equal(
    isEligibleFailedSubmitAutoResubmit(
      failDoc({ pipelineFailedAt: new Date(NOW - HOUR).toISOString() }),
      NOW,
    ),
    true,
  );
});

test('auto eligibility: skips rejected, draft, unsigned certified', () => {
  assert.equal(isEligibleFailedSubmitAutoResubmit(failDoc({ status: 'rejected' }), NOW), false);
  assert.equal(isEligibleFailedSubmitAutoResubmit(failDoc({ status: 'draft' }), NOW), false);
  assert.equal(
    isEligibleFailedSubmitAutoResubmit(
      failDoc({
        status: 'certified',
        pipelineFailedPhase: 'submit',
        signedCertificatePdfUrl: '',
      }),
      NOW,
    ),
    false,
  );
});

test('auto eligibility: skips mid-submit', () => {
  assert.equal(
    isEligibleFailedSubmitAutoResubmit(failDoc({ pipelineFailedPhase: undefined }), NOW),
    false,
  );
});

test('investigate: plate and weight aliases clear the gate', () => {
  assert.equal(recordHasSerialPlatePhoto({ plateImagePath: 'p/1.jpg' }), true);
  assert.equal(recordHasStandardWeightPhoto({ weightPhotoUrl: 'https://x/w.jpg' }), true);
  assert.equal(
    investigateFailedSubmit({
      serialNumber: 'X012288',
      plateImagePath: 'p/1.jpg',
      weightsImagePath: 'w/2.jpg',
    }),
    null,
  );
});

test('investigate: missing serial / plate / weight stay failed with worker wording', () => {
  assert.equal(investigateFailedSubmit({ serialNumber: '' }), MISSING_SERIAL);
  assert.equal(
    investigateFailedSubmit({ serialNumber: 'X1', scaleImageUrl: 'https://x/f2.jpg' }),
    MISSING_PLATE,
  );
  assert.equal(
    investigateFailedSubmit({ serialNumber: 'X1', stampingImageUrl: 'https://x/p.jpg' }),
    MISSING_WEIGHT,
  );
});

test('investigate: never invents a serial', () => {
  assert.equal(
    investigateFailedSubmit({
      stampingImageUrl: 'https://x/p.jpg',
      scaleImageUrl: 'https://x/w.jpg',
    }),
    MISSING_SERIAL,
  );
});

function createFakeDb({ docs = [] } = {}) {
  const updates = [];
  return {
    updates,
    collection() {
      return {
        where(field, op, value) {
          return {
            limit(n) {
              return {
                async get() {
                  const matched = docs
                    .filter(d => d.data[field] === value)
                    .slice(0, n)
                    .map(d => ({
                      id: d.id,
                      data: () => d.data,
                    }));
                  return { docs: matched };
                },
              };
            },
          };
        },
        doc(id) {
          return {
            async update(patch) {
              updates.push({ id, patch });
            },
          };
        },
      };
    },
  };
}

test('handler resubmits clear jobs as submitted, never draft', async () => {
  const originalNow = Date.now;
  Date.now = () => NOW;
  try {
    const db = createFakeDb({
      docs: [
        { id: 'clear', data: failDoc() },
        {
          id: 'fresh',
          data: failDoc({ pipelineFailedAt: new Date(NOW - 10 * 60 * 1000).toISOString() }),
        },
        { id: 'rejected', data: failDoc({ status: 'rejected' }) },
        {
          id: 'no-plate',
          data: failDoc({
            stampingImageUrl: '',
            serialNumber: 'X9',
            scaleImageUrl: 'https://x/f2.jpg',
            pipelineFailureMessage: 'old reason',
          }),
        },
      ],
    });
    const result = await autoResubmitFailedSubmitVerificationsHandler(db);
    assert.equal(result.enabled, true);
    assert.equal(result.resubmitted, 1);
    assert.equal(result.stayed, 1);
    assert.equal(db.updates.length, 2);

    const clear = db.updates.find(row => row.id === 'clear');
    assert.equal(clear.patch.status, 'submitted');
    assert.notEqual(clear.patch.status, 'draft');
    assert.equal(clear.patch.failedSubmitResubmitSource, 'auto');
    assert.equal(typeof FieldValue.increment, 'function');

    const blocked = db.updates.find(row => row.id === 'no-plate');
    assert.equal(blocked.patch.status, 'submitted');
    assert.notEqual(blocked.patch.status, 'draft');
    assert.equal(blocked.patch.pipelineFailedPhase, 'submit');
    assert.equal(blocked.patch.pipelineFailureMessage, MISSING_PLATE);
  } finally {
    Date.now = originalNow;
  }
});
