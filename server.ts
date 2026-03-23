import "dotenv/config";
import express, { type Request, type RequestHandler, type Response } from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import multer from "multer";
import fs from "fs";
import { promises as fsPromises } from "fs";
import mammoth from "mammoth";

const PORT = Number(process.env.PORT ?? 3000);
const UPLOAD_DIR = "uploads";
const N8N_WEBHOOK_URL =
  process.env.N8N_WEBHOOK_URL ??
  "https://rosily-gung-greta.ngrok-free.dev/webhook/send-message";
const N8N_AUTH_TOKEN = process.env.N8N_AUTH_TOKEN ?? "abcxyz_2026";
const WEBHOOK_TIMEOUT_MS = Number(process.env.N8N_TIMEOUT_MS ?? 60000);

const upload = multer({ dest: `${UPLOAD_DIR}/` });
const uploadSingle = upload.single("file") as unknown as RequestHandler;

type RequestWithFile = Request & {
  file?: Express.Multer.File;
};

type TranslationStyle = "natural" | "literal" | "literary" | "academic";

interface TranslationSettings {
  model: string;
  sourceLang: string;
  targetLang: string;
  style: TranslationStyle;
  glossary: string;
  instructions: string;
}

interface TranslationRequestBody {
  text?: string;
  settings?: Partial<TranslationSettings>;
  pageId?: number;
  bookName?: string;
}

const VIETNAMESE_DIACRITIC_REGEX =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi;

function isVietnameseTarget(targetLang: string) {
  const normalized = targetLang.trim().toLowerCase();
  return normalized.includes("vietnamese") || normalized.includes("tiếng việt");
}

function looksLikeVietnameseMissingDiacritics(text: string) {
  const normalized = text.normalize("NFC");
  const letters = normalized.match(/[A-Za-zÀ-ỹĐđ]/g)?.length ?? 0;
  if (letters < 80) {
    return false;
  }

  const diacriticChars = normalized.match(VIETNAMESE_DIACRITIC_REGEX)?.length ?? 0;
  const ratio = diacriticChars / letters;
  return ratio < 0.035;
}

if (!fs.existsSync(`${UPLOAD_DIR}/`)) {
  fs.mkdirSync(`${UPLOAD_DIR}/`, { recursive: true });
}

function splitTextIntoPages(text: string, pageSize = 2000) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const pages: string[] = [];

  for (let index = 0; index < normalized.length; index += pageSize) {
    pages.push(normalized.slice(index, index + pageSize));
  }

  return pages.length > 0 ? pages : [""];
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function getProductionWebhookUrl(url: string) {
  if (!url.includes("/webhook-test/")) {
    return null;
  }

  return url.replace("/webhook-test/", "/webhook/");
}

async function postToWebhook(url: string, payload: object) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Authorization": N8N_AUTH_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });
}

async function postToWebhookWithBearer(url: string, payload: object) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${N8N_AUTH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });
}

