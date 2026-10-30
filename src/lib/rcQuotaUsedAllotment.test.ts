import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeRcQuotaSeats } from './rcQuotaSeats.ts';
import {
  isUnusedYesoneAllotmentStatus,
  unusedSerials,
} from './yesoneInboundData.ts';
import type { SiteCalibration } from '../types.ts';

describe('used allotment exclusion from Balance / chips', () => {
  it('isUnusedYesoneAllotmentStatus drops used/cancelled/replaced', () => {
    assert.equal(isUnusedYesoneAllotmentStatus('allotted'), true);
    assert.equal(isUnusedYesoneAllotmentStatus(''), true);
    assert.equal(isUnusedYesoneAllotmentStatus('used'), false);
    assert.equal(isUnusedYesoneAllotmentStatus('USED'), false);
    assert.equal(isUnusedYesoneAllotmentStatus('cancelled'), false);
    assert.equal(isUnusedYesoneAllotmentStatus('replaced'), false);
  });

  it('unusedSerials matches compact keys (spaces / dashes)', () => {
    assert.deepEqual(unusedSerials(['G0585', 'X00796'], ['G 0585', 'x-00796']), []);
    assert.deepEqual(unusedSerials(['G0585', 'G0586'], ['G0585']), ['G0586']);
  });

  it('allotmentUsedSerials hide stamped stickers even without OV record', () => {
    const seats = computeRcQuotaSeats({
      rcCode: 'ACE',
      companyName: 'ACE ELECTRONICS',
      ovQuota: '3',
      ovQuotaUsed: 1,
      recordsAreRcWide: true,
      storedSerials: ['G0585', 'G0586', 'X00796'],
      allotSerials: ['G0585', 'G0586', 'X00796'],
      voidedSerials: [],
      records: [] as SiteCalibration[],
      allotmentUsedSerials: ['G0585'],
    });
    assert.deepEqual(seats.remaining, ['G0586', 'X00796']);
    assert.ok(seats.usedSerials.includes('G0585'));
  });
});
