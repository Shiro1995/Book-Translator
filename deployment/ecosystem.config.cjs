// PM2 Ecosystem Config for Book-Translator
// Usage: pm2 start ecosystem.config.cjs
// Reload: pm2 reload ecosystem.config.cjs
// Status: pm2 status
// Logs: pm2 logs

module.exports = {
  apps: [
    {
      name: "web-server",
      script: "server.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      cwd: "/root/Book-Translator",  // TODO: adjust to your deploy path
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        USE_TRANSLATION_SERVICE: "true",
        TRANSLATION_SERVICE_URL: "http://127.0.0.1:3100",
      },
      instances: 1,
      max_memory_restart: "300M",
      restart_delay: 3000,
      max_restarts: 10,
      watch: false,
      error_file: "/root/Book-Translator/logs/web-server-error.log",
      out_file: "/root/Book-Translator/logs/web-server-out.log",
      merge_logs: true,
      time: true,
    },
    {
      name: "translation-service",
      script: "src/server.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      cwd: "/root/Book-Translator/translation-service",  // TODO: adjust
      env: {
        NODE_ENV: "production",
        PORT: 3100,
        TRANSLATION_PROVIDER: "cliproxy",
        // Keep CLIPROXY_BASE_URL / CLIPROXY_API_KEY / CLIPROXY_MODEL in the
        // translation-service .env file or inject them from your process manager.
        QUEUE_CONCURRENCY: 2,
        CACHE_TTL_SECONDS: 3600,
        CACHE_MAX_SIZE: 500,
        LOG_LEVEL: "info",
      },
      instances: 1,
      max_memory_restart: "500M",
      restart_delay: 3000,
      max_restarts: 10,
      watch: false,
      error_file: "/root/Book-Translator/logs/translation-service-error.log",
      out_file: "/root/Book-Translator/logs/translation-service-out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
