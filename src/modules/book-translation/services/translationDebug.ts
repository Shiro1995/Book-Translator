// Toggle this to enable timing logs for both FE and BE translation flows.
// When enabled, FE prints console timing and sends a debug header so BE logs timing too.
export const ENABLE_TRANSLATION_TIMING_DEBUG = true;
export const TRANSLATION_TIMING_DEBUG_HEADER = "X-Debug-Translation-Timing";

export function isTranslationTimingDebugEnabled() {
  return ENABLE_TRANSLATION_TIMING_DEBUG;
}
