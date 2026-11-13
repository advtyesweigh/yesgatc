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

  it('Settings-bank YJ/VJ stay out of GAS remaining when PAS-blocked', () => {
    const seats = computeRcQuotaSeats({
      rcCode: 'MZN',
      companyName: 'Meezan',
      ovQuota: '56',
      ovQuotaUsed: 0,
      recordsAreRcWide: true,
      storedSerials: ['YJ00498', 'VJ00151', 'G0582'],
      allotSerials: ['YJ00498', 'VJ00151', 'G0582'],
      voidedSerials: [],
      records: [] as SiteCalibration[],
      pasSerials: ['YJ00498', 'VJ00151'],
    });
    assert.deepEqual(seats.remaining, ['G0582']);
    assert.deepEqual(seats.pasRemaining.sort(), ['VJ00151', 'YJ00498']);
  });

  it('admin table: Used is live/stored verified count — never allotted−bank', () => {
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
    // Incomplete scope floors on stored YesOne used — not seat-clamped to 587.
    assert.equal(seats.usedQty, 744);
    assert.equal(seats.balanceQty, 0);
    assert.deepEqual(seats.pasRemaining, []);
  });

  it('MZN Interweigh closed-row matches home: live Used / Balance = allotted − used', () => {
    const liveUsed = Array.from({ length: 949 }, (_, i) => ({
      id: `ov-${i}`,
      serialNumber: `X${String(i + 1).padStart(5, '0')}`,
      verificationType: 'OV',
      status: 'submitted',
      rcId: 'meezan',
    })) as SiteCalibration[];
    // Short unused bank must not rewrite Used (old closed-row: 921 / 91).
    const unusedBank = Array.from({ length: 91 }, (_, i) => `G${String(i + 1).padStart(5, '0')}`);
    const home = computeRcQuotaSeats({
      rcCode: 'MZN',
      companyName: 'Meezan electronic scales pvt ltd',
      ovQuota: '1012',
      ovQuotaUsed: 921,
      recordsAreRcWide: true,
      storedSerials: unusedBank,
      allotSerials: unusedBank,
      voidedSerials: [],
      records: liveUsed,
    });
    const interweigh = computeRcQuotaSeats({
      rcCode: 'MZN',
      companyName: 'Meezan electronic scales pvt ltd',
      ovQuota: '1012',
      ovQuotaUsed: 921,
      recordsAreRcWide: true,
      storedSerials: unusedBank,
      allotSerials: unusedBank,
      voidedSerials: [],
      records: liveUsed,
    });
    assert.equal(home.allottedQty, 1012);
    assert.equal(home.usedQty, 949);
    assert.equal(home.balanceQty, 63);
    assert.equal(interweigh.usedQty, home.usedQty);
    assert.equal(interweigh.balanceQty, home.balanceQty);
  });

  it('Meezan keeps unused PAS in pasRemaining only; GAS remaining stays GAS; Balance allotted−used', () => {
    const seats = computeRcQuotaSeats({
      rcCode: 'MZN',
      companyName: 'Meezan',
      ovQuota: '1002',
      ovQuotaUsed: 948,
      recordsAreRcWide: true,
      storedSerials: ['G0001', 'YJ01001', 'YJ01002'],
      allotSerials: ['YJ01002', 'YJ01003'],
      voidedSerials: ['YJ01003'],
      records: [{ id: 'ov-pas', serialNumber: 'YJ01002', productId: 'atm', verificationType: 'OV', status: 'submitted', rcId: 'meezan' } as SiteCalibration],
      pasProductIds: ['atm'],
      pasSerials: ['YJ01001', 'YJ01002', 'YJ01003', 'AS00276'],
      allotmentUsedSerials: ['G0001'],
    });
    assert.deepEqual(seats.remaining, []);
    assert.deepEqual(seats.vctRemaining, []);
    assert.equal(seats.allottedQty, 1002);
    assert.equal(seats.usedQty, 0);
    assert.equal(seats.balanceQty, 1002);
    assert.deepEqual(seats.pasRemaining, ['YJ01001']);
  });

  it('Meezan Balance tile is allotted−used, not PAS bank length', () => {
    const bank = Array.from({ length: 335 }, (_, i) => `YJ${String(i + 1).padStart(5, '0')}`);
    const seats = computeRcQuotaSeats({
      rcCode: 'MZN',
      companyName: 'Meezan electronic scales pvt ltd',
      ovQuota: '1002',
      ovQuotaUsed: 948,
      recordsAreRcWide: true,
      storedSerials: bank,
      allotSerials: bank,
      voidedSerials: [],
      pasSerials: bank,
      records: Array.from({ length: 948 }, (_, i) => ({
        id: `ov-${i}`,
        serialNumber: `X${String(i + 1).padStart(5, '0')}`,
        verificationType: 'OV',
        status: 'submitted',
        rcId: 'meezan',
      })) as SiteCalibration[],
    });
    assert.equal(seats.allottedQty, 1002);
    assert.equal(seats.usedQty, 948);
    assert.equal(seats.balanceQty, 54);
    assert.equal(seats.remaining.length, 0);
    assert.equal(seats.pasRemaining.length, 335);
  });

  it('done YJ/AS/VJ on jobs stay out of available even after Settings re-add', () => {
    const seats = computeRcQuotaSeats({
      rcCode: 'MZN',
      companyName: 'Meezan',
      ovQuota: '1002',
      ovQuotaUsed: 948,
      recordsAreRcWide: true,
      storedSerials: ['YJ01086', 'AS00117', 'VJ00151', 'YJ09999'],
      allotSerials: ['YJ01086', 'AS00117', 'VJ00151', 'YJ09999'],
      voidedSerials: [],
      records: [
        {
          id: 'ov-yj',
          serialNumber: 'YJ01086',
          productId: 'atm',
          verificationType: 'OV',
          status: 'submitted',
          rcId: 'meezan',
        },
        {
          id: 'ov-as',
          serialNumber: 'AS00117',
          productId: 'q8',
          verificationType: 'OV',
          status: 'certified',
          rcId: 'meezan',
        },
        {
          id: 'ov-vj',
          serialNumber: 'VJ00151',
          productId: 'atm',
          verificationType: 'OV',
          status: 'draft',
          rcId: 'meezan',
        },
      ] as SiteCalibration[],
      pasProductIds: ['atm', 'q8'],
      // PAS-format never enters GAS remaining (job-held still blocked from pasRemaining).
      pasSerials: [],
      allotmentUsedSerials: [],
    });
    assert.deepEqual(seats.remaining, []);
    assert.equal(seats.remaining.includes('YJ01086'), false);
    assert.equal(seats.remaining.includes('AS00117'), false);
    assert.equal(seats.remaining.includes('VJ00151'), false);
    assert.deepEqual(seats.pasRemaining, ['YJ09999']);
  });

  it('other RC keeps PAS stickers out of the GAS pool', () => {
    const seats = computeRcQuotaSeats({
      rcCode: 'ACE',
      companyName: 'ACE ELECTRONICS',
      ovQuota: '3',
      recordsAreRcWide: true,
      storedSerials: ['G0586', 'YJ01001'],
      allotSerials: [],
      voidedSerials: [],
      records: [] as SiteCalibration[],
      pasSerials: ['YJ01001'],
    });
    assert.deepEqual(seats.remaining, ['G0586']);
    assert.deepEqual(seats.pasRemaining, ['YJ01001']);
    assert.equal(seats.balanceQty, 3);
  });
});
