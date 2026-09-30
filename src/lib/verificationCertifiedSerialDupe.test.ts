import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SiteCalibration } from '../types.ts';
import {
  buildLiveCertifiedSerialKeySet,
  buildVerificationRejectPatch,
  certifiedSerialAlreadyUsedReason,
  certifiedSerialMatchKey,
  isOvCertifiedSerialDuplicate,
  matchesVerificationStatusFilter,
  planCertifiedSerialDuplicateRejects,
  tallyVerificationStatusFilters,
} from './verificationRequest.ts';
import {
  buildDuplicatePrimaryIdSet,
  buildSerialGroupMap,
  buildVerificationListDisplay,
  matchesVerificationListStatusFilter,
} from './verificationListGrouping.ts';

function rec(
  overrides: Partial<SiteCalibration> & Pick<SiteCalibration, 'id'>,
): SiteCalibration {
  return {
    serialNumber: 'AS001677',
    customerName: 'Meezan Electronic Scales Pvt Ltd',
    verificationType: 'OV',
    status: 'submitted',
    rcId: 'rc-1',
    ...overrides,
  } as SiteCalibration;
}

describe('certified serial OV duplicate', () => {
  const certified = rec({
    id: 'cert-as',
    status: 'certified',
    certificateNumber: 'IND/GATC/KL/26/04/26/1',
    certificatePdfUrl: 'https://example.test/c.pdf',
  });
  const submittedDupe = rec({ id: 'sub-as', status: 'submitted' });
  const rejectedDupe = rec({
    id: 'rej-as',
    status: 'rejected',
    pipelineFailureMessage: 'Serial AS001677 is already used.',
  });
  const otherSubmitted = rec({
    id: 'sub-other',
    status: 'submitted',
    serialNumber: 'X001411',
  });
  const rvOfCertified = rec({
    id: 'rv-as',
    status: 'submitted',
    verificationType: 'RV',
  });

  const all = [certified, submittedDupe, rejectedDupe, otherSubmitted, rvOfCertified];

  it('matches exact serial + RC, not card suffix', () => {
    assert.equal(certifiedSerialMatchKey(certified), 'rc-1|AS001677');
    assert.equal(
      certifiedSerialMatchKey({ rcId: 'rc-1', serialNumber: 'as001677' }),
      'rc-1|AS001677',
    );
    assert.notEqual(certifiedSerialMatchKey({ rcId: 'rc-1', serialNumber: 'AS001677 (4)' }), 'rc-1|AS001677');
  });

  it('new OV for a live certified serial is a duplicate', () => {
    const keys = buildLiveCertifiedSerialKeySet(all);
    assert.equal(isOvCertifiedSerialDuplicate(submittedDupe, keys), true);
    assert.equal(isOvCertifiedSerialDuplicate(certified, keys), false);
    assert.equal(isOvCertifiedSerialDuplicate(otherSubmitted, keys), false);
    assert.equal(isOvCertifiedSerialDuplicate(rvOfCertified, keys), false);
  });

  it('certified serial + new job → reject patch, not submitted', () => {
    const reason = certifiedSerialAlreadyUsedReason('AS001677');
    const patch = buildVerificationRejectPatch(reason, '2026-09-30T12:00:00.000Z');
    assert.equal(patch.status, 'rejected');
    assert.notEqual(patch.status, 'submitted');
    assert.equal(patch.pipelineFailureMessage, 'Serial AS001677 is already used.');
    assert.deepEqual(
      planCertifiedSerialDuplicateRejects(all).map(row => row.id),
      ['sub-as'],
    );
  });

  it('submitted list excludes rejected and certified-serial OV dupes', () => {
    const primaryIds = buildDuplicatePrimaryIdSet(all);
    const groups = buildSerialGroupMap(all);
    const submitted = all.filter(record =>
      matchesVerificationListStatusFilter(record, 'submitted', all, primaryIds, groups),
    );
    assert.deepEqual(
      submitted.map(row => row.id).sort(),
      ['sub-other', 'rv-as'].sort(),
    );
    assert.equal(submitted.some(row => row.id === 'sub-as'), false);
    assert.equal(submitted.some(row => row.id === 'rej-as'), false);
    assert.equal(matchesVerificationStatusFilter(rejectedDupe, 'submitted'), false);
    assert.equal(matchesVerificationStatusFilter(rejectedDupe, 'rejected'), true);

    const rejected = all.filter(record =>
      matchesVerificationListStatusFilter(record, 'rejected', all, primaryIds, groups),
    );
    assert.equal(rejected.some(row => row.id === 'rej-as'), true);

    const display = buildVerificationListDisplay(submitted, all, 'submitted');
    assert.equal(display.some(row => row.id === 'sub-as'), false);
    assert.equal(display.some(row => row.id === 'rv-as'), true);
  });

  it('tally submitted omits certified-serial OV dupes; rejected stay counted', () => {
    const tally = tallyVerificationStatusFilters(all);
    assert.equal(tally.submitted, 2);
    assert.equal(tally.rejected, 1);
    assert.equal(tally.certified, 1);
  });

  it('voided cert does not block a later OV', () => {
    const voided = rec({
      id: 'void-as',
      status: 'certified',
      certificateNumber: 'IND/1',
      certificatePdfUrl: 'https://example.test/c.pdf',
      certificateVoidedAt: '2026-09-01T00:00:00.000Z',
    });
    const next = rec({ id: 'next-as', status: 'submitted' });
    const keys = buildLiveCertifiedSerialKeySet([voided, next]);
    assert.equal(isOvCertifiedSerialDuplicate(next, keys), false);
  });
});
