import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw } from 'lucide-react';
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { callableErrorMessage } from '../../lib/zohoRvInvoice';
import { syncYesoneOvUsed } from '../../lib/yesoneWebhookClient';
import { useAuth } from '../../context/AuthContext';
import {
  computeRcQuotaSeats,
  isMasterPoolSerial,
  isMasterRc,
  masterRcPoolSerials,
  MZN_G_REALLOC_MOVES,
  applySerialReallotment,
  serialReallotmentPending,
  rehomeMasterPoolSerials,
  toggleVoidedSerial,
} from '../../lib/rcMasterQuota';
import {
  parseQuotaInput,
  uniqueSerials,
  yesoneSerialFromDoc,
  type YesoneSerialAllotment,
} from '../../lib/yesoneInboundData';
import { pasProductIdSet } from '../../lib/pasSerialBank';
import { usePasBlockedSerials } from '../../hooks/usePasBlockedSerials';
import { useAppContext } from '../../context/AppContext';
import type { SiteCalibration } from '../../types';
import { SerialSeatOverlay } from '../../components/SerialSeatOverlay';

type QuotaRow = {
  uid: string;
  companyName: string;
  rcCode: string;
  ovQuota: string;
  ovQuotaUsed: string;
  storedSerials: string[];
  voidedSerials: string[];
};

function displayQty(value: number | null): string {
  return value == null ? '—' : String(value);
}

function sortQuotaRows(a: QuotaRow, b: QuotaRow): number {
  const aMaster = isMasterRc(a);
  const bMaster = isMasterRc(b);
  if (aMaster !== bMaster) return aMaster ? -1 : 1;
  if (aMaster) return 0;
  const soldA = parseQuotaInput(a.ovQuota) ?? -1;
  const soldB = parseQuotaInput(b.ovQuota) ?? -1;
  if (soldA !== soldB) return soldB - soldA;
  return a.companyName.localeCompare(b.companyName);
}

export function RcQuotaSynButton() {
  const [syncing, setSyncing] = useState(false);
  const [title, setTitle] = useState('Push OV used to Yesone');
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    setSlot(
      document.getElementById('settings-syn-slot-mobile')
      || document.getElementById('settings-syn-slot-desktop'),
    );
  }, []);

  const handleSyn = async () => {
    setSyncing(true);
    try {
      const log = await syncYesoneOvUsed();
      setTitle(
        log.ok
          ? `Pushed ${log.rcSent}/${log.rcTotal} RC`
          : log.errors[0]?.error || `Failed for ${log.rcFailed} RC.`,
      );
    } catch (err: unknown) {
      setTitle(callableErrorMessage(err) || 'Push failed.');
    } finally {
      setSyncing(false);
    }
  };

  if (!slot) return null;

  return createPortal(
    <button
      type="button"
      className="btn btn-primary admin-setting-quota-syn"
      onClick={() => void handleSyn()}
      disabled={syncing}
      aria-label="Push OV used to Yesone"
      title={title}
    >
      <RefreshCw
        size={18}
        strokeWidth={2.5}
        color="#ffffff"
        aria-hidden
        className={syncing ? 'admin-setting-quota-syn-icon--spin' : undefined}
      />
    </button>,
    slot,
  );
}

