import { useEffect, useState } from 'react';
import type { PasBankVerifyOptions } from '../lib/pasSerialBank';
import type { Product } from '../types';

export type PasSerialHint = { tone: 'ok' | 'err' | 'muted'; text: string };

/** Manual serial hint only — no PAS/GAS number-bank membership check. */
export function usePasSerialHint(
  serial: string,
  product: Product | null | undefined,
  enabled: boolean,
  _options?: PasBankVerifyOptions,
): PasSerialHint | null {
  void _options;
  const [hint, setHint] = useState<PasSerialHint | null>(null);

  useEffect(() => {
    if (!enabled || !product) {
      setHint(null);
      return;
    }
    const trimmed = serial.trim();
    setHint({
      tone: 'muted',
      text: trimmed
        ? 'Serial entered. Plate photo still required to continue.'
        : 'Type the serial from the plate.',
    });
  }, [enabled, product, serial]);

  return hint;
}
