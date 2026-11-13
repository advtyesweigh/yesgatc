import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  countReservedOverlaySeats,
  excludePasQuotaSerials,
  pasStickersAmong,
  pickQuotaSerialsForActor,
  pickQuotaToDoSerials,
  recordUsesPasQuota,
  resolveRcQuotaUsedQty,
} from './rcQuotaMath.ts';
import { assignUnownedReservedToSoleUid } from './vrAllotted.ts';
import { mergePasBlockedSerials, pasSerialsFromMetaRanges } from './pasSerialBankMatch.ts';
import { validateOvQuotaDevices, validateOvQuotaSetup } from './ovQuotaGate.ts';

describe('resolveRcQuotaUsedQty', () => {
  it('uses live OV count when records are RC-wide', () => {
    assert.equal(
      resolveRcQuotaUsedQty({
        recordUsedCount: 949,
        storedUsed: 921,
        recordsAreRcWide: true,
      }),
      949,
    );
  });

  it('never seat-clamps Used from unused sticker bank', () => {
    // Old bug: allotted−remainingBank rewrote Used to 921 when jobs unloaded.
    assert.equal(
      resolveRcQuotaUsedQty({
        recordUsedCount: 0,
        storedUsed: 949,
        recordsAreRcWide: false,
      }),
      949,
    );
  });

  it('lifts incomplete VCT count with YesOne stored floor', () => {
    assert.equal(
      resolveRcQuotaUsedQty({
        recordUsedCount: 20,
        storedUsed: 400,
        recordsAreRcWide: false,
      }),
      400,
    );
  });
});

describe('PAS exclusion', () => {
  it('drops only explicitly blocked PAS serials from GAS lists', () => {
    assert.deepEqual(
      excludePasQuotaSerials(['G0001', 'YJ01001', 'G0002', 'VJ00151'], ['YJ01001']),
      ['G0001', 'G0002'],
    );
  });

  it('always drops YJ/AS/VJ from GAS lists even without an explicit block list', () => {
    assert.deepEqual(
      excludePasQuotaSerials(['YJ00498', 'VJ00151', 'AS00117', 'G0540'], []),
      ['G0540'],
    );
  });

  it('drops PAS meta-range serials that leaked into RC remaining', () => {
    const blocked = mergePasBlockedSerials(
      ['YJ00245'],
      pasSerialsFromMetaRanges([{ from: 'YJ01164', to: 'YJ01164' }]),
    );
    assert.deepEqual(
      excludePasQuotaSerials(['X00168', 'YJ00245', 'YJ01164', 'X00301'], blocked),
      ['X00168', 'X00301'],
    );
  });

  it('never drops GAS X/G because a YJ PAS range exists', () => {
    const blocked = mergePasBlockedSerials(
      ['X00423', 'G0541'],
      pasSerialsFromMetaRanges([{ from: 'YJ00245', to: 'YJ00245' }]),
    );
    assert.deepEqual(
      excludePasQuotaSerials(['X00423', 'G0541', 'YJ00245', 'Y10315'], blocked),
      ['X00423', 'G0541', 'Y10315'],
    );
  });

  it('splits PAS stickers out of a mixed bank', () => {
    assert.deepEqual(
      pasStickersAmong(['G0001', 'YJ01001', 'X00301', 'AS00276'], ['YJ01001', 'AS00276']),
      ['YJ01001', 'AS00276'],
    );
  });

  it('treats PAS product OVs as non-quota', () => {
    assert.equal(recordUsesPasQuota('atm', ['atm']), true);
    assert.equal(recordUsesPasQuota('mzn', ['atm']), false);
    assert.equal(recordUsesPasQuota('', ['atm']), false);
  });
});

