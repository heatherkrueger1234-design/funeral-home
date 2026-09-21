import http from "node:http";
import fs from "node:fs";
import path from "node:path";

/**
 * One built front end, served the way nginx serves it in production.
 *
 * The three SPAs call `/api` on their own origin, and everything about the
 * family's credential depends on that being true: the token travels as a
 * bearer header, the staff session as a same-site cookie, and neither works
 * the same way against a different origin. A test harness that pointed the
 * app at `http://localhost:4311/api` would be exercising a deployment
 * arrangement nobody runs and would sail past a whole class of bug.
 *
 * So this does what `deploy/nginx.conf.template` does and nothing else:
 * static files, `/api` proxied through, and any unknown path falling back to
 * `index.html` because a family opening a texted link lands deep in the app
 * on a path with no file behind it.
 *
 *   node serve.mjs <dist-dir> <port> <api-port>
 */

const [, , root, rawPort, rawApiPort] = process.argv;

if (!root || !rawPort || !rawApiPort) {
  console.error("usage: node serve.mjs <dist-dir> <port> <api-port>");
  process.exit(1);
}

if (!fs.existsSync(path.join(root, "index.html"))) {
  console.error(
    `No index.html in ${root}. Run \`pnpm run build\` before the end-to-end tests — ` +
      "they run against the real bundles rather than a dev server.",
  );
  process.exit(1);
}

const port = Number(rawPort);
const apiPort = Number(rawApiPort);

const TYPES = new Map(
  Object.entries({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".json": "application/json",
    ".woff2": "font/woff2",
    ".map": "application/json",
  }),
);

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";

  if (url.startsWith("/api/")) {
    const proxied = http.request(
      {
        host: "127.0.0.1",
        port: apiPort,
        path: url,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${apiPort}` },
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      },
    );

    proxied.on("error", (error) => {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(`api unreachable: ${error.message}`);
    });

    req.pipe(proxied);
    return;
  }

  // Resolved inside the dist directory or not at all: a path of ../../ is the
  // oldest trick there is and this process can read the whole repository.
  const requested = path.normalize(decodeURIComponent(url.split("?")[0]));
  const candidate = path.join(root, requested);
  const inside = candidate.startsWith(path.resolve(root));

  const file =
    inside && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
      ? candidate
      : path.join(root, "index.html");

  res.writeHead(200, {
    "content-type": TYPES.get(path.extname(file)) ?? "application/octet-stream",
  });
  fs.createReadStream(file).pipe(res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`serving ${root} on http://127.0.0.1:${port} (api :${apiPort})`);
});
