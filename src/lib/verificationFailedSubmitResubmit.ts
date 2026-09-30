import type { Role, SiteCalibration } from '../types';

/** Hourly Cloud Function re-investigates failed-at-submit. Never writes draft. */
export const FAILED_SUBMIT_AUTO_RESUBMIT_AFTER_MS = 60 * 60 * 1000;
export const FAILED_SUBMIT_AUTO_RESUBMIT_MAX = 50;

export type FailedSubmitResubmitSource = 'manual' | 'bulk' | 'auto';

export type FailedSubmitResubmitFields = Pick<
  SiteCalibration,
  | 'id'
  | 'status'
  | 'pipelineFailedPhase'
  | 'pipelineFailedAt'
  | 'supersededByResubmissionId'
  | 'certificateVoidedAt'
  | 'signedCertificatePdfUrl'
  | 'autoResubmitCount'
  | 'lastAutoResubmitAt'
  | 'lastFailedSubmitInvestigateAt'
  | 'rcId'
  | 'createdByUid'
  | 'vctId'
>;

function isFailedAtSubmitJob(record: FailedSubmitResubmitFields): boolean {
  return record.status === 'submitted' && record.pipelineFailedPhase === 'submit';
}

/** Certified/approved jobs waiting for DSC sign — never a failed-at-submit resubmit. */
export function isUnsignedIssuedCertificate(
  record: Pick<SiteCalibration, 'status' | 'signedCertificatePdfUrl'>,
): boolean {
  const status = record.status;
  if (status !== 'certified' && status !== 'approved') return false;
  return !record.signedCertificatePdfUrl?.trim();
}

export function isEligibleFailedSubmitManualResubmit(
  record: FailedSubmitResubmitFields,
): boolean {
  if (record.status === 'rejected') return false;
  if (isUnsignedIssuedCertificate(record)) return false;
  if (record.status === 'certified' || record.status === 'approved' || record.status === 'draft') {
    return false;
  }
  if (record.supersededByResubmissionId?.trim()) return false;
  if (record.certificateVoidedAt?.trim()) return false;
  return isFailedAtSubmitJob(record);
}

function parseIsoMs(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function isEligibleFailedSubmitAutoResubmit(
  record: FailedSubmitResubmitFields,
  nowMs: number,
): boolean {
  if (!isEligibleFailedSubmitManualResubmit(record)) return false;
  const stamps = [
    parseIsoMs(record.pipelineFailedAt),
    parseIsoMs(record.lastAutoResubmitAt),
    parseIsoMs(record.lastFailedSubmitInvestigateAt),
  ].filter((ms): ms is number => ms != null);
  const last = stamps.length ? Math.max(...stamps) : null;
  if (last == null) return true;
  return nowMs - last >= FAILED_SUBMIT_AUTO_RESUBMIT_AFTER_MS;
}

export function filterFailedSubmitResubmitTargets<T extends FailedSubmitResubmitFields>(
  records: T[],
): T[] {
  return records.filter(isEligibleFailedSubmitManualResubmit);
}

export function canActorResubmitFailedSubmit(
  record: FailedSubmitResubmitFields,
  actor: { role?: Role | string; uid?: string | null },
): boolean {
  if (!isEligibleFailedSubmitManualResubmit(record)) return false;
  if (actor.role === 'super_admin') return true;
  const uid = actor.uid?.trim();
  if (!uid) return false;
  if (actor.role === 'rc_admin') return record.rcId === uid;
  if (actor.role === 'vct') {
    return record.createdByUid === uid || record.vctId === uid;
  }
  return false;
}

export function canActorBulkResubmitFailedSubmit(role?: Role | string): boolean {
  return role === 'super_admin' || role === 'rc_admin';
}
