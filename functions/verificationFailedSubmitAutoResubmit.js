const { FieldValue } = require('firebase-admin/firestore');

/**
 * Hourly re-investigate of failed-at-submit.
 * Never writes draft. Clear gates → submitted. Still blocked → stay failed, refresh reason.
 */
const AUTO_RESUBMIT_AFTER_MS = 60 * 60 * 1000;
const AUTO_RESUBMIT_MAX = 50;
const QUERY_LIMIT = 150;
const BATCH_LIMIT = 40;

const PLATE_ALIASES = [
  ['stampingImageUrl', 'stampingImagePath'],
  ['serialPlateImageUrl', 'serialPlateImagePath'],
  ['serialNumberPlateImageUrl', 'serialNumberPlateImagePath'],
  ['plateImageUrl', 'plateImagePath'],
  ['stampImageUrl', 'stampImagePath'],
];

const WEIGHT_ALIASES = [
  ['standardWeightImageUrl', 'standardWeightImagePath'],
  ['scaleImageUrl', 'scaleImagePath'],
  ['instrumentRearImageUrl', 'instrumentRearImagePath'],
  ['standardWeightPhoto', 'standardWeightPhotoPath'],
  ['standardWeightPhotoUrl', 'standardWeightPhotoPath'],
  ['weightImageUrl', 'weightImagePath'],
  ['weightsImageUrl', 'weightsImagePath'],
  ['weightPhotoUrl', 'weightPhotoPath'],
];

const MISSING_SERIAL = 'Device serial number is missing on the verification record.';
const MISSING_PLATE = 'Serial number plate photo is missing on the verification record.';
const MISSING_WEIGHT =
  'Standard weight photo is missing on the verification record (needed for eMAAP Upload).';

async function isFailedSubmitAutoResubmitEnabled(_db) {
  return true;
}

