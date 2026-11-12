export type OvQuotaAllotment = {
  serialNumber: string;
  sku?: string;
  productId?: string;
  productName?: string;
  modelNo?: string;
  pool?: string;
};

export type OvQuotaGate = {
  remaining: string[];
  remainingAllotments?: OvQuotaAllotment[];
  balanceQty: number | null;
  heldSerials: string[];
  /** Verifier job: remaining is that uid's unused allotment only. */
  scopedToVerifier?: boolean;
  /** Unused Interweighing-direct serials. Isolated from Yesone remaining. */
  directRemaining?: string[];
  /** Verifier may start OV without Yesone remaining (direct bank / typed direct). */
  allowInterweighingDirect?: boolean;
};

function serialKey(value: string): string {
  return value.trim().toUpperCase();
}

function allotmentPool(row: Pick<OvQuotaAllotment, 'pool'>): string {
  return String(row.pool || '').trim().toLowerCase();
}

/**
 * Unused GAS stickers are one bank for every GAS product.
 * Kept for Balance accounting / legacy callers — stamp UI no longer picks from this list.
 */
export function remainingSerialsForProduct(
  remaining: string[],
  allotments: OvQuotaAllotment[] | undefined,
  product?: { productId?: string; productName?: string; sku?: string; modelNo?: string } | null,
): string[] {
  void product;
  if (!Array.isArray(allotments) || allotments.length === 0) return remaining;
  const pasKeys = new Set<string>();
  for (const row of allotments) {
    if (allotmentPool(row) !== 'pas') continue;
    const key = serialKey(row.serialNumber);
    if (key) pasKeys.add(key);
  }
  if (pasKeys.size === 0) return remaining;
  return remaining.filter(serial => !pasKeys.has(serialKey(serial)));
}

/** OV/RV quantity left (Allotted − Used). Source of truth for work left. */
export function ovQuotaQtyCap(gate: OvQuotaGate): number {
  return gate.balanceQty == null ? gate.remaining.length : Math.max(0, gate.balanceQty);
}

/** @deprecated Prefer ovQuotaQtyCap — stamp no longer binds unused sticker count. */
export function ovQuotaSeatCap(gate: OvQuotaGate): number {
  return ovQuotaQtyCap(gate);
}

export function ovSerialChoicesForRow(
  current: string,
  remaining: string[],
  heldSerials: string[],
  otherTaken: string[],
): string[] {
  const taken = new Set(otherTaken.map(serialKey).filter(Boolean));
  const keep = serialKey(current);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const serial of [...remaining, ...heldSerials, current]) {
    const trimmed = serial.trim();
    if (!trimmed) continue;
    const key = serialKey(trimmed);
    if (seen.has(key)) continue;
    if (taken.has(key) && key !== keep) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * New OV/RV requires Balance &gt; 0. No allotted-sticker / bank membership check.
 * Direct Interweighing source may still start when Balance is 0.
 */
export function validateOvQuotaSetup(
  verificationType: string,
  gate: OvQuotaGate | null | undefined,
  isNew: boolean,
  _hasPasProducts = false,
): string | null {
  void _hasPasProducts;
  if (!gate || !isNew) return null;
  if (verificationType !== 'OV' && verificationType !== 'RV') return null;
  if (gate.allowInterweighingDirect) return null;
  if (ovQuotaQtyCap(gate) <= 0) {
    return verificationType === 'RV'
      ? 'Balance is 0. Cannot start Re-verification.'
      : 'Balance is 0. Cannot start Original Verification.';
  }
  return null;
}

export type OvQuotaDeviceRow = {
  serial: string;
  pas?: boolean;
  serialSource?: string;
};

function isDirectQuotaRow(row: OvQuotaDeviceRow): boolean {
  return String(row.serialSource || '').trim() === 'interweighingDirect';
}

/**
 * OV devices: require typed serial + Balance qty for GAS seats.
 * No “must be in allotted remaining” check. PAS does not consume Balance.
 */
export function validateOvQuotaDevices(
  verificationType: string,
  rows: OvQuotaDeviceRow[],
  gate: OvQuotaGate | null | undefined,
): string | null {
  if (!gate || verificationType !== 'OV') return null;
  const held = new Set(gate.heldSerials.map(serialKey).filter(Boolean));
  const seen = new Set<string>();
  let newGas = 0;
  for (const row of rows) {
    const serial = (row.serial || '').trim();
    const pas = Boolean(row.pas);
    const direct = isDirectQuotaRow(row);
    if (!serial) {
      if (!pas && !direct) newGas += 1;
      continue;
    }
    const key = serialKey(serial);
    if (seen.has(key)) return `Serial ${serial} is used more than once.`;
    seen.add(key);
    if (held.has(key)) continue;
    if (pas || direct) continue;
    newGas += 1;
  }
  const qtyCap = ovQuotaQtyCap(gate);
  if (newGas > qtyCap) {
    return qtyCap <= 0
      ? 'Balance is 0. Cannot start more Original Verifications.'
      : `Balance: ${qtyCap} left. You can start ${qtyCap} more Original Verification(s).`;
  }
  return null;
}
