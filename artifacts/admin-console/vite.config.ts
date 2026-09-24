import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

/*
 * PORT is a dev-and-preview-server concern, so it is only demanded when one of
 * those is actually being started. It used to be required unconditionally,
 * which meant `vite build` — in CI, in a Dockerfile, on anyone's laptop —
 * failed on a missing variable that the build neither uses nor could use.
 *
 * The check cannot be deferred to where the value is read: vite resolves
 * server options during a build too, so a lazy getter still fires. Hence the
 * argv sniff, which is ugly but is the thing that is actually true — the
 * command decides whether a port is needed.
 *
 * BASE_PATH defaults to "/", which is what it is in every deployment where the
 * app owns its own hostname. Set it for the one case that differs: serving the
 * app under a path prefix.
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

/*
 * The two faces are self-hosted, and the browser only learns it needs them
 * once it has downloaded and parsed the stylesheet. By then the page has
 * painted in the fallback, and swapping in the real face re-flows every line
 * of text, which Lighthouse counts as layout shift and a reader sees as the
 * page twitching. Preloading the Latin files lets them start alongside the
 * stylesheet. Only Latin: the other subsets are fetched on demand, by
 * unicode-range, for the rare name that needs them.
 */
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

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    preloadLatinFonts(),
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
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
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
    // Local development against an api-server on another port; see preview.
    proxy: process.env.E2E_API_PROXY_TARGET
      ? {
          "/api": {
            target: process.env.E2E_API_PROXY_TARGET,
            changeOrigin: true,
          },
        }
      : undefined,
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    // Same escape hatch the other two front ends have: mirrors nginx's
    // `proxy_pass` so this console can be driven against a real api-server on
    // another port. Unset in every other context, including production.
    proxy: process.env.E2E_API_PROXY_TARGET
      ? {
          "/api": {
            target: process.env.E2E_API_PROXY_TARGET,
            changeOrigin: true,
          },
        }
      : undefined,
  },
});
