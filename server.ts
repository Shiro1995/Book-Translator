/**
 * Web Server — SPA only.
 * All API logic has been moved to translation-service.
 * This server only serves the frontend (Vite dev or static dist).
 */
import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";

const PORT = Number(process.env.PORT ?? 3000);

async function startServer() {
  const app = express();

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
    console.log(`Web server running on http://localhost:${PORT} (SPA only)`);
  });
}

void startServer();
