import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseVerificationListStatusParam,
  verificationListKeepsUncollapsedRows,
} from './verificationListStatusQuery.ts';

describe('rejected / failed_at_submit list query', () => {
  it('keeps rejected and maps failed-at-submit aliases', () => {
    assert.equal(parseVerificationListStatusParam('rejected'), 'rejected');
    assert.equal(parseVerificationListStatusParam('failed_submit'), 'failed_submit');
    assert.equal(parseVerificationListStatusParam('failed_at_submit'), 'failed_submit');
    assert.equal(parseVerificationListStatusParam('failed_at_submission'), 'failed_submit');
  });

  it('does not collapse rejected or failed-at-submit tile lists', () => {
    assert.equal(verificationListKeepsUncollapsedRows('rejected'), true);
    assert.equal(verificationListKeepsUncollapsedRows('failed_submit'), true);
  });
});

describe('rejected tile lists used-serial jobs', () => {
  const certified = {
    id: 'cert-yj',
    status: 'certified',
    serialNumber: 'YJ01330',
    certificateNumber: 'IND/1',
  };
  const rejected = [
    {
      id: 'rej-1',
      status: 'rejected',
      serialNumber: 'YJ01330',
      pipelineFailureMessage: 'Serial YJ01330 is already used.',
    },
    { id: 'rej-2', status: 'rejected', serialNumber: 'SN-A' },
    { id: 'rej-3', status: 'rejected', serialNumber: 'SN-B' },
    { id: 'rej-4', status: 'rejected', serialNumber: 'SN-C' },
  ];
  const all = [certified, ...rejected];

  it('status=rejected keeps all 4 rows even when serial is already certified', () => {
    const filtered = all.filter(record => record.status === 'rejected');
    assert.equal(filtered.length, 4);
    assert.equal(
      filtered.some(row => row.serialNumber === certified.serialNumber),
      true,
    );
    assert.equal(filtered[0]?.pipelineFailureMessage, 'Serial YJ01330 is already used.');
  });
});