describe('pickQuotaToDoSerials', () => {
  it('caps to quota to-do from unreserved unused only; never pads reserved', () => {
    const remaining = Array.from({ length: 10 }, (_, i) => `YJ${String(i + 1).padStart(5, '0')}`);
    const reserved = ['YJ00008', 'YJ00009', 'YJ00010'];
    assert.deepEqual(pickQuotaToDoSerials(remaining, reserved, 5), [
      'YJ00001',
      'YJ00002',
      'YJ00003',
      'YJ00004',
      'YJ00005',
    ]);
  });

  it('excludes reserved even when under balanceQty', () => {
    assert.deepEqual(pickQuotaToDoSerials(['A', 'B'], ['B'], 5), ['A']);
  });

  it('returns empty when all remaining are reserved', () => {
    assert.deepEqual(pickQuotaToDoSerials(['A', 'B'], ['A', 'B'], 54), []);
  });

  it('case-insensitive reserved match', () => {
    assert.deepEqual(pickQuotaToDoSerials(['yj1', 'YJ2'], ['YJ1'], 10), ['YJ2']);
  });
});

describe('countReservedOverlaySeats', () => {
  it('counts displayed reserved seats, not reserved-only leftovers', () => {
    assert.equal(
      countReservedOverlaySeats(
        ['X00423', 'X00301', 'G0541'],
        ['X00301', 'Y99999'],
      ),
      1,
    );
  });

  it('skips voided seats even if reserved', () => {
    assert.equal(
      countReservedOverlaySeats(
        ['X00423', 'X00301'],
        ['X00423', 'X00301'],
        ['X00301'],
      ),
      1,
    );
  });

  it('matches reserved flag case-insensitively', () => {
    assert.equal(
      countReservedOverlaySeats(['x00423', 'G0541'], ['X00423']),
      1,
    );
  });
});

