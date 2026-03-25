<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Book-Translator

The repo runs as two processes:

1. Root web server on `:3000` for the SPA.
2. Backend API on its own port/project for translation, document parsing, and async jobs.

## Local Run

Prerequisites: Node.js 20+

1. Install root dependencies:
   `npm install`
2. If you also run the backend locally from this repo copy, install its dependencies:
   `cd translation-service && npm install`
3. Copy and edit env files:
   `./.env.example`
   `./translation-service/.env.example`
4. Point the root app to your backend project in `./.env`:
   `BACKEND_API_URL=http://127.0.0.1:8000`
5. If you run the backend locally from this repo copy, start it:
   `cd translation-service && npm run dev`
6. Start the web server:
   `npm run dev`

For local single-origin development, keep `USE_TRANSLATION_SERVICE=true` so the root server proxies `/api/*` to `BACKEND_API_URL`.

## Production Notes

- Run the root web server and your backend API as separate processes.
- Configure `CLIPROXY_BASE_URL`, `CLIPROXY_API_KEY`, and `CLIPROXY_MODEL` only in environment variables or secret storage.
- `deployment/ecosystem.config.cjs` contains a PM2 starter config for both processes.
- `deployment/nginx.conf` can still route `/api/*` directly to the backend API if you prefer Nginx split routing.
