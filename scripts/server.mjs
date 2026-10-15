import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const host = "127.0.0.1";
const port = 8000;
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

http.createServer(async (request, response) => {
  let pathname;

  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${host}`).pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }

  if (pathname === "/") pathname = "/index.html";

  const file = path.resolve(root, `.${pathname}`);
  const relative = path.relative(root, file);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    if (!(await stat(file)).isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": mimeTypes[path.extname(file).toLowerCase()] || "application/octet-stream",
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(port, host);