describe('pickQuotaSerialsForActor', () => {
  const meezanUnused = {
    remaining: ['X00423', 'X00301', 'G0541'],
    vctRemaining: ['X00423', 'G0541'],
    reservedSerials: ['X00301'],
    reservedForUids: ['other-verifier'],
    reservedByUid: { 'other-verifier': ['X00301'] },
  };

  it('RC sees reserved seats; VCT does not', () => {
    const rc = pickQuotaSerialsForActor(meezanUnused, { isRcAdmin: true, actorUid: 'meezan' });
    const vct = pickQuotaSerialsForActor(meezanUnused, { isVct: true, actorUid: 'hafiz' });
    assert.deepEqual(rc, ['X00423', 'X00301', 'G0541']);
    assert.deepEqual(vct, ['X00423', 'G0541']);
  });

  it('empty reserved + remaining unused → verifier sees none', () => {
    const verifier = pickQuotaSerialsForActor(meezanUnused, {
      isVerifier: true,
      actorUid: 'rasheed',
    });
    assert.deepEqual(verifier, []);
  });

  it('X00423 in remaining but not reserved to Rasheed is not listed', () => {
    assert.equal(
      pickQuotaSerialsForActor(meezanUnused, { isVerifier: true, actorUid: 'rasheed' }).includes(
        'X00423',
      ),
      false,
    );
  });

  it('verifier sees own reserved unused only; other-verifier reserved excluded', () => {
    const seats = {
      ...meezanUnused,
      reservedForUids: ['rasheed', 'other-verifier'],
      reservedByUid: { rasheed: ['X00301'], 'other-verifier': ['G0541'] },
    };
    assert.deepEqual(
      pickQuotaSerialsForActor(seats, { isVerifier: true, actorUid: 'rasheed' }),
      ['X00301'],
    );
    assert.deepEqual(
      pickQuotaSerialsForActor(seats, { isVerifier: true, actorUid: 'other-verifier' }),
      ['G0541'],
    );
  });

  it('empty reserved map + remaining 130 → verifier sees []', () => {
    const unused = Array.from({ length: 130 }, (_, i) => `X${String(110 + i).padStart(5, '0')}`);
    const seats = {
      remaining: unused,
      vctRemaining: unused,
      reservedSerials: [] as string[],
      reservedForUids: [] as string[],
      reservedByUid: {} as Record<string, string[]>,
    };
    assert.deepEqual(
      pickQuotaSerialsForActor(seats, { isVerifier: true, actorUid: 'rasheed' }),
      [],
    );
  });

  it('reservedToRasheed X00110–X00120 unused → Rasheed sees those only', () => {
    const remaining = [
      'X00423',
      ...Array.from({ length: 11 }, (_, i) => `X${String(110 + i).padStart(5, '0')}`),
      'X00424',
    ];
    const mine = Array.from({ length: 11 }, (_, i) => `X${String(110 + i).padStart(5, '0')}`);
    const seats = {
      remaining,
      vctRemaining: remaining,
      reservedSerials: mine,
      reservedForUids: ['rasheed'],
      reservedByUid: { rasheed: mine },
    };
    assert.deepEqual(
      pickQuotaSerialsForActor(seats, { isVerifier: true, actorUid: 'rasheed' }),
      mine,
    );
  });

  it('used serials stay unpickable even if still on reservedByUid', () => {
    const unused = ['X00110', 'X00111'];
    const seats = {
      remaining: unused,
      vctRemaining: unused,
      reservedSerials: unused,
      reservedForUids: ['rasheed'],
      reservedByUid: { rasheed: ['X00090', 'X00110'] },
    };
    assert.deepEqual(
      pickQuotaSerialsForActor(seats, { isVerifier: true, actorUid: 'rasheed' }),
      ['X00110'],
    );
  });

  it('own reserved unused not in remaining still listed', () => {
    const unused = Array.from({ length: 11 }, (_, i) => `X${String(110 + i).padStart(5, '0')}`);
    const seats = {
      remaining: [] as string[],
      vctRemaining: [] as string[],
      reservedSerials: unused,
      reservedForUids: ['rasheed'],
      reservedByUid: { rasheed: unused },
    };
    assert.deepEqual(
      pickQuotaSerialsForActor(seats, { isVerifier: true, actorUid: 'rasheed' }),
      unused,
    );
  });

  it('unreserved reservedSerials bank is not verifier allotment', () => {
    const unused = Array.from({ length: 130 }, (_, i) => `X${String(110 + i).padStart(5, '0')}`);
    const seats = {
      remaining: [] as string[],
      vctRemaining: [] as string[],
      reservedSerials: unused,
      reservedForUids: [] as string[],
      reservedByUid: {} as Record<string, string[]>,
    };
    assert.deepEqual(
      pickQuotaSerialsForActor(seats, { isVerifier: true, actorUid: 'rasheed' }),
      [],
    );
  });

  it('verifier allotted serial missing from unused bank is dropped', () => {
    const seats = {
      remaining: ['X00423', 'G0541'],
      vctRemaining: ['X00423', 'G0541'],
      reservedSerials: [] as string[],
      reservedForUids: ['rasheed'],
      reservedByUid: { rasheed: ['X00301'] },
    };
    assert.deepEqual(
      pickQuotaSerialsForActor(seats, { isVerifier: true, actorUid: 'rasheed' }),
      [],
    );
  });

  it('verifier with no uid sees empty', () => {
    assert.deepEqual(
      pickQuotaSerialsForActor(meezanUnused, { isVerifier: true, actorUid: '' }),
      [],
    );
  });

  it('sole verifier unused is remaining 124 + reserved unused 6, not leftover', () => {
    const remaining = Array.from({ length: 124 }, (_, i) => `X${String(110 + i).padStart(5, '0')}`);
    const reservedUnused = Array.from({ length: 6 }, (_, i) => `X${String(234 + i).padStart(5, '0')}`);
    const leftover = ['X00423'];
    const reservedByUid = assignUnownedReservedToSoleUid({
      allottedByUid: { rasheed: remaining },
      unownedReserved: reservedUnused,
      reservedForUids: ['rasheed'],
    });
    const pick = pickQuotaSerialsForActor(
      {
        remaining: [...leftover, ...remaining],
        vctRemaining: leftover,
        reservedSerials: [...remaining, ...reservedUnused],
        reservedForUids: ['rasheed'],
        reservedByUid,
      },
      { isVerifier: true, actorUid: 'rasheed' },
    );
    assert.equal(pick.length, 130);
    assert.equal(pick.includes('X00423'), false);
    assert.equal(reservedUnused.every(serial => pick.includes(serial)), true);
  });

  it('sole verifier unused X00110–X00239, not used X00090–X00109, not leftover X00423', () => {
    const unused = Array.from({ length: 130 }, (_, i) => `X${String(110 + i).padStart(5, '0')}`);
    const used = Array.from({ length: 20 }, (_, i) => `X${String(90 + i).padStart(5, '0')}`);
    const leftover = ['X00423'];
    const reservedByUid = assignUnownedReservedToSoleUid({
      allottedByUid: { rasheed: [...used, ...unused] },
      unownedReserved: [],
      reservedForUids: ['rasheed'],
      rosterUids: ['rasheed'],
    });
    const pick = pickQuotaSerialsForActor(
      {
        remaining: [...leftover, ...unused],
        vctRemaining: leftover,
        reservedSerials: unused,
        reservedForUids: ['rasheed'],
        reservedByUid,
      },
      { isVerifier: true, actorUid: 'rasheed' },
    );
    assert.deepEqual(pick, unused);
    assert.equal(pick.length, 130);
    assert.equal(pick.includes('X00090'), false);
    assert.equal(pick.includes('X00109'), false);
    assert.equal(pick.includes('X00423'), false);
  });
});

