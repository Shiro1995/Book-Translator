import { describe, expect, it } from "vitest";
import {
  extractChatCompletionText,
  extractErrorMessage,
  extractTranslatedText,
} from "./extract.js";

describe("extract helpers", () => {
  it("extracts assistant content from a chat completions response", () => {
    expect(
      extractChatCompletionText({
        choices: [{ message: { content: "Ban dich" } }],
      }),
    ).toBe("Ban dich");
  });

  it("extracts text parts from array-based assistant content", () => {
    expect(
      extractTranslatedText({
        choices: [
          {
            message: {
              content: [
                { type: "text", text: "Xin " },
                { type: "text", text: "chao" },
              ],
            },
          },
        ],
      }),
    ).toBe("Xin chao");
  });

  it("prefers structured provider error messages", () => {
    expect(
      extractErrorMessage({
        error: {
          message: "Invalid API key",
        },
      }),
    ).toBe("Invalid API key");
  });
});
