import type { SiteCalibration } from '../types';

function isVerifierPerformed(
  record: Pick<SiteCalibration, 'performedBy' | 'requestSource'>,
): boolean {
  return record.performedBy === 'verifier' || record.requestSource === 'verifier_manual';
}

/**
 * RC admin person (Riyas), never centre/company.
 * `contactPerson` first; `username` only when it is not the company name.
 */
export function rcAdminPersonName(rc?: {
  contactPerson?: string | null;
  username?: string | null;
  companyName?: string | null;
} | null): string {
  const contact = rc?.contactPerson?.trim();
  if (contact) return contact;
  const username = rc?.username?.trim();
  const company = rc?.companyName?.trim();
  if (username && (!company || username.toLowerCase() !== company.toLowerCase())) {
    return username;
  }
  return '';
}

/**
 * Super Admin list/detail actor slot. Third-party verifier → RC admin person.
 * VCT and RC self unchanged.
 */
export function verificationSuperAdminActorLabel(
  record: Pick<SiteCalibration, 'performedBy' | 'requestSource' | 'vctName' | 'vctId'>,
  options?: {
    rcContactPerson?: string | null;
    rcAdminUsername?: string | null;
    rcCenterName?: string | null;
  },
): string {
  if (isVerifierPerformed(record)) {
    return (
      rcAdminPersonName({
        contactPerson: options?.rcContactPerson,
        username: options?.rcAdminUsername,
        companyName: options?.rcCenterName,
      }) || '—'
    );
  }
  if (record.performedBy === 'vct' || record.vctId?.trim()) {
    return record.vctName?.trim() || record.vctId || 'VCT';
  }
  return (
    record.vctName?.trim()
    || options?.rcContactPerson?.trim()
    || 'Self'
  );
}
