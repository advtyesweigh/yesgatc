import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';
import { useRcSignerProfile } from '../lib/useRcSignerProfile';
import { useRcScope } from '../lib/roleScope';
import {
  UNSIGNED_PDF_DISTURB_THRESHOLD,
  clearUnsignedPdfDisturbShownThisLaunch,
  hasUnsignedPdfDisturbShownThisLaunch,
  markUnsignedPdfDisturbShownThisLaunch,
  useRcUnsignedPdfCount,
} from '../lib/rcUnsignedPdfPending';
import {
  playUnsignedCertificateWarningNow,
  playUnsignedCertificateWarningOnce,
  resetUnsignedCertificateWarningSession,
} from '../lib/playUnsignedCertificateWarningSound';

function usePdfSignerFlag(): boolean {
  const { rcUid } = useRcScope();
  return useRcSignerProfile(rcUid).pdfSigner;
}

function qtyLabelFor(count: number): string {
  if (count <= 0) return '0 certificates';
  return count === 1 ? '1 certificate' : `${count.toLocaleString('en-IN')} certificates`;
}

type PopupProps = {
  count: number;
  disturb: boolean;
  mock?: boolean;
  audience: 'rc' | 'vct';
  /** Shown when opening/downloading a single not-signed certificate. */
  downloadWarn?: boolean;
  pdfSigner?: boolean;
  onClose: () => void;
  onCancel?: () => void;
};

