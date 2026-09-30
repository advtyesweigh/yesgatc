import type { Customer, FirestoreUserDoc, SiteCalibration } from '../types';
import { inferVerificationSubject } from './siteCalibrationProfileFields';
import { rcAdminPersonName } from './verificationSuperAdminActorLabel';

export type RcListProfile = Pick<
  FirestoreUserDoc,
  'profilePhotoUrl' | 'profilePhotoPath' | 'contactPerson' | 'username' | 'companyName'
>;

export interface VerificationPartyPhoto {
  partyPhotoUrl?: string;
  partyPhotoPath?: string;
  /** RC contact person for list VCT column when performedBy is rc. */
  rcContactPerson?: string;
  rcAdminUsername?: string;
}

export function verificationPartyPhotoForRecord(
  record: SiteCalibration,
  options: {
    rcProfile?: RcListProfile | null;
    rcUsersById?: Map<string, RcListProfile>;
    customersById?: Map<string, Customer>;
  },
): VerificationPartyPhoto {
  const subject = inferVerificationSubject(record);
  const rc =
    options.rcProfile ??
    (record.rcId ? options.rcUsersById?.get(record.rcId) : undefined);
  const rcContactPerson = rcAdminPersonName(rc) || undefined;
  const rcAdminUsername = rc?.username?.trim() || undefined;

  if (subject === 'self' || record.fileCertificateAsRc) {
    return {
      partyPhotoUrl: rc?.profilePhotoUrl,
      partyPhotoPath: rc?.profilePhotoPath,
      rcContactPerson,
      rcAdminUsername,
    };
  }

  const customer = record.customerId ? options.customersById?.get(record.customerId) : undefined;
  return {
    partyPhotoUrl: customer?.shopPhotoUrl || customer?.customerPhotoUrl,
    partyPhotoPath: customer?.shopPhotoPath || customer?.customerPhotoPath,
    rcContactPerson,
    rcAdminUsername,
  };
}

export function enrichVerificationListRecords<T extends SiteCalibration>(
  records: T[],
  options: Parameters<typeof verificationPartyPhotoForRecord>[1],
): (T & VerificationPartyPhoto)[] {
  return records.map(record => ({
    ...record,
    ...verificationPartyPhotoForRecord(record, options),
  }));
}
