import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin";

/*
 * PORT is a dev-and-preview-server concern, so it is only demanded when one of
 * those is actually being started. Required unconditionally — as it was here —
 * it means `pnpm run build` at the workspace root fails on a missing variable
 * that the build neither uses nor could use. The other three apps in this
 * workspace already do it this way; this package was added without the fix and
 * broke the root build, which CI was papering over by setting PORT and
 * BASE_PATH for its build step.
 *
 * The check cannot be deferred to where the value is read: vite resolves server
 * options during a build too, so a lazy getter still fires. Hence the argv
 * sniff, which is ugly but is the thing that is actually true — the command
 * decides whether a port is needed.
 *
 * BASE_PATH defaults to "/", matching its siblings.
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

export default defineConfig({
  base: basePath,
  plugins: [
    mockupPreviewPlugin(),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
