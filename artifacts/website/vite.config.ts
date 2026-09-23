import {
  createServer,
  defineConfig,
  loadEnv,
  type HtmlTagDescriptor,
  type Plugin,
} from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

/*
 * The public website. Same build shape as the three apps (see
 * admin-console/vite.config.ts for why PORT is only demanded by the dev and
 * preview servers), with one difference that matters: the page is rendered to
 * HTML at build time and ships **no JavaScript at all**.
 *
 * A marketing page is read, not used. Everything on it that moves -- the
 * section links, the FAQ, the phone menu -- is an anchor or a <details>, so
 * there is nothing for a script to do, and shipping React to a director on a
 * funeral-home office connection so that it can re-draw text already on the
 * screen would cost a second of their attention for nothing. React is how the
 * page is written; the visitor receives what it rendered.
 *
 * `vite dev` still renders it client-side from src/main.tsx, because that is
 * the fastest way to work on it.
 *
 * Build-time settings, all optional, all public (they end up in the HTML):
 *
 *   VITE_SITE_URL       https://holdingtoday.example -- the canonical URL,
 *                       og:url, absolute og:image, sitemap.xml and the
 *                       robots.txt Sitemap line. Unset: all of those are
 *                       left out rather than pointed somewhere wrong.
 *   VITE_CONSOLE_URL    The director console's origin. "Start a free trial"
 *                       and "Sign in" link there.
 *   VITE_CONTACT_EMAIL  Where "Talk to us" goes.
 *   VITE_PRIVACY_URL,   Where the footer's Privacy and Terms links go, once
 *   VITE_TERMS_URL      the documents in LEGAL/ have been through a lawyer.
 *                       Unset, the footer says they are in review and offers
 *                       them on request. See src/config.ts.
 */
const isBuild = process.argv.includes("build");
const rawPort = process.env.PORT;

if (!rawPort && !isBuild) {
  throw new Error(
    "PORT environment variable is required to start the dev or preview " +
      "server, but was not provided.",
  );
}

const port = rawPort ? Number(rawPort) : undefined;

if (port !== undefined && (Number.isNaN(port) || port <= 0)) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH || "/";
const root = path.resolve(import.meta.dirname);
const outDir = path.resolve(root, "dist/public");

/** Trailing slash stripped, so `${site}/og.png` is always one slash. */
function siteUrl(mode: string): string {
  const env = loadEnv(mode, root, "VITE_");
  return (env.VITE_SITE_URL ?? "").trim().replace(/\/+$/, "");
}

/* Same as the apps: preload the Latin font files so the first paint is set in
 * the real faces rather than re-flowing when they arrive. */
function preloadLatinFonts(): Plugin {
  return {
    name: "preload-latin-fonts",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        const base = basePath.endsWith("/") ? basePath : `${basePath}/`;
        return Object.keys(ctx.bundle ?? {})
          .filter((file) => /-latin-wght-normal-[\w-]+\.woff2$/.test(file))
          .map((file) => ({
            tag: "link",
            attrs: {
              rel: "preload",
              as: "font",
              type: "font/woff2",
              href: `${base}${file}`,
              crossorigin: "",
            },
            injectTo: "head" as const,
          }));
      },
    },
  };
}

/*
 * The head tags that need an absolute URL. A canonical or og:url pointing at
 * localhost, or at a guess, is worse than none: search engines and link
 * previews believe it. So they exist only when VITE_SITE_URL says where the
 * site lives.
 */
function absoluteMeta(): Plugin {
  let mode = "production";
  return {
    name: "absolute-meta",
    configResolved(config) {
      mode = config.mode;
    },
    transformIndexHtml() {
      const site = siteUrl(mode);
      if (!site) return [];
      const tags: HtmlTagDescriptor[] = [
        { tag: "link", attrs: { rel: "canonical", href: `${site}/` } },
        { tag: "meta", attrs: { property: "og:url", content: `${site}/` } },
        { tag: "meta", attrs: { property: "og:image", content: `${site}/og.png` } },
        { tag: "meta", attrs: { name: "twitter:image", content: `${site}/og.png` } },
      ];
      return tags.map((tag) => ({ ...tag, injectTo: "head" as const }));
    },
  };
}

/*
 * Render the page into dist/public/index.html, then take the script out.
 *
 * Runs after the client build has written its files, through a throwaway Vite
 * server in SSR mode so the same TSX, aliases and VITE_ variables apply. What
 * is left in assets/ is the stylesheet and the fonts.
 */
function prerender(): Plugin {
  let mode = "production";
  return {
    name: "prerender",
    apply: "build",
    configResolved(config) {
      mode = config.mode;
    },
    async closeBundle() {
      const server = await createServer({
        configFile: false,
        root,
        mode,
        logLevel: "error",
        appType: "custom",
        plugins: [react()],
        resolve: { alias: { "@": path.resolve(root, "src") } },
        server: { middlewareMode: true, hmr: false, ws: false },
      });

      let body: string;
      try {
        const entry = (await server.ssrLoadModule("/src/entry-server.tsx")) as {
          render: () => string;
        };
        body = entry.render();
      } finally {
        await server.close();
      }

      const indexPath = path.join(outDir, "index.html");
      const html = fs
        .readFileSync(indexPath, "utf8")
        .replace('<div id="root"></div>', `<div id="root">${body}</div>`)
        .replace(/\s*<script type="module"[^>]*><\/script>/g, "")
        .replace(/\s*<link rel="modulepreload"[^>]*>/g, "");
      if (!html.includes("<main")) {
        throw new Error("prerender: the rendered page has no <main>; refusing to ship an empty site.");
      }
      fs.writeFileSync(indexPath, html);

      const assets = path.join(outDir, "assets");
      for (const file of fs.readdirSync(assets)) {
        if (file.endsWith(".js")) fs.rmSync(path.join(assets, file));
      }

      const site = siteUrl(mode);
      const robots = ["User-agent: *", "Allow: /"];
      if (site) {
        robots.push("", `Sitemap: ${site}/sitemap.xml`);
        fs.writeFileSync(
          path.join(outDir, "sitemap.xml"),
          `<?xml version="1.0" encoding="UTF-8"?>\n` +
            `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
            `  <url><loc>${site}/</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>\n` +
            `</urlset>\n`,
        );
      }
      fs.writeFileSync(path.join(outDir, "robots.txt"), robots.join("\n") + "\n");

      const env = loadEnv(mode, root, "VITE_");
      for (const name of ["VITE_SITE_URL", "VITE_CONSOLE_URL", "VITE_CONTACT_EMAIL"]) {
        if (!env[name]?.trim()) {
          this.warn(`${name} is not set; the page is built without it (see vite.config.ts).`);
        }
      }
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    preloadLatinFonts(),
    absoluteMeta(),
    prerender(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root,
  build: {
    outDir,
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
