const { HttpsError } = require('firebase-functions/v2/https');

const SERIAL_COLLECTION = 'serialAllotments';
const WRITE_CHUNK = 400;

function text(value) {
  return String(value ?? '').trim();
}

function serialDocId(serial) {
  const trimmed = text(serial);
  if (!trimmed) return null;
  return trimmed.toUpperCase().replace(/[/\\]/g, '_').slice(0, 700);
}

function uniqueList(values) {
  const out = [];
  const seen = new Set();
  for (const item of values || []) {
    const serial = text(item);
    if (!serial) continue;
    const key = serial.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(serial);
  }
  return out;
}

/**
 * Split pasted sticker text. Trim, uppercase, dedupe. Any non-empty token OK.
 * Exported for unit tests.
 */
function parseGasStickerSerials(raw) {
  const tokens = String(raw ?? '')
    .split(/[\s,;]+/)
    .map(token => token.trim())
    .filter(Boolean);

  const valid = [];
  const seen = new Set();

  for (const token of tokens) {
    const serial = token.toUpperCase();
    if (seen.has(serial)) continue;
    seen.add(serial);
    valid.push(serial);
  }

  return { valid, invalid: [] };
}

function parseQuotaNumber(value) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Settings → Serial → Add: append stickers to GAS stamp bank only.
 * Does NOT touch ovQuota / ovQuotaUsed — Balance stays YesOne/admin accounting.
 */
async function addRcGasSerialsCore(db, input) {
  const rcUid = text(input.rcUid);
  const rcCode = text(input.rcCode).replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 3);
  const companyName = text(input.companyName);
  const { valid, invalid } = parseGasStickerSerials(input.raw);
  if (!rcUid) {
    throw new HttpsError('invalid-argument', 'RC uid is required.');
  }
  if (valid.length === 0) {
    return {
      added: [],
      alreadyPresent: [],
      invalid,
      conflicts: [],
      ovQuota: null,
      ovQuotaDelta: 0,
    };
  }

  const userRef = db.doc(`users/${rcUid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new HttpsError('not-found', 'RC profile not found.');
  }
  const user = userSnap.data() || {};
  const held = new Set(
    uniqueList(user.yesoneAllottedSerials).map(serial => serial.toUpperCase()),
  );

  const alreadyPresent = [];
  const conflicts = [];
  /** New stickers → serialAllotments + bank (no ovQuota change). */
  const toCreate = [];
  /** Already in serialAllotments for this RC but missing from yesoneAllottedSerials. */
  const repairBank = [];

  for (const serial of valid) {
    const id = serialDocId(serial);
    if (!id) continue;
    if (held.has(serial)) {
      alreadyPresent.push(serial);
      continue;
    }
    const allotRef = db.doc(`${SERIAL_COLLECTION}/${id}`);
    const allotSnap = await allotRef.get();
    if (allotSnap.exists) {
      const prevRc = text(allotSnap.data()?.rcId);
      if (prevRc && prevRc !== rcUid) {
        conflicts.push(serial);
        continue;
      }
      alreadyPresent.push(serial);
      repairBank.push(serial);
      continue;
    }
    toCreate.push(serial);
  }

  const now = new Date().toISOString();
  const bankAdds = uniqueList([...toCreate, ...repairBank]);
  const nextBank = uniqueList([
    ...uniqueList(user.yesoneAllottedSerials),
    ...bankAdds,
  ]);
  const wrote = bankAdds.length > 0 || toCreate.length > 0;

  if (wrote) {
    await userRef.set(
      {
        yesoneAllottedSerials: nextBank,
        updatedAt: now,
      },
      { merge: true },
    );

    const stickerPool = serial => {
      const key = text(serial).toUpperCase();
      if (key.startsWith('YJ') || key.startsWith('AS') || key.startsWith('VJ')) return 'pas';
      return 'gas';
    };

    const allotmentPatch = serial => ({
      serialNumber: serial,
      rcId: rcUid,
      rcCode: rcCode || text(user.rcCode) || null,
      rcCompanyName: companyName || text(user.companyName) || null,
      status: 'allotted',
      pool: stickerPool(serial),
      source: 'rc_settings',
      allottedAt: now,
      updatedAt: now,
    });

    // Repair bank membership only — keep truthful pool (PAS-format stays pas).
    for (const serial of repairBank) {
      const id = serialDocId(serial);
      if (!id) continue;
      await db.doc(`${SERIAL_COLLECTION}/${id}`).set(
        {
          pool: stickerPool(serial),
          source: 'rc_settings',
          updatedAt: now,
        },
        { merge: true },
      );
    }

    for (let i = 0; i < toCreate.length; i += WRITE_CHUNK) {
      const slice = toCreate.slice(i, i + WRITE_CHUNK);
      if (typeof db.batch === 'function') {
        const batch = db.batch();
        for (const serial of slice) {
          const id = serialDocId(serial);
          batch.set(db.doc(`${SERIAL_COLLECTION}/${id}`), allotmentPatch(serial), { merge: true });
        }
        await batch.commit();
      } else {
        for (const serial of slice) {
          const id = serialDocId(serial);
          await db.doc(`${SERIAL_COLLECTION}/${id}`).set(allotmentPatch(serial), { merge: true });
        }
      }
    }
  }

  return {
    added: toCreate,
    alreadyPresent: uniqueList(alreadyPresent),
    invalid,
    conflicts: uniqueList(conflicts),
    ovQuota: parseQuotaNumber(user.ovQuota),
    ovQuotaDelta: 0,
  };
}

async function addRcGasSerialsHandler(request, getCallerRole, db) {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    const uid = request.auth.uid;
    const role = await getCallerRole(uid);
    if (role !== 'rc_admin') {
      throw new HttpsError('permission-denied', 'RC admin only.');
    }

    const raw = request.data?.serials ?? request.data?.raw ?? '';
    const result = await addRcGasSerialsCore(db, {
      rcUid: uid,
      rcCode: request.data?.rcCode,
      companyName: request.data?.companyName,
      raw: Array.isArray(raw) ? raw.join(',') : raw,
    });

    if (
      result.added.length === 0
      && result.alreadyPresent.length === 0
      && result.conflicts.length === 0
    ) {
      if (result.invalid.length > 0) {
        throw new HttpsError(
          'invalid-argument',
          `No valid GAS serials. Invalid: ${result.invalid.slice(0, 8).join(', ')}`,
        );
      }
      throw new HttpsError('invalid-argument', 'Paste at least one serial.');
    }

    if (result.added.length === 0 && result.conflicts.length > 0) {
      throw new HttpsError(
        'failed-precondition',
        `Serials belong to another RC: ${result.conflicts.slice(0, 8).join(', ')}`,
      );
    }

    return result;
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error('addRcGasSerials unexpected', err);
    // Prefer failed-precondition so client sees message (HttpsError internal hides detail).
    const message = err && err.message ? String(err.message).slice(0, 500) : 'addRcGasSerials failed.';
    throw new HttpsError('failed-precondition', message);
  }
}

module.exports = {
  addRcGasSerialsHandler,
  addRcGasSerialsCore,
  parseGasStickerSerials,
  serialDocId,
};
