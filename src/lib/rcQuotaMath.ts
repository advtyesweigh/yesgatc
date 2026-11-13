import {
  isFactoryGatcSticker,
  isGasStickerSerial,
  isPasStickerSerial,
} from './pasSerialBankMatch.ts';

/** GAS RC quota qty. PAS seats never consume or inflate these numbers. */

/**
 * Used = verified GAS OV count.
 * RC-wide records → live count only (ignore stale YesOne ovQuotaUsed).
 * Incomplete scope (VCT own-only) → max(live, stored) floor — never bank clamp.
 */
export function resolveRcQuotaUsedQty(input: {
  recordUsedCount: number;
  storedUsed: number | null;
  recordsAreRcWide: boolean;
}): number {
  const recordUsed = Math.max(0, input.recordUsedCount);
  if (input.storedUsed == null) return recordUsed;
  if (input.recordsAreRcWide) return recordUsed;
  return Math.max(recordUsed, input.storedUsed);
}

export function recordUsesPasQuota(
  productId: string | undefined | null,
  pasProductIds: Iterable<string> | undefined,
): boolean {
  const id = String(productId || '').trim();
  if (!id || !pasProductIds) return false;
  const set =
    pasProductIds instanceof Set
      ? pasProductIds
      : new Set([...pasProductIds].map(item => String(item).trim()).filter(Boolean));
  return set.has(id);
}

export function excludePasQuotaSerials(
  serials: string[],
  pasSerials: Iterable<string> | undefined,
): string[] {
  const blocked = new Set(
    [...(pasSerials || [])].map(serial => serial.trim().toUpperCase()).filter(Boolean),
  );
  return serials.filter(serial => {
    const key = serial.trim().toUpperCase();
    if (!key) return false;
    // G/X + factory always keep (never strip because a PAS range exists).
    if (isGasStickerSerial(key) || isFactoryGatcSticker(key)) return true;
    // YJ/AS/VJ never belong on GAS remaining / OV chip grids.
    if (isPasStickerSerial(key)) return false;
    // Other formats: drop only explicit PAS block list.
    return !blocked.has(key);
  });
}

/** Stickers `excludePasQuotaSerials` drops. GAS X/G and factory GATC stay out. */
export function pasStickersAmong(
  serials: readonly string[],
  pasSerials: Iterable<string> | undefined,
): string[] {
  const kept = new Set(
    excludePasQuotaSerials([...serials], pasSerials).map(serial => serial.trim().toUpperCase()),
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const serial of serials) {
    const key = serial.trim().toUpperCase();
    if (!key || kept.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(serial.trim());
  }
  return out;
}

/** Reserved chips currently shown on the RC serial overlay (not leftovers off-list). */
export function countReservedOverlaySeats(
  serials: readonly string[],
  reservedSerials: readonly string[],
  voidedSerials: readonly string[] = [],
): number {
  const voided = new Set(
    voidedSerials.map(serial => serial.trim().toUpperCase()).filter(Boolean),
  );
  const reserved = new Set(
    reservedSerials.map(serial => serial.trim().toUpperCase()).filter(Boolean),
  );
  return serials.filter(serial => {
    const key = serial.trim().toUpperCase();
    if (!key || voided.has(key)) return false;
    return reserved.has(key);
  }).length;
}

/**
 * RC Balance overlay list: unreserved unused only, capped to quota to-do.
 * Never pad with reserved/amber. Hero balanceQty may exceed list length.
 */
export function pickQuotaToDoSerials(
  remaining: readonly string[],
  reservedSerials: readonly string[],
  balanceQty: number | null,
): string[] {
  const reserved = new Set(
    reservedSerials.map(serial => serial.trim().toUpperCase()).filter(Boolean),
  );
  const free: string[] = [];
  for (const serial of remaining) {
    const key = serial.trim().toUpperCase();
    if (!key || reserved.has(key)) continue;
    free.push(serial);
  }
  if (balanceQty == null || balanceQty < 0) return free;
  return free.slice(0, balanceQty);
}

export type QuotaSerialActorSeats = {
  remaining: string[];
  vctRemaining: string[];
  reservedSerials: string[];
  reservedForUids: string[];
  reservedByUid: Record<string, string[]>;
};

function serialKey(serial: string): string {
  return serial.trim().toUpperCase();
}

/** Unused GAS bank: parent remaining + unused reserved (Vr Allotted green). */
function unusedGasBank(seats: QuotaSerialActorSeats): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const serial of [...seats.remaining, ...seats.reservedSerials]) {
    const key = serialKey(serial);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(serial.trim());
  }
  return out;
}

/**
 * Unused seats explicitly allotted to this verifier uid.
 * Intersection with unused bank — never invent, never dump unreserved RC remaining.
 */
function unusedAllottedToUid(seats: QuotaSerialActorSeats, uid: string): string[] {
  if (!uid) return [];
  const mine = new Set<string>();
  for (const serial of seats.reservedByUid[uid] || []) {
    const key = serialKey(serial);
    if (key) mine.add(key);
  }
  if (mine.size === 0) return [];
  return unusedGasBank(seats).filter(serial => mine.has(serialKey(serial)));
}

/**
 * Job-start Balance shown on New Verification Job.
 * RC and VCT: Allotted − Used. Empty GAS sticker list must not zero it
 * (Meezan PAS bank is not in vctRemaining).
 * Verifier: unused seats reserved to that uid.
 */
export function actorJobBalanceQty(input: {
  isVerifier?: boolean;
  balanceQty: number | null;
  verifierSeatCount: number;
}): number | null {
  if (input.isVerifier) return input.verifierSeatCount;
  return input.balanceQty;
}

/**
 * OV GAS stickers for a job. Product/SKU is not applied here — GAS unused is one bank.
 * RC: full unused pool (incl. reserved).
 * VCT: parent unused minus reserved (RC-admin-only + verifier-allotted stay hidden).
 * Verifier: unused seats reserved to actorUid only. Empty reserved → empty list.
 * Never leftover remaining that was never on this uid (e.g. X00423).
 */
export function pickQuotaSerialsForActor(
  seats: QuotaSerialActorSeats,
  actor: {
    isRcAdmin?: boolean;
    isVerifier?: boolean;
    isVct?: boolean;
    actorUid?: string | null;
    /** Factory stamping staff under Master RC share the warehouse unused pool. */
    isMasterRc?: boolean;
  },
): string[] {
  if (actor.isRcAdmin) return seats.remaining;
  if (actor.isVerifier && actor.isMasterRc) return seats.remaining;
  if (actor.isVct && actor.isMasterRc) return seats.remaining;
  if (actor.isVct) return seats.vctRemaining;
  const uid = String(actor.actorUid || '').trim();
  const mine = uid ? unusedAllottedToUid(seats, uid) : [];
  if (actor.isVerifier) return mine;
  if (!uid) return seats.remaining;
  if (mine.length > 0) return mine;
  if (seats.reservedForUids.includes(uid)) {
    return seats.reservedSerials.length > 0 ? seats.reservedSerials : seats.remaining;
  }
  return seats.remaining;
}
