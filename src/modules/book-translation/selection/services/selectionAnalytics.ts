import type { SelectionAnalyticsPayload } from "../types";

export type SelectionAnalyticsEventName =
  | "selection_created"
  | "mini_popup_shown"
  | "mini_popup_clicked"
  | "inspector_opened"
  | "default_tab_assigned"
  | "dictionary_lookup_started"
  | "dictionary_lookup_succeeded"
  | "dictionary_lookup_failed"
  | "ai_lookup_started"
  | "ai_lookup_succeeded"
  | "ai_lookup_failed"
  | "tab_switched"
  | "glossary_action_clicked"
  | "save_term_clicked"
  | "apply_translation_clicked"
  | "popup_closed";

export function trackSelectionAnalytics(
  eventName: SelectionAnalyticsEventName,
  payload: SelectionAnalyticsPayload,
) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("book-translation:selection-analytics", {
        detail: {
          eventName,
          payload,
          timestamp: Date.now(),
        },
      }),
    );
  }

  if (import.meta.env.DEV) {
    console.debug("[selection-analytics]", eventName, payload);
  }
}
