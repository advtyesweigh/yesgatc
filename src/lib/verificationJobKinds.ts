import { normalizeVerifierJobKinds } from './verifierJobKinds.ts';

export type VerificationJobKind = 'ov_self' | 'ov_customer' | 'rv_customer';

export const ALL_VERIFICATION_JOB_KINDS: VerificationJobKind[] = [
  'ov_self',
  'ov_customer',
  'rv_customer',
];

/**
 * RC / VCT: all kinds.
 * Verifier: RC-granted `allowedJobKinds` (default OV Self only).
 */
export function verificationJobKindsForActor(
  verifierMode: boolean,
  allowedJobKinds?: unknown,
): VerificationJobKind[] {
  if (!verifierMode) return [...ALL_VERIFICATION_JOB_KINDS];
  return normalizeVerifierJobKinds(allowedJobKinds);
}
