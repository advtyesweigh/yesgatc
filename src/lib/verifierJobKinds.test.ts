import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_VERIFIER_JOB_KINDS,
  normalizeVerifierJobKinds,
  toggleVerifierJobKind,
  validateVerifierJobKinds,
  verifierJobKindsShortLabel,
} from './verifierJobKinds.ts';

describe('verifier job kinds', () => {
  it('defaults to OV Self', () => {
    assert.deepEqual(normalizeVerifierJobKinds(undefined), DEFAULT_VERIFIER_JOB_KINDS);
    assert.deepEqual(normalizeVerifierJobKinds([]), DEFAULT_VERIFIER_JOB_KINDS);
    assert.deepEqual(normalizeVerifierJobKinds(['nope']), DEFAULT_VERIFIER_JOB_KINDS);
  });

  it('keeps OV + RV grant order', () => {
    assert.deepEqual(normalizeVerifierJobKinds(['rv_customer', 'ov_self', 'ov_customer']), [
      'ov_self',
      'ov_customer',
      'rv_customer',
    ]);
  });

  it('toggle keeps at least one', () => {
    assert.deepEqual(toggleVerifierJobKind(['ov_self'], 'ov_self'), ['ov_self']);
    assert.deepEqual(toggleVerifierJobKind(['ov_self'], 'rv_customer'), ['ov_self', 'rv_customer']);
    assert.deepEqual(toggleVerifierJobKind(['ov_self', 'rv_customer'], 'ov_self'), ['rv_customer']);
  });

  it('validates and labels', () => {
    assert.equal(validateVerifierJobKinds(['ov_self', 'rv_customer']), null);
    assert.match(validateVerifierJobKinds([]) ?? '', /job type/);
    assert.equal(verifierJobKindsShortLabel(['ov_self', 'ov_customer', 'rv_customer']), 'OV Self · OV Cust · RV');
  });
});