function UnsignedPdfDisturbPopup({
  count,
  disturb,
  mock,
  audience,
  downloadWarn = false,
  pdfSigner = false,
  onClose,
  onCancel,
}: PopupProps) {
  const qtyLabel = qtyLabelFor(count);

  useEffect(() => {
    if (downloadWarn) playUnsignedCertificateWarningNow();
    else playUnsignedCertificateWarningOnce();
  }, [downloadWarn]);

  const title = downloadWarn
    ? 'Not signed — download reminder'
    : disturb
      ? 'Verification may be interrupted'
      : 'Action required: signed PDF pending';

  const body = downloadWarn ? (
    pdfSigner ? (
      <>
        This certificate is marked <strong>Not signed</strong>. EmaapEngine will stamp and
        upload it on eMAAP Issued. Manual DSC upload is off.
      </>
    ) : (
      <>
        This certificate is marked <strong>Not signed</strong>. You may download the unsigned PDF
        now, then sign it with your Class 3 DSC and upload the signed file so it can be issued on
        eMAAP. Leaving certificates unsigned may interrupt or delay new verifications.
      </>
    )
  ) : audience === 'vct' ? (
    pdfSigner ? (
      <>
        Your regional centre has <strong>{qtyLabel}</strong> with{' '}
        <strong>No signed PDF</strong>. RC EmaapEngine stamps and uploads on eMAAP — ask the RC
        admin to keep the engine signed in.
      </>
    ) : (
      <>
        Your regional centre has <strong>{qtyLabel}</strong> with{' '}
        <strong>No signed PDF</strong>. Ask your RC admin to download, DSC-sign, and upload
        these certificates for eMAAP. Clear the backlog to{' '}
        {UNSIGNED_PDF_DISTURB_THRESHOLD} or fewer to stop this reminder on the next app launch.
      </>
    )
  ) : pdfSigner ? (
    <>
      Your centre has <strong>{qtyLabel}</strong> marked <strong>No signed PDF</strong>.
      EmaapEngine will stamp the officer signature and Sign and Upload on eMAAP. Keep the engine
      running — manual file upload is off.
    </>
  ) : (
    <>
      Your centre has <strong>{qtyLabel}</strong> marked <strong>No signed PDF</strong>.
      Download, sign with Class 3 DSC, and upload so eMAAP can issue them. With more than{' '}
      {UNSIGNED_PDF_DISTURB_THRESHOLD} pending, this warning appears once per app launch for you
      and your VCTs until the backlog is cleared.
    </>
  );

  return createPortal(
    <div className="rc-unsigned-cert-popup-overlay" role="presentation">
      <div
        className={`rc-unsigned-cert-popup${disturb || downloadWarn ? ' rc-unsigned-cert-popup--disturb' : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="rc-unsigned-cert-disturb-title"
        onClick={event => event.stopPropagation()}
      >
        <button
          type="button"
          className="rc-unsigned-cert-popup__close"
          onClick={onCancel ?? onClose}
          aria-label="Dismiss"
        >
          <X size={18} />
        </button>
        <span className="rc-unsigned-cert-popup__icon" aria-hidden>
          <AlertTriangle size={28} strokeWidth={2.2} />
        </span>
        <h2 id="rc-unsigned-cert-disturb-title" className="rc-unsigned-cert-popup__title">
          {title}
        </h2>
        {!downloadWarn ? <p className="rc-unsigned-cert-popup__qty">{qtyLabel}</p> : null}
        <p className="rc-unsigned-cert-popup__text">{body}</p>
        {mock ? (
          <p className="rc-unsigned-cert-popup__mock">Mock disturb preview</p>
        ) : null}
        <div className="rc-unsigned-cert-popup__actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {downloadWarn ? 'Continue download' : 'Continue'}
          </button>
          {onCancel ? (
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Popup + sound when downloading / opening a not-signed certificate PDF. */
export function UnsignedCertificateDownloadWarn({
  open,
  onContinue,
  onCancel,
}: {
  open: boolean;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const { isVct, isRcAdmin } = useRcScope();
  const pdfSigner = usePdfSignerFlag();
  if (!open) return null;
  return (
    <UnsignedPdfDisturbPopup
      count={1}
      disturb
      downloadWarn
      pdfSigner={pdfSigner}
      audience={isVct && !isRcAdmin ? 'vct' : 'rc'}
      onClose={onContinue}
      onCancel={onCancel}
    />
  );
}

/** Layout host: once-per-launch popup when unsigned PDF backlog &gt; 10 (RC + VCT). */
export function RcUnsignedPdfDisturbHost() {
  const { rcUid, isRcAdmin, isVct } = useRcScope();
  const pdfSigner = usePdfSignerFlag();
  const [searchParams] = useSearchParams();
  const mock = searchParams.get('mockUnsignedDisturb') === '1';
  const eligible = isRcAdmin || isVct || mock;
  const { count, ready, disturb } = useRcUnsignedPdfCount(eligible ? rcUid : null);
  const [open, setOpen] = useState(false);
  const effectiveCount = mock && count <= UNSIGNED_PDF_DISTURB_THRESHOLD ? 15 : count;
  const effectiveDisturb = mock || disturb;

  useEffect(() => {
    if (!eligible || !ready) return;
    if (!effectiveDisturb) return;
    if (mock) {
      clearUnsignedPdfDisturbShownThisLaunch();
      resetUnsignedCertificateWarningSession();
      setOpen(true);
      return;
    }
    if (hasUnsignedPdfDisturbShownThisLaunch()) return;
    setOpen(true);
  }, [eligible, ready, effectiveDisturb, mock]);

  const close = useCallback(() => {
    if (!mock) markUnsignedPdfDisturbShownThisLaunch();
    setOpen(false);
  }, [mock]);

  if (!open || !eligible) return null;

  return (
    <UnsignedPdfDisturbPopup
      count={effectiveCount}
      disturb={effectiveDisturb}
      mock={mock}
      audience={isVct && !isRcAdmin ? 'vct' : 'rc'}
      pdfSigner={pdfSigner}
      onClose={close}
    />
  );
}

type NewJobGateProps = {
  open: boolean;
  onContinue: () => void;
  onCancel: () => void;
};

/** Blocks new verification once per launch until RC/VCT acknowledges when backlog &gt; 10. */
export function RcUnsignedPdfNewJobGate({ open, onContinue, onCancel }: NewJobGateProps) {
  const { rcUid, isRcAdmin, isVct } = useRcScope();
  const pdfSigner = usePdfSignerFlag();
  const eligible = isRcAdmin || isVct;
  const alreadyShown = hasUnsignedPdfDisturbShownThisLaunch();
  const { count, ready, disturb } = useRcUnsignedPdfCount(
    eligible && open && !alreadyShown ? rcUid : null,
  );

  useEffect(() => {
    if (!open) return;
    if (!eligible || alreadyShown || (ready && !disturb)) {
      onContinue();
    }
  }, [open, eligible, alreadyShown, ready, disturb, onContinue]);

  if (!open || !eligible || alreadyShown || !ready || !disturb) return null;

  return (
    <UnsignedPdfDisturbPopup
      count={count}
      disturb
      audience={isVct && !isRcAdmin ? 'vct' : 'rc'}
      pdfSigner={pdfSigner}
      onClose={() => {
        markUnsignedPdfDisturbShownThisLaunch();
        onContinue();
      }}
      onCancel={onCancel}
    />
  );
}

export { UnsignedPdfDisturbPopup };
