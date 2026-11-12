const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HttpsError } = require('firebase-functions/v2/https');
const {
  addRcGasSerialsCore,
  addRcGasSerialsHandler,
  parseGasStickerSerials,
} = require('./addRcGasSerials');

function createMemoryDb(seed = {}) {
  const store = { ...seed };
  return {
    _store: store,
    doc(path) {
      return {
        path,
        async get() {
          const data = store[path];
          return {
            exists: data != null,
            data: () => (data == null ? undefined : { ...data }),
          };
        },
        async set(data, opts) {
          if (opts?.merge && store[path]) {
            store[path] = { ...store[path], ...data };
          } else {
            store[path] = { ...data };
          }
        },
      };
    },
  };
}

test('parseGasStickerSerials keeps any non-empty token', () => {
  assert.deepEqual(parseGasStickerSerials('G0540, YJ01001\nx00301 1130 VJ00151'), {
    valid: ['G0540', 'YJ01001', 'X00301', '1130', 'VJ00151'],
    invalid: [],
  });
});

test('addRcGasSerialsCore writes YJ/VJ into bank + allotments without bumping ovQuota', async () => {
  const db = createMemoryDb({
    'users/rc1': {
      role: 'rc_admin',
      rcCode: 'ABC',
      companyName: 'Meezan',
      ovQuota: 10,
      yesoneAllottedSerials: ['G0001'],
    },
  });

  const result = await addRcGasSerialsCore(db, {
    rcUid: 'rc1',
    rcCode: 'ABC',
    companyName: 'Meezan',
    raw: 'G0001, G0002, X00999, YJ00498, VJ00151',
  });

  assert.deepEqual(result.added, ['G0002', 'X00999', 'YJ00498', 'VJ00151']);
  assert.deepEqual(result.alreadyPresent, ['G0001']);
  assert.deepEqual(result.invalid, []);
  assert.equal(result.ovQuotaDelta, 0);
  assert.equal(result.ovQuota, 10);
  assert.equal(db._store['users/rc1'].ovQuota, 10);
  assert.equal(db._store['users/rc1'].ovQuotaSource, undefined);
  assert.ok(db._store['users/rc1'].yesoneAllottedSerials.includes('YJ00498'));
  assert.ok(db._store['users/rc1'].yesoneAllottedSerials.includes('VJ00151'));
  assert.equal(db._store['serialAllotments/YJ00498'].rcId, 'rc1');
  assert.equal(db._store['serialAllotments/YJ00498'].pool, 'pas');
  assert.equal(db._store['serialAllotments/YJ00498'].source, 'rc_settings');
  assert.equal(db._store['serialAllotments/VJ00151'].status, 'allotted');
  assert.equal(db._store['serialAllotments/VJ00151'].pool, 'pas');
  assert.equal(db._store['serialAllotments/G0002'].pool, 'gas');
});

test('addRcGasSerialsCore rejects foreign RC allotments without steal', async () => {
  const db = createMemoryDb({
    'users/rc1': {
      role: 'rc_admin',
      rcCode: 'ABC',
      ovQuota: 5,
      yesoneAllottedSerials: [],
    },
    'serialAllotments/G0540': {
      serialNumber: 'G0540',
      rcId: 'other',
      status: 'allotted',
    },
  });

  const result = await addRcGasSerialsCore(db, {
    rcUid: 'rc1',
    rcCode: 'ABC',
    raw: 'G0540',
  });

  assert.deepEqual(result.added, []);
  assert.deepEqual(result.conflicts, ['G0540']);
  assert.equal(result.ovQuotaDelta, 0);
  assert.equal(db._store['serialAllotments/G0540'].rcId, 'other');
  assert.deepEqual(db._store['users/rc1'].yesoneAllottedSerials, []);
});

test('addRcGasSerialsHandler surfaces unexpected throws as failed-precondition', async () => {
  await assert.rejects(
    () => addRcGasSerialsHandler(
      { auth: { uid: 'rc1' }, data: { serials: 'G0001' } },
      async () => { throw new Error('role lookup blew up'); },
      createMemoryDb(),
    ),
    err => err instanceof HttpsError
      && err.code === 'failed-precondition'
      && /role lookup blew up/.test(err.message),
  );
});
