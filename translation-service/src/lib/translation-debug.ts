const ENABLED_DEBUG_VALUES = new Set(["1", "true", "yes", "on"]);

export const DEBUG_TRANSLATION_TIMING_HEADER = "x-debug-translation-timing";

export function isDebugTranslationTimingEnabled(value: string | string[] | undefined) {
  const normalizedValue = Array.isArray(value) ? value[0] : value;
  return typeof normalizedValue === "string" && ENABLED_DEBUG_VALUES.has(normalizedValue.toLowerCase());
}
