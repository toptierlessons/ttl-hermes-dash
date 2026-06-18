import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const BACKEND = process.env.HERMES_DASHBOARD_URL ?? "http://127.0.0.1:9119";

/**
 * In production the Python `hermes dashboard` server injects a one-shot
 * session token into `index.html`. The Vite dev server serves its own
 * `index.html`, so unless we forward that token, every protected `/api/*`
 * call 401s.
 *
 * This plugin fetches the running dashboard's `index.html` on each dev page
 * load, scrapes the `window.__HERMES_SESSION_TOKEN__` assignment, and
 * re-injects it into the dev HTML. Ported from `web/vite.config.ts`.
 */
function hermesDevToken(): Plugin {
  const TOKEN_RE = /window\.__HERMES_SESSION_TOKEN__\s*=\s*"([^"]+)"/;
  const AUTH_RE = /window\.__HERMES_AUTH_REQUIRED__\s*=\s*(true|false)/;

  return {
    name: "hermes:dev-session-token",
    apply: "serve",
    async transformIndexHtml() {
      try {
        const res = await fetch(BACKEND, { headers: { accept: "text/html" } });
        const html = await res.text();
        const match = html.match(TOKEN_RE);
        if (!match) {
          console.warn(
            `[hermes] Could not find session token in ${BACKEND} — ` +
              `is the dashboard running in loopback mode? /api calls will 401.`,
          );
          return;
        }
        const authMatch = html.match(AUTH_RE);
        const authJs = authMatch ? authMatch[1] : "false";
        return [
          {
            tag: "script",
            injectTo: "head",
            children:
              `window.__HERMES_SESSION_TOKEN__="${match[1]}";` +
              `window.__HERMES_AUTH_REQUIRED__=${authJs};`,
          },
        ];
      } catch (err) {
        console.warn(
          `[hermes] Dashboard at ${BACKEND} unreachable — ` +
            `set HERMES_DASHBOARD_URL or start the tunnel. ` +
            `(${(err as Error).message})`,
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), hermesDevToken()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: BACKEND,
        ws: true,
        changeOrigin: true,
        // Rewrite the gated-mode session cookie (hermes_session_at) to the dev
        // origin so the browser stores and resends it through the proxy.
        cookieDomainRewrite: "",
      },
      // Gated-mode auth endpoints live outside /api.
      "/auth": {
        target: BACKEND,
        changeOrigin: true,
        cookieDomainRewrite: "",
      },
    },
  },
});
