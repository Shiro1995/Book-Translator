import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import multer from "multer";
import fs from "fs";
import mammoth from "mammoth";

// We'll use a simple approach for PDF on client-side to avoid heavy server-side dependencies
// but DOCX is easier on server with mammoth.

const upload = multer({ dest: 'uploads/' });

// Ensure uploads directory exists
if (!fs.existsSync('uploads/')) {
  fs.mkdirSync('uploads/');
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API: Parse DOCX
  app.post("/api/parse-docx", upload.single('file'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      
      const buffer = fs.readFileSync(req.file.path);
      const result = await mammoth.extractRawText({ buffer });
      const text = result.value;
      
      // Split text into "pages" (approx 2000 chars per page for DOCX)
      const pageSize = 2000;
      const pages = [];
      for (let i = 0; i < text.length; i += pageSize) {
        pages.push(text.substring(i, i + pageSize));
      }

      // Cleanup
      fs.unlinkSync(req.file.path);

      res.json({
        name: req.file.originalname,
        size: req.file.size,
        pages: pages.map((content, index) => ({
          id: index + 1,
          originalText: content,
          translatedText: "",
          status: 'idle'
        }))
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to parse DOCX" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
