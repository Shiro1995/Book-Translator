/**
 * Web Server - serves the SPA and can optionally proxy /api/* to a separate backend API.
 */
import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import { createServer as createViteServer } from "vite";
import path from "path";

const PORT = Number(process.env.PORT ?? 3000);
const USE_TRANSLATION_SERVICE = (process.env.USE_TRANSLATION_SERVICE ?? "true") === "true";
const BACKEND_API_URL = (
  process.env.BACKEND_API_URL ??
  process.env.TRANSLATION_SERVICE_URL ??
  "http://127.0.0.1:8000"
).replace(/\/+$/, "");

function buildUpstreamUrl(requestPath: string) {
  return new URL(requestPath, `${BACKEND_API_URL}/`).toString();
}

function copyRequestHeaders(req: Request) {
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;

    const lowerKey = key.toLowerCase();
    if (lowerKey === "host" || lowerKey === "connection") continue;

    if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
      continue;
    }

    headers.set(key, value);
  }

  if (req.headers.host) {
    headers.set("x-forwarded-host", req.headers.host);
  }

  return headers;
}

async function proxyToTranslationService(req: Request, res: Response, next: NextFunction) {
  if (!USE_TRANSLATION_SERVICE) {
    next();
    return;
  }

  try {
    const upstreamResponse = await fetch(buildUpstreamUrl(req.originalUrl), {
      method: req.method,
      headers: copyRequestHeaders(req),
      body: req.method === "GET" || req.method === "HEAD" ? undefined : (req as unknown as BodyInit),
      duplex: req.method === "GET" || req.method === "HEAD" ? undefined : "half",
    } as RequestInit & { duplex?: "half" });

    res.status(upstreamResponse.status);

    upstreamResponse.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey === "connection" ||
        lowerKey === "content-length" ||
        lowerKey === "content-encoding" ||
        lowerKey === "transfer-encoding"
      ) {
        return;
      }

      res.setHeader(key, value);
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    const responseBuffer = Buffer.from(await upstreamResponse.arrayBuffer());
    res.send(responseBuffer);
  } catch (error) {
    res.status(502).json({
      error: "Backend API unavailable",
      details: error instanceof Error ? error.message : "Unknown proxy error",
    });
  }
}

async function startServer() {
  const app = express();

  app.use("/api", proxyToTranslationService);

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
    console.log(
      `Web server running on http://localhost:${PORT} (${USE_TRANSLATION_SERVICE ? "SPA + API proxy" : "SPA only"})`,
    );
  });
}

void startServer();
