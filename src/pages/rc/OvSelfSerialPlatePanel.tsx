import { useEffect, useMemo, useRef, useState } from 'react';
import { ManufacturingYearPicker } from '../../components/ManufacturingYearPicker';
import {
  VerificationPhotoUploadSection,
  VerificationPhotoUploadSlot,
  type GeoStampCoordinates,
  type StampWeather,
} from '../../components/VerificationPhotoUploadSlot';
import { type OvQuotaAllotment } from '../../lib/ovQuotaGate';
import { productUsesPasSerials } from '../../lib/pasSerialBank';
import { formatShopCapacityLine, getProductSpecifications, resolveProductSpecification } from '../../lib/productSpecifications';
import { readSerialPlate } from '../../lib/readSerialPlate';
import { applyOcrSerialToPool } from '../../lib/serialEntryPool';
import { AvailableSerialList } from '../../components/AvailableSerialList';
import {
  SERIAL_PLATE_IMAGE_KIND,
  VERIFICATION_IMAGE_CONFIG,
  emptyDeviceImageSlot,
  type DeviceVerificationImagesState,
} from '../../lib/verificationDeviceImages';
import type { VerificationDeviceRowValues } from '../../lib/siteCalibrationProfileFields';
import type { JobType, Product } from '../../types';

export function OvSelfSerialPlatePanel({
  row,
  product,
  images,
  verificationType,
  allottedSerials: _allottedSerials,
  allotments: _allotments,
  heldSerials: _heldSerials = [],
  scopedToVerifier: _scopedToVerifier = false,
  allowInterweighingDirect: _allowInterweighingDirect = false,
  directRemaining: _directRemaining = [],
  availableSerials,
  disabled,
  geoStampCoords,
  geoStampWeather,
  geoStampAllowLiveGps,
  onSerialChange,
  onYearChange,
  onPlateSelect,
  onPlateRemove,
}: {
  row: VerificationDeviceRowValues;
  product: Product | null;
  images: DeviceVerificationImagesState;
  verificationType: JobType | '';
  allottedSerials: string[];
  allotments?: OvQuotaAllotment[];
  heldSerials?: string[];
  scopedToVerifier?: boolean;
  allowInterweighingDirect?: boolean;
  directRemaining?: string[];
  availableSerials?: readonly string[];
  disabled?: boolean;
  geoStampCoords?: GeoStampCoordinates | null;
  geoStampWeather?: StampWeather | null;
  geoStampAllowLiveGps?: boolean;
  onSerialChange: (serial: string, source?: 'rcYesone' | 'interweighingDirect') => void;
  onYearChange?: (year: string) => void;
  onPlateSelect: (file: File) => void;
  onPlateRemove: () => void;
}) {
  void _allottedSerials;
  void _allotments;
  void _heldSerials;
  void _scopedToVerifier;
  void _allowInterweighingDirect;
  void _directRemaining;

  const slot = images[SERIAL_PLATE_IMAGE_KIND] ?? emptyDeviceImageSlot();
  const hasPlate = Boolean(slot.pendingFile || (slot.file && !slot.removed));
  const serialInputRef = useRef<HTMLInputElement>(null);
  const isRv = verificationType === 'RV';
  const isPas = productUsesPasSerials(product);
  const [ocrHint, setOcrHint] = useState<string | null>(null);

  const selectedSpecLabel = useMemo(() => {
    if (!product) return '';
    const spec = row.productSpecificationId
      ? getProductSpecifications(product).find(s => s.id === row.productSpecificationId)
      : resolveProductSpecification(product);
    return spec ? formatShopCapacityLine(spec, product.unitOfMeasurement || 'kg') : '';
  }, [product, row.productSpecificationId]);

  useEffect(() => {
    if (disabled) return;
    serialInputRef.current?.focus();
  }, [disabled]);

  const handlePlateSelect = (file: File) => {
    onPlateSelect(file);
    setOcrHint('Reading plate…');
    void readSerialPlate(file, [])
      .then(read => {
        const filled = applyOcrSerialToPool({
          mode: 'manual',
          ocrSerial: read.serialNumber,
          allottedMatch: read.allottedMatch,
          gasChoices: [],
        });
        if (filled && !row.serialNumber.trim()) {
          onSerialChange(filled, 'rcYesone');
          setOcrHint('Filled serial from plate photo (you can edit).');
          return;
        }
        setOcrHint('Plate photo saved. Type the serial if it is not filled.');
      })
      .catch(() => {
        setOcrHint(null);
      });
  };

  return (
    <div className="ov-self-serial-plate">
      <div className="ov-self-photos-recap">
        <span>
          <strong>{row.productName.trim() || product?.name || 'Product'}</strong>
          {selectedSpecLabel ? ` · ${selectedSpecLabel}` : ''}
          {isPas ? ' · PAS' : ' · GAS'}
        </span>
        <span className="text-muted text-sm">
          Type the serial. Plate photo still required to continue.
        </span>
      </div>

      <VerificationPhotoUploadSection title="Serial number plate">
        <VerificationPhotoUploadSlot
          slotKey={SERIAL_PLATE_IMAGE_KIND}
          label={VERIFICATION_IMAGE_CONFIG[SERIAL_PLATE_IMAGE_KIND].label}
          required
          file={slot.file}
          uploading={slot.uploading}
          progress={slot.progress}
          disabled={disabled}
          geoStamp
          geoStampCoords={geoStampCoords}
          geoStampWeather={geoStampWeather}
          geoStampAllowLiveGps={geoStampAllowLiveGps}
          onSelect={handlePlateSelect}
          onRemove={() => {
            setOcrHint(null);
            onPlateRemove();
          }}
        />
      </VerificationPhotoUploadSection>

      {ocrHint ? (
        <p className="ov-self-plate-status" role="status">
          {ocrHint}
        </p>
      ) : null}

      <div className="form-group mb-0 ov-self-serial-edit">
        <label htmlFor="ov-self-serial-input">Serial number *</label>
        <input
          id="ov-self-serial-input"
          ref={serialInputRef}
          type="text"
          className="input-field text-mono"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="Type serial from the plate"
          value={row.serialNumber}
          readOnly={disabled}
          onChange={e => onSerialChange(e.target.value)}
        />
        <p className="ov-self-serial-hint ov-self-serial-hint--muted" role="status">
          Type the serial from the plate, or tap an unused sticker.
        </p>
        <AvailableSerialList
          serials={availableSerials}
          disabled={disabled}
          onPick={serial => onSerialChange(serial)}
        />
      </div>

      {isRv && onYearChange ? (
        <div className="ov-self-serial-year">
          <span className="ov-self-serial-year-label">
            Year of manufacturing <span className="verification-device-required">*</span>
          </span>
          <ManufacturingYearPicker
            value={row.manufacturingYear}
            onChange={onYearChange}
            disabled={disabled}
          />
        </div>
      ) : null}

      {!hasPlate ? (
        <p className="ov-self-serial-hint ov-self-serial-hint--muted mb-0">
          Serial number plate photo is still required to continue.
        </p>
      ) : null}
    </div>
  );
}
