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

  it('Settings-bank YJ/VJ stay in remaining when not PAS-blocked', () => {
    const seats = computeRcQuotaSeats({
      rcCode: 'MZN',
      companyName: 'Meezan',
      ovQuota: '56',
      ovQuotaUsed: 0,
      recordsAreRcWide: true,
      storedSerials: ['YJ00498', 'VJ00151'],
      allotSerials: ['YJ00498', 'VJ00151'],
      voidedSerials: [],
      records: [] as SiteCalibration[],
      pasSerials: [],
    });
    assert.deepEqual(seats.remaining.sort(), ['VJ00151', 'YJ00498']);
  });

  it('admin table: stale YesOne used=allotted does not wipe remaining seats', () => {
    const used = Array.from({ length: 587 }, (_, i) => `X${String(i + 1).padStart(5, '0')}`);
    const remaining = Array.from({ length: 157 }, (_, i) => `X${String(1000 + i).padStart(5, '0')}`);
    const seats = computeRcQuotaSeats({
      rcCode: 'MZN',
      companyName: 'Meezan',
      ovQuota: '744',
      ovQuotaUsed: '744',
      recordsAreRcWide: false,
      storedSerials: [...used, ...remaining],
      allotSerials: remaining,
      voidedSerials: [],
      records: [] as SiteCalibration[],
      allotmentUsedSerials: used,
    });
    assert.equal(seats.allottedQty, 744);
    assert.equal(seats.remaining.length, 157);
    assert.equal(seats.usedQty, 587);
    assert.equal(seats.balanceQty, 157);
  });
});