function extractTranslatedText(payload: unknown, depth = 0): string | null {
  if (depth > 5 || payload == null) {
    return null;
  }

  if (typeof payload === "string") {
    const trimmed = payload.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const candidate = extractTranslatedText(item, depth + 1);
      if (candidate) {
        return candidate;
      }
    }
    return null;
  }

  if (typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const preferredKeys = [
    "translatedText",
    "translation",
    "translated_text",
    "output",
    "result",
    "text",
    "content",
    "message",
    "data",
  ];

  for (const key of preferredKeys) {
    if (!(key in record)) {
      continue;
    }

    const candidate = extractTranslatedText(record[key], depth + 1);
    if (candidate) {
      return candidate;
    }
  }

  for (const value of Object.values(record)) {
    const candidate = extractTranslatedText(value, depth + 1);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

async function handleParseDocx(req: RequestWithFile, res: Response) {
  const uploadedFile = req.file;

  if (!uploadedFile) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  try {
    const buffer = await fsPromises.readFile(uploadedFile.path);
    const result = await mammoth.extractRawText({ buffer });
    const pages = splitTextIntoPages(result.value);

    return res.json({
      name: uploadedFile.originalname,
      size: uploadedFile.size,
      pages: pages.map((content, index) => ({
        id: index + 1,
        originalText: content,
        translatedText: "",
        status: "idle",
      })),
    });
  } catch (error) {
    console.error("DOCX parse error:", error);
    return res.status(500).json({ error: "Failed to parse DOCX" });
  } finally {
    await fsPromises.unlink(uploadedFile.path).catch(() => undefined);
  }
}

async function handleTranslate(req: Request<object, object, TranslationRequestBody>, res: Response) {
  const text = req.body?.text?.trim();

  if (!text) {
    return res.status(400).json({ error: "Missing text to translate" });
  }

  const settings: TranslationSettings = {
    model: req.body?.settings?.model?.trim() || "gemini-2.5-pro",
    sourceLang: req.body?.settings?.sourceLang?.trim() || "auto-detect",
    targetLang: req.body?.settings?.targetLang?.trim() || "Vietnamese",
    style: req.body?.settings?.style ?? "natural",
    glossary: req.body?.settings?.glossary?.trim() ?? "",
    instructions: req.body?.settings?.instructions?.trim() ?? "",
  };

  const instructionsForRequest = [
    settings.instructions,
    isVietnameseTarget(settings.targetLang)
      ? "Bắt buộc xuất tiếng Việt có đầy đủ dấu (dấu thanh và ký tự ă â ê ô ơ ư đ). Không được viết tiếng Việt không dấu."
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const webhookPayload = {
    text,
    model: settings.model,
    sourceLang: settings.sourceLang,
    targetLang: settings.targetLang,
    style: settings.style,
    glossary: settings.glossary,
    instructions: instructionsForRequest,
    pageId: req.body?.pageId ?? null,
    bookName: req.body?.bookName ?? null,
  };

  try {
    let response = await postToWebhook(N8N_WEBHOOK_URL, webhookPayload);
    let effectiveWebhookUrl = N8N_WEBHOOK_URL;
    console.log("Forwarding translation to webhook:", effectiveWebhookUrl);
    console.log("Webhook status:", response.status);

    if (response.status === 401 || response.status === 403) {
      response = await postToWebhookWithBearer(effectiveWebhookUrl, webhookPayload);
      console.log("Retrying webhook with Bearer auth, status:", response.status);
    }

    if (response.status === 404) {
      const productionWebhookUrl = getProductionWebhookUrl(N8N_WEBHOOK_URL);

      if (productionWebhookUrl) {
        response = await postToWebhook(productionWebhookUrl, webhookPayload);
        effectiveWebhookUrl = productionWebhookUrl;

        if (response.status === 401 || response.status === 403) {
          response = await postToWebhookWithBearer(effectiveWebhookUrl, webhookPayload);
          console.log("Retrying production webhook with Bearer auth, status:", response.status);
        }
      }
    }

    const rawBody = await response.text();
    const parsedBody = safeJsonParse(rawBody);

    if (!response.ok) {
      const n8nDetails =
        extractTranslatedText(parsedBody) ??
        rawBody.slice(0, 500) ??
        `HTTP ${response.status}`;
      const isWebhookNotRegistered =
        response.status === 404 &&
        typeof n8nDetails === "string" &&
        n8nDetails.toLowerCase().includes("not registered");

      return res.status(502).json({
        error: isWebhookNotRegistered
          ? "n8n webhook is not active or not registered"
          : "n8n webhook returned an error",
        details: isWebhookNotRegistered
          ? "The n8n test URL only works right after clicking Execute workflow, and the production URL only works after the workflow is activated."
          : n8nDetails,
        status: response.status,
        webhookUrl: effectiveWebhookUrl,
      });
    }

    const translatedText = extractTranslatedText(parsedBody);

    if (!translatedText) {
      return res.status(502).json({
        error: "n8n webhook returned no translated text",
        details: typeof parsedBody === "string" ? parsedBody : parsedBody,
      });
    }

    if (isVietnameseTarget(settings.targetLang) && looksLikeVietnameseMissingDiacritics(translatedText)) {
      return res.status(502).json({
        code: "E_VIETNAMESE_DIACRITICS",
        error: "translated Vietnamese text appears to be missing diacritics",
        details:
          "Likely encoding/transcoding issue in n8n flow or downstream parser. Check UTF-8 handling in Webhook, HTTP Request, and Respond to Webhook nodes.",
      });
    }

    return res.json({
      translatedText,
    });
  } catch (error) {
    console.error("Translation webhook error:", error);
    return res.status(502).json({
      error: "Failed to reach translation webhook",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

async function startServer() {
  const app = express();

  app.use(express.json({ limit: "5mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      webhookConfigured: Boolean(N8N_WEBHOOK_URL),
    });
  });

  app.post("/api/parse-docx", uploadSingle, (req, res) => {
    void handleParseDocx(req as RequestWithFile, res);
  });

  app.post("/api/translate", (req, res) => {
    void handleTranslate(req, res);
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      configFile: path.join(process.cwd(), "vite.config.ts"),
      root: process.cwd(),
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Translation webhook: ${N8N_WEBHOOK_URL}`);
  });
}

void startServer();
