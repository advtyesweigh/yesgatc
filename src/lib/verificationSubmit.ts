import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { db } from '../firebase';
import {
  buildLiveCertifiedSerialKeySet,
  buildRcApproveVerifierPatch,
  buildVerificationRejectPatch,
  certifiedSerialAlreadyUsedReason,
  isOvCertifiedSerialDuplicate,
  buildVerificationSubmitPatch,
  buildVerifierRcReviewPatch,
  planCertifiedSerialDuplicateRejects,
} from './verificationRequest';
import { filterPendingRcSubmitTargets } from './verificationPendingRcBulk';
import { verificationClientVersionFields } from './verificationAppVersion';
import { hideOvEditResubmitCertificatesAfterSubmit } from './verificationResubmit';
import { queueRvZohoInvoicesAfterSubmit, submitRvWithZohoGate } from './zohoRvInvoice';
import type { JobType, SiteCalibration } from '../types';
import type { RcFilingPartyPatch } from './keralaRegion';

export type VerificationSubmitTarget = {
  id: string;
  verificationType?: JobType | '';
  serialNumber?: string;
  rcId?: string;
} & Partial<RcFilingPartyPatch>;

export type VerificationSubmitOptions = {
  /** When true, RV records use submitRvWithZohoGate instead of direct Firestore submit. */
  zohoRvInvoicingEnabled?: boolean;
  /** Used to hide old OV certificates when an edit-resubmit clone is submitted. */
  lookupRecords?: SiteCalibration[];
};

export type PendingRcApproveSubmitOptions = VerificationSubmitOptions & {
  filingFields?: (record: SiteCalibration) => Partial<RcFilingPartyPatch>;
  beforeSubmit?: (records: SiteCalibration[]) => Promise<void>;
};

function submitPatch(target: VerificationSubmitTarget) {
  return {
    ...buildVerificationSubmitPatch(),
    ...(typeof target.fileCertificateAsRc === 'boolean'
      ? { fileCertificateAsRc: target.fileCertificateAsRc }
      : {}),
    ...(target.verificationSubject ? { verificationSubject: target.verificationSubject } : {}),
    ...(target.customerId ? { customerId: target.customerId } : {}),
    ...(target.customerName ? { customerName: target.customerName } : {}),
    ...(target.sourceCustomerId ? { sourceCustomerId: target.sourceCustomerId } : {}),
    ...(target.sourceCustomerName ? { sourceCustomerName: target.sourceCustomerName } : {}),
  };
}

async function hideOvCertsIfEditResubmit(
  firestore: Firestore,
  targets: VerificationSubmitTarget[],
  options?: VerificationSubmitOptions,
): Promise<void> {
  await hideOvEditResubmitCertificatesAfterSubmit(
    firestore,
    targets.map(target => target.id),
    options?.lookupRecords ?? [],
  );
}

/**
 * Submit one or more draft verifications (RC Admin, VCT, or Super Admin flows).
 * When Zoho RV invoicing is enabled, RV records are invoiced in Zoho while still draft,
 * then marked submitted; OV records submit immediately as before.
 */
function recordForCertifiedDupeCheck(
  target: VerificationSubmitTarget,
  lookup: SiteCalibration[],
): SiteCalibration {
  const found = lookup.find(row => row.id === target.id);
  if (found) return found;
  return {
    id: target.id,
    verificationType: target.verificationType || 'OV',
    serialNumber: target.serialNumber || '',
    rcId: target.rcId || '',
    status: 'draft',
    customerName: '',
  } as SiteCalibration;
}

export async function rejectCertifiedSerialDuplicateSubmits(
  records: SiteCalibration[],
  firestore: Firestore = db,
): Promise<number> {
  const targets = planCertifiedSerialDuplicateRejects(records);
  if (targets.length === 0) return 0;
  await rejectVerificationRecords(
    targets.map(record => ({
      id: record.id,
      reason: certifiedSerialAlreadyUsedReason(record.serialNumber),
    })),
    firestore,
  );
  return targets.length;
}

