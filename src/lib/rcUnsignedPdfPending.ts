import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { tallySignedPdfFilters } from './signedCertificatePdf';
import type { SiteCalibration } from '../types';

/** Above this, RC + VCT get a once-per-launch disturb popup. */
export const UNSIGNED_PDF_DISTURB_THRESHOLD = 10;

const DISTURB_SESSION_KEY = 'yesgatc-unsigned-pdf-disturb-shown';

const countCache = new Map<string, number>();

export function hasUnsignedPdfDisturbShownThisLaunch(): boolean {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem(DISTURB_SESSION_KEY) === '1';
}

export function markUnsignedPdfDisturbShownThisLaunch(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(DISTURB_SESSION_KEY, '1');
}

export function clearUnsignedPdfDisturbShownThisLaunch(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(DISTURB_SESSION_KEY);
}

export function invalidateRcUnsignedPdfCount(rcUid?: string): void {
  if (rcUid) countCache.delete(rcUid);
  else countCache.clear();
}

export async function fetchRcUnsignedPdfCount(rcUid: string): Promise<number> {
  const snap = await getDocs(
    query(collection(db, 'siteCalibrations'), where('rcId', '==', rcUid)),
  );
  const records = snap.docs.map(
    item => ({ id: item.id, ...item.data() }) as SiteCalibration,
  );
  const count = tallySignedPdfFilters(records).notSigned;
  countCache.set(rcUid, count);
  return count;
}

/** Pending No signed PDF count for an RC centre. Cached by rcUid; reloadKey refreshes in background. */
export function useRcUnsignedPdfCount(
  rcUid: string | null | undefined,
  reloadKey?: string | number,
): { count: number; ready: boolean; disturb: boolean } {
  const cached = rcUid ? countCache.get(rcUid) : undefined;
  const [count, setCount] = useState(cached ?? 0);
  const [ready, setReady] = useState(cached !== undefined || !rcUid);

  useEffect(() => {
    if (!rcUid) {
      setCount(0);
      setReady(true);
      return;
    }
    let cancelled = false;
    const hit = countCache.get(rcUid);
    if (hit !== undefined) {
      setCount(hit);
      setReady(true);
    } else {
      setReady(false);
    }
    void fetchRcUnsignedPdfCount(rcUid)
      .then(next => {
        if (cancelled) return;
        setCount(next);
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setCount(0);
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [rcUid, reloadKey]);

  return {
    count,
    ready,
    disturb: count > UNSIGNED_PDF_DISTURB_THRESHOLD,
  };
}
