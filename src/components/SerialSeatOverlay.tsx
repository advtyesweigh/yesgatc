import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { countReservedOverlaySeats } from '../lib/rcQuotaMath';

type SerialSeatOverlayProps = {
  companyName: string;
  rcCode: string;
  serials: string[];
  voidedSerials: string[];
  reservedSerials?: string[];
  expectedCount: number | null;
  canVoid: boolean;
  onToggleVoid?: (serial: string, voided: boolean) => Promise<void>;
  /** RC admin: mark sticker reserved (hidden from VCT). */
  canReserve?: boolean;
  onToggleReserve?: (serial: string, reserved: boolean) => Promise<void>;
  /** Unused PAS stickers. Hidden until the PAS switch is on. Not part of the GAS count. */
  pasSerials?: string[];
  onClose: () => void;
};

export function SerialSeatOverlay({
  companyName,
  rcCode,
  serials,
  voidedSerials,
  reservedSerials = [],
  expectedCount,
  canVoid,
  onToggleVoid,
  canReserve = false,
  onToggleReserve,
  pasSerials = [],
  onClose,
}: SerialSeatOverlayProps) {
  const [showPas, setShowPas] = useState(false);
  const [query, setQuery] = useState('');
  const voidedKeys = new Set(voidedSerials.map(serial => serial.toLowerCase()));
  const reservedKeys = new Set(reservedSerials.map(serial => serial.toLowerCase()));
  const gasKeys = new Set(serials.map(serial => serial.toLowerCase()));
  const pasOnly = pasSerials.filter(serial => !gasKeys.has(serial.toLowerCase()));
  const pasKeys = new Set(pasOnly.map(serial => serial.toLowerCase()));
  const visible = showPas ? [...serials, ...pasOnly] : serials;
  const needle = query.trim().toUpperCase().replace(/[\s\-_.]/g, '');
  const shown = needle
    ? visible.filter(serial => serial.toUpperCase().replace(/[\s\-_.]/g, '').includes(needle))
    : visible;
  // GAS seats only. PAS must not move the balance mismatch.
  const seatCount = serials.filter(serial => !voidedKeys.has(serial.toLowerCase())).length;
  const reservedCount = countReservedOverlaySeats(serials, reservedSerials, voidedSerials);
  const balanceCount = expectedCount == null ? null : Math.max(0, expectedCount);
  const mismatch = balanceCount != null && balanceCount !== seatCount;
  const showReservedCount = canReserve || reservedCount > 0;
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (query.trim()) {
        setQuery('');
        return;
      }
      onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, query]);

  const handleVoid = async (serial: string, nextVoided: boolean) => {
    if (!canVoid || !onToggleVoid || busy) return;
    setError('');
    setBusy(serial);
    try {
      await onToggleVoid(serial, nextVoided);
    } catch {
      setError('Could not void serial.');
    } finally {
      setBusy('');
    }
  };

  const handleReserve = async (serial: string, nextReserved: boolean) => {
    if (!canReserve || !onToggleReserve || busy) return;
    setError('');
    setBusy(serial);
    try {
      await onToggleReserve(serial, nextReserved);
    } catch {
      setError('Could not reserve serial.');
    } finally {
      setBusy('');
    }
  };

  return createPortal(
    <div
      className="admin-setting-serial-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="serial-total-title"
    >
      <header className="admin-setting-serial-stage-head">
        <h2 id="serial-total-title" className="admin-setting-serial-stage-title">
          {companyName}
          {rcCode ? <span>{rcCode}</span> : null}
          <span
            className={`admin-setting-serial-count-num${mismatch ? ' admin-setting-qty--bad' : ''}`}
            title={
              mismatch && balanceCount != null
                ? `Mismatch: balance ${balanceCount}, seats ${seatCount}`
                : undefined
            }
          >
            {seatCount}
            {mismatch && balanceCount != null ? (
              <span className="admin-setting-serial-count-mismatch"> ≠{balanceCount}</span>
            ) : null}
          </span>
          {showReservedCount ? (
            <span
              className="admin-setting-serial-count-num admin-setting-serial-count-num--reserved"
              title="Reserved for RC admin (hidden from VCT)"
            >
              <span>reserved</span>
              {reservedCount}
            </span>
          ) : null}
        </h2>
        <label className="admin-setting-serial-pas-switch">
          <input
            type="checkbox"
            role="switch"
            checked={showPas}
            onChange={event => setShowPas(event.target.checked)}
            aria-label="Show PAS"
          />
          <span className="admin-setting-serial-pas-switch-track" aria-hidden />
          <span>PAS</span>
          <span className="admin-setting-serial-count-num">{pasOnly.length}</span>
        </label>
        <button
          type="button"
          className="rv-payment-panel-close"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </header>
      <label className="admin-setting-serial-search">
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search serial"
          aria-label="Search serial"
          autoFocus
        />
      </label>
      {canReserve ? (
        <p className="text-muted text-sm admin-setting-serial-hint">
          Tap a serial to reserve for RC admin (hidden from VCT). Reserved stickers show amber.
        </p>
      ) : null}
      {error ? <p className="login-error">{error}</p> : null}
      {shown.length === 0 ? (
        <p className="text-muted text-sm">
          {visible.length === 0 ? 'No serial numbers.' : `No serial matches ${query.trim()}.`}
        </p>
      ) : (
        <ul className="admin-setting-serial-seats">
          {shown.map(serial => {
            const pas = pasKeys.has(serial.toLowerCase());
            const voided = voidedKeys.has(serial.toLowerCase());
            const reserved = reservedKeys.has(serial.toLowerCase());
            const className = [
              'admin-setting-serial-seat',
              'text-mono',
              pas ? 'admin-setting-serial-seat--pas' : '',
              voided ? 'admin-setting-serial-seat--voided' : '',
              reserved && !voided ? 'admin-setting-serial-seat--reserved' : '',
            ]
              .filter(Boolean)
              .join(' ');
            if (pas) {
              return (
                <li key={serial} className={className}>
                  {serial}
                </li>
              );
            }
            if (canVoid && onToggleVoid) {
              return (
                <li key={serial}>
                  <button
                    type="button"
                    className={className}
                    aria-pressed={voided}
                    aria-label={voided ? `Restore ${serial}` : `Void ${serial}`}
                    disabled={Boolean(busy)}
                    onClick={() => void handleVoid(serial, !voided)}
                  >
                    {serial}
                  </button>
                </li>
              );
            }
            if (canReserve && onToggleReserve && !voided) {
              return (
                <li key={serial}>
                  <button
                    type="button"
                    className={className}
                    aria-pressed={reserved}
                    aria-label={
                      reserved ? `Unreserve ${serial} for VCT` : `Reserve ${serial} for RC admin`
                    }
                    disabled={Boolean(busy)}
                    onClick={() => void handleReserve(serial, !reserved)}
                  >
                    {serial}
                  </button>
                </li>
              );
            }
            return (
              <li key={serial} className={className}>
                {serial}
              </li>
            );
          })}
        </ul>
      )}
    </div>,
    document.body,
  );
}
