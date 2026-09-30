import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SiteCalibration } from '../types.ts';
import {
  buildFailedAtSubmitPatch,
  buildVerificationPerformerPatch,
  getVerificationDisplayStatus,
  isVerificationFailedAtSubmit,
  normalizeVerificationStatus,
  verificationListStageReason,
} from './verificationRequest.ts';
import { canMoveFailedSubmitToDraft, moveFailedSubmitVerificationToDraft } from './verificationPipelineRepair.ts';
import {
  isEligibleFailedSubmitAutoResubmit,
  isEligibleFailedSubmitManualResubmit,
} from './verificationFailedSubmitResubmit.ts';

describe('submitted job cannot go back to draft on cert fail', () => {
  it('writes failed_at_submit (submitted + pipeline fail) with visible reason', () => {
    const patch = buildFailedAtSubmitPatch(
      'eMAAP rejected: party pincode is empty',
      '2026-09-30T12:00:00.000Z',
    );
    assert.equal(patch.status, 'submitted');
    assert.notEqual(patch.status, 'draft');
    assert.equal(patch.pipelineFailedPhase, 'submit');
    assert.equal(patch.pipelineFailureMessage, 'eMAAP rejected: party pincode is empty');
    assert.equal(patch.pipelineFailedAt, '2026-09-30T12:00:00.000Z');

    const record = {
      id: 'job-1',
      serialNumber: 'YJ01330',
      customerName: 'Acme',
      verificationType: 'OV',
      submittedAt: '2026-09-30T11:00:00.000Z',
      ...patch,
    } as SiteCalibration;

    assert.equal(isVerificationFailedAtSubmit(record), true);
    assert.equal(getVerificationDisplayStatus(record), 'failed_submit');
    assert.equal(
      verificationListStageReason(record),
      'eMAAP rejected: party pincode is empty',
    );
    assert.equal(canMoveFailedSubmitToDraft(record, true), false);
    assert.equal(isEligibleFailedSubmitManualResubmit(record), true);
    assert.equal(
      isEligibleFailedSubmitAutoResubmit(record, Date.parse('2026-09-30T12:30:00.000Z')),
      false,
    );
    assert.equal(
      isEligibleFailedSubmitAutoResubmit(record, Date.parse('2026-09-30T13:00:00.000Z')),
      true,
    );
  });

  it('yellow move-to-draft write is blocked', async () => {
    await assert.rejects(
      () => moveFailedSubmitVerificationToDraft('job-1'),
      /cannot move back to draft/,
    );
  });

  it('serial-already-used after submit stays failed_at_submit, not draft', () => {
    const patch = buildFailedAtSubmitPatch('Serial YJ01330 is already used.');
    assert.equal(patch.status, 'submitted');
    assert.equal(patch.pipelineFailedPhase, 'submit');
    assert.match(patch.pipelineFailureMessage, /already used/);
  });

  it('performer save does not write draft onto submitted / failed_at_submit', () => {
    const submitted = {
      status: 'submitted' as const,
      submittedAt: '2026-09-30T11:00:00.000Z',
    };
    const patch = buildVerificationPerformerPatch({ actor: 'rc', contactPerson: 'GK' }, submitted);
    assert.notEqual(patch.status, 'draft');
    assert.equal(patch.status, undefined);

    const failed = {
      status: 'submitted' as const,
      submittedAt: '2026-09-30T11:00:00.000Z',
    };
    const failPatch = buildVerificationPerformerPatch({ actor: 'rc' }, failed);
    assert.notEqual(failPatch.status, 'draft');

    const draftPatch = buildVerificationPerformerPatch({ actor: 'rc' }, { status: 'draft' });
    assert.equal(draftPatch.status, 'draft');
  });

  it('submitted cannot become draft when status field is missing', () => {
    const previous = { submittedAt: '2026-09-30T11:00:00.000Z' };
    assert.equal(normalizeVerificationStatus(previous), 'submitted');
    const patch = buildVerificationPerformerPatch({ actor: 'rc' }, previous);
    assert.notEqual(patch.status, 'draft');
    assert.equal(patch.status, undefined);
  });

  it('approved and rejected cannot become draft via performer save', () => {
    assert.equal(
      buildVerificationPerformerPatch({ actor: 'rc' }, { status: 'approved' }).status,
      undefined,
    );
    assert.equal(
      buildVerificationPerformerPatch({ actor: 'rc' }, { status: 'rejected' }).status,
      undefined,
    );
  });
});
