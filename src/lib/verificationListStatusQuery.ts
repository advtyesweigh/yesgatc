import type { VerificationStatusFilter } from './verificationRequest.ts';

const VERIFICATION_LIST_STATUS_QUERY_VALUES: VerificationStatusFilter[] = [
  'all',
  'draft',
  'pending_rc',
  'submitted',
  'certified',
  'failed_submit',
  'rejected',
  'duplicates',
];

/** Dashboard / list `?status=` — rejected + fail tiles must land, not drop to all. */
export function parseVerificationListStatusParam(
  raw: string | null,
): VerificationStatusFilter | null {
  if (!raw) return null;
  if (raw === 'failed_certification') return 'failed_submit';
  if (raw === 'failed_at_submit' || raw === 'failed_at_submission') return 'failed_submit';
  if (raw === 'approved') return 'submitted';
  return VERIFICATION_LIST_STATUS_QUERY_VALUES.includes(raw as VerificationStatusFilter)
    ? (raw as VerificationStatusFilter)
    : null;
}

/** Tile click lists every matching job — one row each, not collapsed by serial. */
export function verificationListKeepsUncollapsedRows(
  statusFilter: VerificationStatusFilter,
): boolean {
  return (
    statusFilter === 'pending_rc'
    || statusFilter === 'rejected'
    || statusFilter === 'failed_submit'
    || statusFilter === 'duplicates'
  );
}
