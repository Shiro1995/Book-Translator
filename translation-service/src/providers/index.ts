import { config } from "../config/index.js";
import { CliproxyChatCompletionsProvider } from "./cliproxy-chat-completions.js";
import type { TranslationProvider } from "./types.js";

export function createTranslationProvider(): TranslationProvider {
  switch (config.translationProvider) {
    case "cliproxy":
    default:
      return new CliproxyChatCompletionsProvider();
  }
}
