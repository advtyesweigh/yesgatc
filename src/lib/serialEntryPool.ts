import type { Product } from '../types.ts';
import {
  ovSerialChoicesForRow,
  remainingSerialsForProduct,
  type OvQuotaAllotment,
} from './ovQuotaGate.ts';
import { isFactoryGatcSticker, isPasStickerSerial } from './pasSerialBankMatch.ts';

/** Manual type for every product — no allotted-grid / bank membership. */
export type SerialEntryMode = 'manual';

/** Always manual entry (PAS and GAS). */
export function serialEntryMode(_product: Product | null | undefined): SerialEntryMode {
  void _product;
  return 'manual';
}

/** Allotted serial chip grid retired — stamp/OV always type serial. */
export function showsGasAllottedSerialGrid(
  _product: Product | null | undefined,
  _verificationType: string,
): boolean {
  void _product;
  void _verificationType;
  return false;
}

export function productAllotmentKey(
  product: Product | null | undefined,
  fallback?: { productId?: string; productName?: string },
): { productId?: string; productName?: string; sku?: string; modelNo?: string } {
  return {
    productId: product?.id || fallback?.productId,
    productName: product?.name || fallback?.productName,
    sku: product?.yesoneSku,
    modelNo: product?.modelNo,
  };
}

function poolKey(row: Pick<OvQuotaAllotment, 'pool'>): string {
  return String(row.pool || '').trim().toLowerCase();
}

function gasAllotmentRows(allotments: OvQuotaAllotment[] | undefined): OvQuotaAllotment[] | undefined {
  if (!allotments) return allotments;
  return allotments.filter(row => poolKey(row) !== 'pas');
}

function pasPoolSerialKeys(allotments: OvQuotaAllotment[] | undefined): Set<string> {
  const keys = new Set<string>();
  for (const row of allotments || []) {
    if (poolKey(row) !== 'pas') continue;
    const serial = row.serialNumber.trim().toUpperCase();
    if (serial) keys.add(serial);
  }
  return keys;
}

/**
 * Legacy unused-seat list helper (tests / Balance accounting). UI no longer picks from chips.
 */
export function gasAllottedChoices(options: {
  remaining: string[];
  allotments?: OvQuotaAllotment[];
  heldSerials?: string[];
  otherTaken?: string[];
  product?: Product | null;
  fallbackProduct?: { productId?: string; productName?: string };
}): string[] {
  const pasBlocked = pasPoolSerialKeys(options.allotments);
  const actorUnused = options.remaining.filter(serial => {
    const key = serial.trim().toUpperCase();
    if (isPasStickerSerial(key)) return false;
    if (isFactoryGatcSticker(key)) return true;
    return !pasBlocked.has(key);
  });
  const remaining = remainingSerialsForProduct(
    actorUnused,
    gasAllotmentRows(options.allotments),
    productAllotmentKey(options.product, options.fallbackProduct),
  );
  const bank = remaining.length > 0 || actorUnused.length === 0 ? remaining : actorUnused;
  return ovSerialChoicesForRow(
    '',
    bank,
    options.heldSerials ?? [],
    options.otherTaken ?? [],
  );
}

export function filterGasAllottedChoices(choices: readonly string[], query: string): string[] {
  const needle = query.trim().toUpperCase().replace(/\s+/g, '');
  if (!needle) return [...choices];
  return choices.filter(serial => serial.trim().toUpperCase().replace(/\s+/g, '').includes(needle));
}

export function serialInChoiceList(serial: string, choices: readonly string[]): boolean {
  const key = serial.trim().toUpperCase();
  if (!key) return false;
  return choices.some(item => item.trim().toUpperCase() === key);
}

export function gasAllottedEmptyLabel(_scopedToVerifier: boolean): string {
  void _scopedToVerifier;
  return 'Type the serial from the plate';
}

export function gasAllottedEmptyProductHint(_scopedToVerifier: boolean): string {
  void _scopedToVerifier;
  return 'Type the serial from the plate.';
}

/** Serial required only — no bank / allotted-list membership. */
export function validateSerialForProductPool(options: {
  mode: SerialEntryMode | 'gas-select' | 'pas-type';
  verificationType: string;
  serial: string;
  gasChoices: readonly string[];
  scopedToVerifier?: boolean;
  serialSource?: string;
}): string | null {
  void options.mode;
  void options.verificationType;
  void options.gasChoices;
  void options.scopedToVerifier;
  void options.serialSource;
  const serial = options.serial.trim();
  if (!serial) return 'Serial number is required.';
  return null;
}

/** OCR may fill any typed serial — no allotted-list gate. */
export function applyOcrSerialToPool(options: {
  mode: SerialEntryMode | 'gas-select' | 'pas-type';
  ocrSerial: string;
  allottedMatch: string | null;
  gasChoices: readonly string[];
}): string | null {
  void options.mode;
  void options.gasChoices;
  const typed = (options.allottedMatch || options.ocrSerial).trim();
  return typed || null;
}
