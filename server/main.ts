import { join, extname } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { apiGet, apiPost } from "./api.ts";
import { setSetting, getSetting } from "./store.ts";
import { PROVIDER_PRESETS } from "./ai.ts";
import "katex"; // side-effect import: ensures node_modules/katex exists for static /vendor/katex serving

const PORT = Number(Deno.env.get("PORT") || 3000) || 3000;
const ROOT = join(import.meta.dirname ?? ".", "..");
const PUBLIC = join(ROOT, "public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

async function handleApi(req: Request, url: URL): Promise<Response> {
  const path = url.pathname.replace(/^\/api\//, "").replace(/\/+$/, "");
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

  try {
    // settings update
    if (req.method === "PUT" && path === "settings") {
      const body = await req.json() as Record<string, unknown>;
      for (const [k, v] of Object.entries(body)) {
        if (["providerId", "baseUrl", "model"].includes(k) && typeof v === "string") setSetting(k, v);
        if (k === "apiKey" && typeof v === "string" && !v.startsWith("••")) setSetting("apiKey", v);
      }
      return json({ ok: true });
    }

    const routeTable = req.method === "GET" ? apiGet : req.method === "POST" ? apiPost : null;
    if (routeTable) {
      // match static routes first, then dynamic ones like documents/:id/regenerate
      for (const [pattern, handler] of Object.entries(routeTable)) {
        const patternParts = pattern.split("/");
        const pathParts = path.split("/");
        if (patternParts.length !== pathParts.length) continue;
        const params: Record<string, string> = {};
        let matched = true;
        for (let i = 0; i < patternParts.length; i++) {
          if (patternParts[i].startsWith(":")) params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
          else if (patternParts[i] !== pathParts[i]) { matched = false; break; }
        }
        if (matched) return json(await handler(req, params));
      }
    }

    return json({ error: `Not found: ${req.method} /api/${path}` }, 404);
  } catch (e) {
    console.error(`[api] ${req.method} /api/${path} failed:`, e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
}

function serveStatic(url: URL): Response {
  // Vendored libs served straight from node_modules (e.g. KaTeX css/js/fonts)
  if (url.pathname.startsWith("/vendor/")) {
    const rel = url.pathname.slice("/vendor/".length);
    if (rel.includes("..") || rel.includes("\\")) return new Response("Not found", { status: 404 });
    const vendorPath = join(ROOT, "node_modules", rel);
    if (!existsSync(vendorPath)) return new Response("Not found", { status: 404 });
    const vType = MIME[extname(vendorPath)] ?? "application/octet-stream";
    return new Response(readFileSync(vendorPath), { headers: { "Content-Type": vType, "Cache-Control": "no-cache" } });
  }
  let file = url.pathname === "/" ? "/index.html" : url.pathname;
  // SPA-ish fallback for clean routes
  if (!existsSync(join(PUBLIC, file)) && !extname(file)) file = "/index.html";
  const filePath = join(PUBLIC, file);
  if (!existsSync(filePath)) return new Response("Not found", { status: 404 });
  const type = MIME[extname(filePath)] ?? "application/octet-stream";
  return new Response(readFileSync(filePath), {
    headers: { "Content-Type": type, "Cache-Control": "no-cache" },
  });
}

Deno.serve({ port: PORT }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) return await handleApi(req, url);
  if (url.pathname === "/health") return new Response("ok");
  return serveStatic(url);
});

console.log(`
  StudyForge is running!
  ──────────────────────
  Open  http://localhost:${PORT}  in your browser.

  Data:  ~/.studyforge
  First step: open Settings and add an API key
  (OpenCode Zen / OpenRouter free models, OpenAI, Claude, Gemini, Ollama...).
`);
