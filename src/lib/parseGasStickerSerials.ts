export type ParseGasStickerSerialsResult = {
  /** Deduped serials ready for the GAS allotment bank. Any non-empty token. */
  valid: string[];
  /** Always empty — format is unrestricted; kept for call-site compat. */
  invalid: string[];
};

/**
 * Split pasted sticker text on commas / whitespace / newlines.
 * Trim, uppercase, dedupe. Drop only empty tokens. No G/X / YJ format gate.
 */
export function parseGasStickerSerials(raw: unknown): ParseGasStickerSerialsResult {
  const text = String(raw ?? '');
  const tokens = text
    .split(/[\s,;]+/)
    .map(token => token.trim())
    .filter(Boolean);

  const valid: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    const serial = token.toUpperCase();
    if (seen.has(serial)) continue;
    seen.add(serial);
    valid.push(serial);
  }

  return { valid, invalid: [] };
}
