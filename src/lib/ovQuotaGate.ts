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
  /** Verifier may type Interweighing-direct serials (does not bypass Balance). */
  allowInterweighingDirect?: boolean;
  /**
   * Master RC (IWP / Interweighing) — unlimited OV; Balance qty ignored.
   * Set from `isMasterRc` on the parent RC profile.
   */
  skipBalanceGate?: boolean;
};

/** List / picker / toast when Balance ≤ 0 blocks New OV (RV never gated). */
export const OV_BALANCE_EXHAUSTED_MESSAGE =
  "You don't have quota remaining. Balance is 0. Cannot start Original Verification.";

export const OV_BALANCE_ZERO_SETUP = OV_BALANCE_EXHAUSTED_MESSAGE;

export const OV_BALANCE_ZERO_MORE =
  "You don't have quota remaining. Balance is 0. Cannot start more Original Verifications.";

/** @deprecated Use OV_BALANCE_EXHAUSTED_MESSAGE — RV is not Balance-gated. */
export const OV_RV_BALANCE_ZERO_MESSAGE = OV_BALANCE_EXHAUSTED_MESSAGE;

/** @deprecated RV has no Balance gate. */
export const RV_BALANCE_ZERO_SETUP = OV_BALANCE_EXHAUSTED_MESSAGE;

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

/** OV quantity left (Allotted − Used). Master RC skips Balance — treat as uncapped. */
export function ovQuotaQtyCap(gate: OvQuotaGate): number {
  if (gate.skipBalanceGate) return Number.POSITIVE_INFINITY;
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

/** True when Balance is known and ≤ 0 (blocks New OV only — not RV, not master RC). */
export function isOvBalanceExhausted(balanceQty: number | null | undefined): boolean {
  return balanceQty != null && balanceQty <= 0;
}

/** @deprecated Prefer isOvBalanceExhausted — name kept for local call sites. */
export function isOvRvBalanceExhausted(balanceQty: number | null | undefined): boolean {
  return isOvBalanceExhausted(balanceQty);
}

/** Warning copy; mentions negative Balance when useful. */
export function ovBalanceExhaustedMessage(balanceQty: number | null | undefined): string {
  if (balanceQty != null && balanceQty < 0) {
    return `You don't have quota remaining. Balance is ${balanceQty}. Cannot start Original Verification.`;
  }
  return OV_BALANCE_EXHAUSTED_MESSAGE;
}

/**
 * New OV requires Balance &gt; 0. RV never gated. Master RC (skipBalanceGate) never gated.
 * No allotted-sticker / bank membership check. Interweighing-direct does not bypass Balance.
 */
export function validateOvQuotaSetup(
  verificationType: string,
  gate: OvQuotaGate | null | undefined,
  isNew: boolean,
  _hasPasProducts = false,
): string | null {
  void _hasPasProducts;
  if (!gate || !isNew) return null;
  if (verificationType !== 'OV') return null;
  if (gate.skipBalanceGate) return null;
  if (ovQuotaQtyCap(gate) <= 0) {
    return ovBalanceExhaustedMessage(gate.balanceQty);
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
 * Master RC skips. PAS / Interweighing-direct do not consume Balance.
 */
export function validateOvQuotaDevices(
  verificationType: string,
  rows: OvQuotaDeviceRow[],
  gate: OvQuotaGate | null | undefined,
): string | null {
  if (!gate || verificationType !== 'OV') return null;
  if (gate.skipBalanceGate) return null;
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
      ? (gate.balanceQty != null && gate.balanceQty < 0
        ? `You don't have quota remaining. Balance is ${gate.balanceQty}. Cannot start more Original Verifications.`
        : OV_BALANCE_ZERO_MORE)
      : `Balance: ${qtyCap} left. You can start ${qtyCap} more Original Verification(s).`;
  }
  return null;
}
