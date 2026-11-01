import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const DEV_URL = "http://localhost:5173/";
/** Where the production build is hosted; override with SITE_URL (e.g. in CI or a .env file). */
const DEFAULT_SITE_URL = "https://asshik-here.github.io/smart-object-inspector/";

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

/** The Trimble Connect extension manifest; its URLs must be absolute. */
const manifest = (siteUrl: string) =>
  JSON.stringify(
    {
      title: "Smart Object Inspector",
      description: "Find rebar in the model and show Tekla-style bar labels and spacing dimensions in 3D.",
      icon: new URL("icon.svg", siteUrl).href,
      url: new URL("index.html", siteUrl).href,
      extensionType: ["3dviewer"],
      type: "panel",
      enabled: true,
    },
    null,
    2,
  );

/**
 * Serves manifest.json pointing at localhost under `npm run dev`, and writes one pointing at the
 * hosted site into the production build, so the same project works for both.
 */
function extensionManifest(siteUrl: string): Plugin {
  return {
    name: "soi-manifest",
    configureServer(server) {
      server.middlewares.use("/manifest.json", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(manifest(DEV_URL));
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "manifest.json", source: manifest(siteUrl) });
    },
  };
}

// Trimble Connect loads the extension in an iframe and fetches manifest.json cross-origin.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const siteUrl = (env.SITE_URL || DEFAULT_SITE_URL).replace(/\/?$/, "/");
  return {
    plugins: [react(), debugDump(), extensionManifest(siteUrl)],
    base: "./",
    server: { port: 5173, strictPort: true, cors: true },
    preview: { port: 5173, strictPort: true, cors: true },
  };
});
