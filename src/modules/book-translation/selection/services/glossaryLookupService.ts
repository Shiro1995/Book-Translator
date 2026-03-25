import type { GlossaryEntry } from "../types";
import { detectSelectionLanguage, normalizeLookupText } from "../utils/selectionNormalization";

const GLOSSARY_SEPARATORS = ["->", "=>", ":", "=", "|"] as const;

function splitGlossaryLine(line: string) {
  for (const separator of GLOSSARY_SEPARATORS) {
    const index = line.indexOf(separator);
    if (index <= 0) {
      continue;
    }

    return {
      source: line.slice(0, index).trim(),
      target: line.slice(index + separator.length).trim(),
    };
  }

  return null;
}

export function parseGlossaryEntries(rawGlossary: string) {
  return rawGlossary
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parsed = splitGlossaryLine(line);
      if (!parsed || !parsed.source || !parsed.target) {
        return null;
      }

      const normalizedSourceTerm = normalizeLookupText(
        parsed.source,
        detectSelectionLanguage(parsed.source),
      );

      if (!normalizedSourceTerm) {
        return null;
      }

      return {
        id: `glossary-${index}-${normalizedSourceTerm}`,
        sourceTerm: parsed.source,
        targetTerm: parsed.target,
        normalizedSourceTerm,
        raw: line,
      } satisfies GlossaryEntry;
    })
    .filter((entry): entry is GlossaryEntry => Boolean(entry));
}

export function findExactGlossaryMatch(text: string, glossary: GlossaryEntry[]) {
  const normalized = normalizeLookupText(text);
  if (!normalized) {
    return null;
  }

  return glossary.find((entry) => entry.normalizedSourceTerm === normalized) ?? null;
}

export function findGlossaryCandidates(text: string, glossary: GlossaryEntry[]) {
  const normalized = normalizeLookupText(text);
  if (!normalized) {
    return [];
  }

  return glossary.filter(
    (entry) =>
      entry.normalizedSourceTerm === normalized ||
      entry.normalizedSourceTerm.includes(normalized) ||
      normalized.includes(entry.normalizedSourceTerm),
  );
}