function parseIsoMs(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function fieldText(data, key) {
  const value = data?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function hasImagePair(data, urlKey, pathKey) {
  return Boolean(fieldText(data, urlKey) || fieldText(data, pathKey));
}

function recordHasSerialPlatePhoto(data) {
  return PLATE_ALIASES.some(([urlKey, pathKey]) => hasImagePair(data, urlKey, pathKey));
}

function recordHasStandardWeightPhoto(data) {
  return WEIGHT_ALIASES.some(([urlKey, pathKey]) => hasImagePair(data, urlKey, pathKey));
}

function isFailedAtSubmit(data) {
  return data?.status === 'submitted' && data?.pipelineFailedPhase === 'submit';
}

function isUnsignedIssued(data) {
  const status = data?.status;
  if (status !== 'certified' && status !== 'approved') return false;
  const signed = typeof data?.signedCertificatePdfUrl === 'string' ? data.signedCertificatePdfUrl.trim() : '';
  return !signed;
}

function lastFailMs(data) {
  const stamps = [
    parseIsoMs(data?.pipelineFailedAt),
    parseIsoMs(data?.lastAutoResubmitAt),
    parseIsoMs(data?.lastFailedSubmitInvestigateAt),
    parseIsoMs(data?.lastFailedSubmitResubmitAt),
  ].filter(ms => ms != null);
  return stamps.length ? Math.max(...stamps) : null;
}

function isEligibleFailedSubmitAutoResubmit(data, nowMs) {
  if (!isFailedAtSubmit(data)) return false;
  if (data?.status === 'rejected' || data?.status === 'draft') return false;
  if (data?.status === 'certified' || data?.status === 'approved') return false;
  if (isUnsignedIssued(data)) return false;
  if (typeof data?.supersededByResubmissionId === 'string' && data.supersededByResubmissionId.trim()) {
    return false;
  }
  const failedMs = lastFailMs(data);
  if (failedMs == null) return true;
  return nowMs - failedMs >= AUTO_RESUBMIT_AFTER_MS;
}

/** Same photo/serial gates the worker uses. Never invents a serial. */
function investigateFailedSubmit(data) {
  const serial = fieldText(data, 'serialNumber');
  if (!serial) return MISSING_SERIAL;
  if (!recordHasSerialPlatePhoto(data)) return MISSING_PLATE;
  if (!recordHasStandardWeightPhoto(data)) return MISSING_WEIGHT;
  return null;
}

function autoResubmitPatch(nowIso) {
  return {
    status: 'submitted',
    submittedAt: nowIso,
    updatedAt: nowIso,
    pipelineFailedPhase: FieldValue.delete(),
    pipelineFailureMessage: FieldValue.delete(),
    pipelineFailedAt: FieldValue.delete(),
    certificationLastError: FieldValue.delete(),
    lastFailedSubmitResubmitAt: nowIso,
    lastAutoResubmitAt: nowIso,
    lastFailedSubmitInvestigateAt: nowIso,
    autoResubmitCount: FieldValue.increment(1),
    failedSubmitResubmitSource: 'auto',
  };
}

function stayFailedPatch(reason, nowIso, previousMessage) {
  const trimmed = reason.trim() || 'Certification could not proceed.';
  const patch = {
    status: 'submitted',
    pipelineFailedPhase: 'submit',
    updatedAt: nowIso,
    lastFailedSubmitInvestigateAt: nowIso,
  };
  if (trimmed !== (previousMessage || '').trim()) {
    patch.pipelineFailureMessage = trimmed;
  }
  return patch;
}

async function collectAutoResubmitCandidates(db, nowMs, limit) {
  const seen = new Set();
  const candidates = [];

  const snap = await db
    .collection('siteCalibrations')
    .where('pipelineFailedPhase', '==', 'submit')
    .limit(QUERY_LIMIT)
    .get();

  for (const doc of snap.docs) {
    if (candidates.length >= limit) break;
    if (seen.has(doc.id)) continue;
    const data = doc.data();
    if (!isEligibleFailedSubmitAutoResubmit(data, nowMs)) continue;
    seen.add(doc.id);
    candidates.push({ id: doc.id, data });
  }

  return candidates.slice(0, limit);
}

async function autoResubmitFailedSubmitVerificationsHandler(db) {
  if (!(await isFailedSubmitAutoResubmitEnabled(db))) {
    console.log('failedSubmitAutoResubmit: disabled');
    return { enabled: false, resubmitted: 0, stayed: 0, scanned: 0 };
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const candidates = await collectAutoResubmitCandidates(db, nowMs, BATCH_LIMIT);

  let resubmitted = 0;
  let stayed = 0;
  const errors = [];

  for (const { id, data } of candidates) {
    try {
      const reason = investigateFailedSubmit(data);
      if (reason) {
        await db.collection('siteCalibrations').doc(id).update(
          stayFailedPatch(reason, nowIso, data?.pipelineFailureMessage),
        );
        stayed += 1;
        continue;
      }

      await db.collection('siteCalibrations').doc(id).update(autoResubmitPatch(nowIso));
      resubmitted += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ id, message });
      console.error(`failedSubmitAutoResubmit: failed ${id}: ${message}`);
    }
  }

  console.log(
    `failedSubmitAutoResubmit: resubmitted=${resubmitted} stayed=${stayed} candidates=${candidates.length} errors=${errors.length}`,
  );

  return {
    enabled: true,
    resubmitted,
    stayed,
    scanned: candidates.length,
    errors,
  };
}

module.exports = {
  AUTO_RESUBMIT_AFTER_MS,
  AUTO_RESUBMIT_MAX,
  BATCH_LIMIT,
  MISSING_SERIAL,
  MISSING_PLATE,
  MISSING_WEIGHT,
  isEligibleFailedSubmitAutoResubmit,
  investigateFailedSubmit,
  recordHasSerialPlatePhoto,
  recordHasStandardWeightPhoto,
  autoResubmitFailedSubmitVerificationsHandler,
};