export function RcQuotaPanel() {
  const { user } = useAuth();
  const { products } = useAppContext();
  const [quotas, setQuotas] = useState<QuotaRow[]>([]);
  const [serialsByRc, setSerialsByRc] = useState<Map<string, string[]>>(new Map());
  const [allotUsedByRc, setAllotUsedByRc] = useState<Map<string, string[]>>(new Map());
  const [allotmentRows, setAllotmentRows] = useState<YesoneSerialAllotment[]>([]);
  const [recordsByRc, setRecordsByRc] = useState<Map<string, SiteCalibration[]>>(new Map());
  const [error, setError] = useState('');
  const [openUid, setOpenUid] = useState('');

  const masterUid = useMemo(
    () => quotas.find(row => isMasterRc(row))?.uid || '',
    [quotas],
  );
  const reallocBusy = useRef(false);
  const rehomeBusy = useRef(false);

  useEffect(() => {
    if (user?.role !== 'super_admin' || reallocBusy.current || quotas.length === 0) return;
    const rows = quotas.map(row => {
      const code = row.rcCode.toUpperCase();
      return {
        uid: row.uid,
        rcCode: row.rcCode,
        companyName: row.companyName,
        storedSerials: uniqueSerials([
          ...row.storedSerials,
          ...(serialsByRc.get(row.uid) || []),
          ...(code ? serialsByRc.get(code) || [] : []),
        ]),
      };
    });
    if (!serialReallotmentPending(rows, MZN_G_REALLOC_MOVES)) return;
    reallocBusy.current = true;
    void applySerialReallotment(rows, MZN_G_REALLOC_MOVES).finally(() => {
      reallocBusy.current = false;
    });
  }, [quotas, serialsByRc, user?.role]);

  useEffect(() => {
    if (user?.role !== 'super_admin' || rehomeBusy.current || !masterUid || quotas.length === 0) return;
    const rows = quotas.map(row => {
      const code = row.rcCode.toUpperCase();
      return {
        uid: row.uid,
        rcCode: row.rcCode,
        ovQuota: row.ovQuota,
        storedSerials: uniqueSerials([
          ...row.storedSerials,
          ...(serialsByRc.get(row.uid) || []),
          ...(code ? serialsByRc.get(code) || [] : []),
        ]),
      };
    });
    const master = rows.find(row => row.uid === masterUid);
    const pool = masterRcPoolSerials();
    const held = new Set(
      (master?.storedSerials || []).filter(isMasterPoolSerial).map(serial => serial.toUpperCase()),
    );
    const iwpMissing = pool.some(serial => !held.has(serial.toUpperCase()));
    const hasStolen = rows.some(
      row => row.uid !== masterUid && row.storedSerials.some(isMasterPoolSerial),
    );
    if (!hasStolen && !iwpMissing) return;
    rehomeBusy.current = true;
    void rehomeMasterPoolSerials(masterUid, rows).finally(() => {
      rehomeBusy.current = false;
    });
  }, [masterUid, quotas, serialsByRc, user?.role]);

  useEffect(() => {
    const unsubRcs = onSnapshot(
      query(collection(db, 'users'), where('role', '==', 'rc_admin')),
      snap => {
        setQuotas(
          snap.docs
            .map(item => {
              const data = item.data();
              return {
                uid: item.id,
                companyName: String(data.companyName || data.username || 'RC').trim(),
                rcCode: String(data.rcCode || '').trim(),
                ovQuota: data.ovQuota == null || data.ovQuota === '' ? '' : String(data.ovQuota),
                ovQuotaUsed: data.ovQuotaUsed == null || data.ovQuotaUsed === '' ? '' : String(data.ovQuotaUsed),
                storedSerials: uniqueSerials(data.yesoneAllottedSerials),
                voidedSerials: uniqueSerials(data.yesoneVoidedSerials),
              } satisfies QuotaRow;
            })
            .sort(sortQuotaRows),
        );
      },
      () => setError('Could not load RC quota.'),
    );

    const unsubAllot = onSnapshot(
      collection(db, 'serialAllotments'),
      snap => {
        const byKey = new Map<string, string[]>();
        const usedByKey = new Map<string, string[]>();
        const active: YesoneSerialAllotment[] = [];
        for (const item of snap.docs) {
          const row = yesoneSerialFromDoc(item.id, item.data());
          if (row.status === 'cancelled' || row.status === 'replaced') continue;
          active.push(row);
          const keys = [row.rcId, row.rcCode.toUpperCase()].filter(Boolean);
          const used = row.status.trim().toLowerCase() === 'used';
          for (const key of keys) {
            if (used) {
              const list = usedByKey.get(key) || [];
              list.push(row.serialNumber);
              usedByKey.set(key, list);
              continue;
            }
            const list = byKey.get(key) || [];
            list.push(row.serialNumber);
            byKey.set(key, list);
          }
        }
        setAllotmentRows(active);
        setSerialsByRc(byKey);
        setAllotUsedByRc(usedByKey);
      },
      () => {
        setAllotmentRows([]);
        setSerialsByRc(new Map());
        setAllotUsedByRc(new Map());
      },
    );

    return () => {
      unsubRcs();
      unsubAllot();
    };
  }, []);

  // Live GAS OV counts for every RC so Used/Balance match RC home (Allotted−Used).
  // One-shot getDocs per RC — not N live listeners.
  useEffect(() => {
    if (quotas.length === 0) return;
    let cancelled = false;
    const uids = quotas.map(row => row.uid);
    void Promise.all(
      uids.map(uid =>
        getDocs(query(collection(db, 'siteCalibrations'), where('rcId', '==', uid)))
          .then(snap => [
            uid,
            snap.docs.map(item => ({ id: item.id, ...item.data() }) as SiteCalibration),
          ] as const)
          .catch(() => [uid, [] as SiteCalibration[]] as const),
      ),
    ).then(entries => {
      if (cancelled) return;
      setRecordsByRc(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [quotas]);

  const pasSerials = usePasBlockedSerials(allotmentRows, products);
  const pasProductIds = useMemo(() => pasProductIdSet(products), [products]);

  const rows = useMemo(() => {
    return quotas.map(row => {
      const code = row.rcCode.toUpperCase();
      const allotSerials = uniqueSerials([
        ...(serialsByRc.get(row.uid) || []),
        ...(code ? serialsByRc.get(code) || [] : []),
      ]);
      const allotmentUsedSerials = uniqueSerials([
        ...(allotUsedByRc.get(row.uid) || []),
        ...(code ? allotUsedByRc.get(code) || [] : []),
      ]);
      const rcRecords = recordsByRc.get(row.uid);
      const seats = computeRcQuotaSeats({
        rcCode: row.rcCode,
        companyName: row.companyName,
        ovQuota: row.ovQuota,
        ovQuotaUsed: row.ovQuotaUsed,
        // Live OVs loaded for all rows — same Used path as RC home.
        recordsAreRcWide: rcRecords != null,
        storedSerials: row.storedSerials,
        allotSerials,
        voidedSerials: row.voidedSerials,
        records: rcRecords || [],
        pasProductIds,
        pasSerials,
        allotmentUsedSerials,
      });
      return {
        ...row,
        allottedQty: seats.allottedQty,
        usedQty: seats.usedQty,
        balanceQty: seats.balanceQty,
        serials: seats.remaining,
        pasSerials: seats.pasRemaining,
      };
    });
  }, [allotUsedByRc, pasProductIds, pasSerials, quotas, recordsByRc, serialsByRc]);

  const openRow = useMemo(
    () => rows.find(row => row.uid === openUid) ?? null,
    [rows, openUid],
  );

  return (
    <div className="panel glass panel--table admin-setting-quota-panel" aria-label="RC quota">
      {error ? <div className="login-error">{error}</div> : null}
      {rows.length > 0 ? (
        <div className="admin-setting-yesone-table-wrap">
          <table className="admin-setting-yesone-table admin-setting-quota-table">
            <thead>
              <tr>
                <th>RC</th>
                <th>Allotted</th>
                <th>Used</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const canOpen =
                  row.serials.length > 0
                  || row.voidedSerials.length > 0
                  || (row.allottedQty != null && row.allottedQty > 0);
                return (
                  <tr key={row.uid}>
                    <td>
                      <span className="admin-setting-quota-name">{row.companyName}</span>
                      {row.rcCode ? <span className="admin-setting-yesone-sub">{row.rcCode}</span> : null}
                    </td>
                    <td>
                      <span className="text-mono admin-setting-quota-balance">
                        {displayQty(row.allottedQty)}
                      </span>
                    </td>
                    <td>
                      <span className="text-mono admin-setting-quota-balance">
                        {displayQty(row.usedQty)}
                      </span>
                    </td>
                    <td>
                      {canOpen ? (
                        <button
                          type="button"
                          className="admin-setting-quota-balance-btn"
                          onClick={() => setOpenUid(row.uid)}
                          aria-label={`Serial numbers for ${row.companyName}`}
                        >
                          {displayQty(row.balanceQty)}
                        </button>
                      ) : (
                        <span className="text-mono admin-setting-quota-balance">
                          {displayQty(row.balanceQty)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {openRow ? (
        <SerialSeatOverlay
          companyName={openRow.companyName}
          rcCode={openRow.rcCode}
          serials={uniqueSerials([...openRow.serials, ...openRow.voidedSerials])}
          voidedSerials={openRow.voidedSerials}
          pasSerials={openRow.pasSerials}
          expectedCount={openRow.balanceQty}
          canVoid
          onToggleVoid={(serial, voided) => toggleVoidedSerial(openRow.uid, serial, voided)}
          onClose={() => setOpenUid('')}
        />
      ) : null}
    </div>
  );
}
