import type { VerificationJobKind } from './verificationJobKinds.ts';

/** Default when RC has not expanded permissions — OV Self only. */
export const DEFAULT_VERIFIER_JOB_KINDS: VerificationJobKind[] = ['ov_self'];

const KIND_ORDER: VerificationJobKind[] = ['ov_self', 'ov_customer', 'rv_customer'];

export const VERIFIER_JOB_KIND_OPTIONS: Array<{
  id: VerificationJobKind;
  label: string;
  short: string;
}> = [
  { id: 'ov_self', label: 'OV Self', short: 'OV Self' },
  { id: 'ov_customer', label: 'OV Customer', short: 'OV Cust' },
  { id: 'rv_customer', label: 'RV Customer', short: 'RV' },
];

const KIND_SET = new Set<string>(KIND_ORDER);

export function isVerificationJobKind(value: unknown): value is VerificationJobKind {
  return typeof value === 'string' && KIND_SET.has(value);
}

/** Normalize stored kinds; empty/invalid → OV Self only. */
export function normalizeVerifierJobKinds(raw: unknown): VerificationJobKind[] {
  if (!Array.isArray(raw)) return [...DEFAULT_VERIFIER_JOB_KINDS];
  const next = KIND_ORDER.filter(kind => raw.includes(kind));
  return next.length > 0 ? next : [...DEFAULT_VERIFIER_JOB_KINDS];
}

export function toggleVerifierJobKind(
  current: VerificationJobKind[],
  kind: VerificationJobKind,
): VerificationJobKind[] {
  const set = new Set(normalizeVerifierJobKinds(current));
  if (set.has(kind)) {
    if (set.size <= 1) return [...set];
    set.delete(kind);
  } else {
    set.add(kind);
  }
  return KIND_ORDER.filter(id => set.has(id));
}

export function verifierJobKindsShortLabel(raw: unknown): string {
  const kinds = normalizeVerifierJobKinds(raw);
  return VERIFIER_JOB_KIND_OPTIONS.filter(opt => kinds.includes(opt.id))
    .map(opt => opt.short)
    .join(' · ');
}

export function validateVerifierJobKinds(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    return 'Pick at least one job type (OV / RV).';
  }
  if (!raw.some(isVerificationJobKind)) {
    return 'Pick at least one job type (OV / RV).';
  }
  return null;
}