describe('OV/RV Balance gate (quota only)', () => {
  const emptyGate = { remaining: [] as string[], balanceQty: 0, heldSerials: [] as string[] };

  it('blocks OV and RV when Balance is 0 (PAS no longer bypasses)', () => {
    assert.equal(
      validateOvQuotaSetup('OV', emptyGate, true, true),
      'Balance is 0. Cannot start Original Verification.',
    );
    assert.equal(
      validateOvQuotaSetup('RV', emptyGate, true, false),
      'Balance is 0. Cannot start Re-verification.',
    );
  });

  it('allows OV when Balance &gt; 0 even with empty remaining stickers', () => {
    assert.equal(
      validateOvQuotaSetup(
        'OV',
        { remaining: [], balanceQty: 54, heldSerials: [] },
        true,
        false,
      ),
      null,
    );
  });

  it('verifier direct bank skips Balance gate', () => {
    assert.equal(
      validateOvQuotaSetup(
        'OV',
        {
          remaining: [],
          balanceQty: 0,
          heldSerials: [],
          scopedToVerifier: true,
          allowInterweighingDirect: true,
        },
        true,
        false,
      ),
      null,
    );
    assert.equal(
      validateOvQuotaDevices(
        'OV',
        [{ serial: 'IW00001', serialSource: 'interweighingDirect' }],
        { remaining: [], balanceQty: 0, heldSerials: [], scopedToVerifier: true, allowInterweighingDirect: true },
      ),
      null,
    );
  });

  it('does not charge PAS devices against Balance; GAS typed serials do', () => {
    assert.equal(
      validateOvQuotaDevices('OV', [{ serial: 'YJ01001', pas: true }], emptyGate),
      null,
    );
    assert.equal(
      validateOvQuotaDevices(
        'OV',
        [{ serial: 'G0001', pas: false }],
        { remaining: [], balanceQty: 0, heldSerials: [] },
      ),
      'Balance is 0. Cannot start more Original Verifications.',
    );
    assert.equal(
      validateOvQuotaDevices(
        'OV',
        [{ serial: 'ANY123', pas: false }],
        { remaining: [], balanceQty: 2, heldSerials: [] },
      ),
      null,
    );
  });
});
