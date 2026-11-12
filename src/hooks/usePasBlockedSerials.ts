import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import {
  PAS_SERIAL_BANK_META_COLLECTION,
  mergePasBlockedSerials,
  pasSerialsFromAllotments,
  pasSerialsFromMetaRanges,
  type PasAllotmentIdentity,
} from '../lib/pasSerialBank';
import type { Product } from '../types';

/** PAS bank seats RC/VCT must not see on GAS remaining sticker boards. */
export function usePasBlockedSerials(
  allotmentRows: readonly PasAllotmentIdentity[],
  products: readonly Product[] | undefined,
): string[] {
  const [metaSerials, setMetaSerials] = useState<string[]>([]);

  useEffect(() => {
    return onSnapshot(
      collection(db, PAS_SERIAL_BANK_META_COLLECTION),
      snap => {
        setMetaSerials(
          pasSerialsFromMetaRanges(
            snap.docs.map(item => {
              const data = item.data() as { from?: string; to?: string };
              return { from: data.from, to: data.to };
            }),
          ),
        );
      },
      () => setMetaSerials([]),
    );
  }, []);

  return useMemo(() => {
    const blocked = mergePasBlockedSerials(
      pasSerialsFromAllotments(allotmentRows, products),
      metaSerials,
    );
    // Settings-added GAS seats (any format) must stay stampable even if YJ overlaps PAS meta.
    const gasSeats = new Set(
      allotmentRows
        .filter(row => String(row.pool || '').trim().toLowerCase() === 'gas')
        .map(row => row.serialNumber.trim().toUpperCase())
        .filter(Boolean),
    );
    if (gasSeats.size === 0) return blocked;
    return blocked.filter(serial => !gasSeats.has(serial.trim().toUpperCase()));
  }, [allotmentRows, metaSerials, products]);
}
