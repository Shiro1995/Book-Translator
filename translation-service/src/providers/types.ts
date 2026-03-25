import type { TranslateRequest, TranslateResponse } from "../types/index.js";

/**
 * Abstract interface for translation providers.
 * Implement this to add new providers (Gemini direct, OpenAI, local models, etc.)
 */
export interface TranslationProvider {
  readonly name: string;
  translate(request: TranslateRequest): Promise<TranslateResponse>;
}
