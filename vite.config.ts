import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Dev-only endpoint: the extension POSTs raw API responses to /__debug/<name>, which are written
 * to ./debug/<name>.json on this machine. Lets developers inspect real model data without screenshots.
 */
function debugDump(): Plugin {
  const dir = resolve(__dirname, "debug");
  return {
    name: "soi-debug-dump",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__debug/", (req, res) => {
        const name = (req.url ?? "").replace(/^\//, "").replace(/[^\w-]/g, "");
        if (req.method !== "POST" || !name) {
          res.statusCode = 404;
          res.end();
          return;
        }
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            mkdirSync(dir, { recursive: true });
            writeFileSync(resolve(dir, `${name}.json`), JSON.stringify(JSON.parse(body), null, 2));
            res.end("ok");
          } catch (err) {
            res.statusCode = 400;
            res.end(String(err));
          }
        });
      });
    },
  };
}

// Trimble Connect loads the extension in an iframe and fetches manifest.json cross-origin.
export default defineConfig({
  plugins: [react(), debugDump()],
  base: "./",
  server: { port: 5173, strictPort: true, cors: true },
  preview: { port: 5173, strictPort: true, cors: true },
});
