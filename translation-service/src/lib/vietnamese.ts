/**
 * Vietnamese diacritic validation.
 * Extracted from server.ts for reuse.
 */

const VIETNAMESE_DIACRITIC_REGEX =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi;

export function isVietnameseTarget(targetLang: string) {
  const normalized = targetLang.trim().toLowerCase();
  return normalized.includes("vietnamese") || normalized.includes("tiếng việt");
}

/**
 * Returns true if the text looks like Vietnamese but is missing diacritics,
 * which indicates an encoding/pipeline issue rather than a model issue.
 */
export function looksLikeVietnameseMissingDiacritics(text: string) {
  const normalized = text.normalize("NFC");
  const letters = normalized.match(/[A-Za-zÀ-ỹĐđ]/g)?.length ?? 0;

  // Too short to judge reliably
  if (letters < 80) return false;

  const diacriticChars = normalized.match(VIETNAMESE_DIACRITIC_REGEX)?.length ?? 0;
  const ratio = diacriticChars / letters;

  return ratio < 0.035;
}