export async function submitVerificationRecords(
  targets: VerificationSubmitTarget[],
  firestore: Firestore = db,
  options?: VerificationSubmitOptions,
): Promise<void> {
  if (targets.length === 0) return;

  const lookup = options?.lookupRecords ?? [];
  const lookupWithTargets = [
    ...lookup,
    ...targets.map(target => recordForCertifiedDupeCheck(target, lookup)),
  ];
  const certifiedKeys = buildLiveCertifiedSerialKeySet(lookupWithTargets);
  const rejectTargets: Array<{ id: string; reason: string }> = [];
  const submitTargets: VerificationSubmitTarget[] = [];
  for (const target of targets) {
    const record = recordForCertifiedDupeCheck(target, lookupWithTargets);
    if (isOvCertifiedSerialDuplicate(record, certifiedKeys)) {
      rejectTargets.push({
        id: target.id,
        reason: certifiedSerialAlreadyUsedReason(record.serialNumber || target.serialNumber),
      });
      continue;
    }
    submitTargets.push(target);
  }

  if (rejectTargets.length > 0) {
    await rejectVerificationRecords(rejectTargets, firestore);
  }
  if (submitTargets.length === 0) return;

  const rvTargets = submitTargets.filter(target => target.verificationType === 'RV');
  const nonRvTargets = submitTargets.filter(target => target.verificationType !== 'RV');

  await hideOvCertsIfEditResubmit(firestore, submitTargets, options);

  const submitNonRv = nonRvTargets.map(target =>
    updateDoc(doc(firestore, 'siteCalibrations', target.id), submitPatch(target)),
  );

  if (options?.zohoRvInvoicingEnabled && rvTargets.length > 0) {
    await Promise.all([
      ...submitNonRv,
      ...rvTargets
        .filter(target => typeof target.fileCertificateAsRc === 'boolean' || target.customerName)
        .map(target =>
          updateDoc(doc(firestore, 'siteCalibrations', target.id), {
            ...(typeof target.fileCertificateAsRc === 'boolean'
              ? { fileCertificateAsRc: target.fileCertificateAsRc }
              : {}),
            ...(target.verificationSubject ? { verificationSubject: target.verificationSubject } : {}),
            ...(target.customerId ? { customerId: target.customerId } : {}),
            ...(target.customerName ? { customerName: target.customerName } : {}),
            ...(target.sourceCustomerId ? { sourceCustomerId: target.sourceCustomerId } : {}),
            ...(target.sourceCustomerName ? { sourceCustomerName: target.sourceCustomerName } : {}),
            ...verificationClientVersionFields(),
          }),
        ),
    ]);
    await submitRvWithZohoGate({ recordIds: rvTargets.map(target => target.id) });
    return;
  }

  await Promise.all([
    ...submitNonRv,
    ...rvTargets.map(target =>
      updateDoc(doc(firestore, 'siteCalibrations', target.id), submitPatch(target)),
    ),
  ]);

  queueRvZohoInvoicesAfterSubmit(rvTargets.map(target => target.id));
}

export async function submitVerificationRecord(
  target: VerificationSubmitTarget,
  firestore: Firestore = db,
  options?: VerificationSubmitOptions,
): Promise<void> {
  return submitVerificationRecords([target], firestore, options);
}

export async function rejectVerificationRecords(
  targets: Array<{ id: string; reason: string }>,
  firestore: Firestore = db,
): Promise<void> {
  if (targets.length === 0) return;
  await Promise.all(
    targets.map(target =>
      updateDoc(doc(firestore, 'siteCalibrations', target.id), buildVerificationRejectPatch(target.reason)),
    ),
  );
}

export async function submitVerifierWorkForRcReview(
  recordIds: string[],
  firestore: Firestore = db,
): Promise<void> {
  if (recordIds.length === 0) return;
  const patch = buildVerifierRcReviewPatch();
  await Promise.all(
    recordIds.map(recordId => updateDoc(doc(firestore, 'siteCalibrations', recordId), patch)),
  );
}

/**
 * RC Admin / Super Admin: stamp RC approval, then the same eMAAP submit as drafts.
 * Does not invent a certificate flow — Approve row + submitVerificationRecords.
 */
export async function approveAndSubmitPendingRcRecords(
  records: SiteCalibration[],
  actorUid: string,
  firestore: Firestore = db,
  options?: PendingRcApproveSubmitOptions,
): Promise<void> {
  const targets = filterPendingRcSubmitTargets(records);
  if (targets.length === 0) return;

  const patch = buildRcApproveVerifierPatch(actorUid);
  await Promise.all(
    targets.map(record => updateDoc(doc(firestore, 'siteCalibrations', record.id), patch)),
  );
  await options?.beforeSubmit?.(targets);
  await submitVerificationRecords(
    targets.map(record => ({
      id: record.id,
      verificationType: record.verificationType,
      ...options?.filingFields?.(record),
    })),
    firestore,
    options,
  );
}
