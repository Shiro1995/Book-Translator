const LIKELY_MOJIBAKE_PATTERN =
  /(\u00C3.|\u00C2.|\u00C6.|\u00C4.|\u00C5.|\u00E1\u00BA|\u00E1\u00BB|\u00E2\u20AC|\u00E2\u20AC\u2122|\u00E2\u20AC\u0153|\u00E2\u20AC\u009D)/;
const SPACING_VIETNAMESE_MARKS_PATTERN =
  /([AEIOUYaeiouy][\u0300-\u036F]*)([\u005E\u02C6\u0028\u02D8\u002B\u0060\u00B4\u003F\u002E\u007E\u02CB\u02CA\u02DC]+)/g;
const D_BAR_PATTERN = /([Dd])-/g;

const BASE_COMBINING_MARK_MAP: Record<string, string> = {
  "^": "\u0302",
  "\u02c6": "\u0302",
  "(": "\u0306",
  "\u02d8": "\u0306",
  "+": "\u031b",
};

const TONE_COMBINING_MARK_MAP: Record<string, string> = {
  "\u00b4": "\u0301",
  "\u02ca": "\u0301",
  "`": "\u0300",
  "\u02cb": "\u0300",
  "?": "\u0309",
  "~": "\u0303",
  "\u02dc": "\u0303",
  ".": "\u0323",
};

const BASE_COMBINING_MARKS = new Set(["\u0302", "\u0306", "\u031b"]);
const TONE_COMBINING_MARKS = new Set([
  "\u0300",
  "\u0301",
  "\u0303",
  "\u0309",
  "\u0323",
]);

function normalizeVietnameseCluster(baseCluster: string, spacingMarks: string) {
  const decomposedCluster = baseCluster.normalize("NFD");
  const [baseChar = "", ...existingMarks] = Array.from(decomposedCluster);

  if (!baseChar) {
    return baseCluster;
  }

  let baseMark = "";
  let toneMark = "";
  const trailingMarks: string[] = [];

  const collectMark = (mark: string) => {
    if (BASE_COMBINING_MARKS.has(mark)) {
      if (!baseMark) {
        baseMark = mark;
      }
      return;
    }

    if (TONE_COMBINING_MARKS.has(mark)) {
      if (!toneMark) {
        toneMark = mark;
      }
      return;
    }

    trailingMarks.push(mark);
  };

  existingMarks.forEach(collectMark);

  Array.from(spacingMarks).forEach((mark) => {
    const mappedMark =
      BASE_COMBINING_MARK_MAP[mark] ?? TONE_COMBINING_MARK_MAP[mark] ?? mark;
    collectMark(mappedMark);
  });

  return `${baseChar}${baseMark}${toneMark}${trailingMarks.join("")}`;
}

function canonicalizeVietnameseTyping(value: string) {
  const withDBar = value.replace(D_BAR_PATTERN, (_, letter: string) =>
    letter === "D" ? "\u0110" : "\u0111",
  );

  return withDBar.normalize("NFD").replace(
    SPACING_VIETNAMESE_MARKS_PATTERN,
    (match, baseCluster: string, marks: string) =>
      normalizeVietnameseCluster(baseCluster, marks) || match,
  );
}

export function repairLikelyMojibake(value: string) {
  if (!LIKELY_MOJIBAKE_PATTERN.test(value)) {
    return value;
  }

  try {
    const bytes = Uint8Array.from(value, (ch) => ch.charCodeAt(0) & 0xff);
    const recovered = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return recovered.includes("\uFFFD") ? value : recovered;
  } catch {
    return value;
  }
}

export function normalizeUserFacingText(value: string) {
  if (!value) {
    return "";
  }

  let normalized = repairLikelyMojibake(value);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = canonicalizeVietnameseTyping(normalized).normalize("NFC");

    if (next === normalized) {
      return next;
    }

    normalized = next;
  }

  return normalized.normalize("NFC");
}
