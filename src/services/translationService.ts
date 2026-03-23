import { GoogleGenAI } from "@google/genai";
import { TranslationSettings } from "../types";

export class TranslationService {
  private ai: GoogleGenAI;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY || "";
    this.ai = new GoogleGenAI({ apiKey });
  }

  async translatePage(text: string, settings: TranslationSettings): Promise<string> {
    const model = "gemini-3.1-pro-preview";
    
    const prompt = `
      You are a professional book translator. Translate the following text from ${settings.sourceLang || 'auto-detect'} to ${settings.targetLang}.
      
      STYLE: ${settings.style}
      GLOSSARY/TERMINOLOGY: ${settings.glossary || 'None'}
      ADDITIONAL INSTRUCTIONS: ${settings.instructions || 'None'}
      
      TEXT TO TRANSLATE:
      ---
      ${text}
      ---
      
      Return ONLY the translated text. Do not include any explanations or metadata.
    `;

    try {
      const response = await this.ai.models.generateContent({
        model,
        contents: [{ parts: [{ text: prompt }] }],
      });
      return response.text || "Translation failed.";
    } catch (error) {
      console.error("Gemini Translation Error:", error);
      throw error;
    }
  }
}

export const translationService = new TranslationService();
