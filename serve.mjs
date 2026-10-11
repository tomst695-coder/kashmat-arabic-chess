import { createReadStream, promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const requestedRoot = process.argv[2] ? path.resolve(projectRoot, process.argv[2]) : projectRoot;
const root = path.resolve(requestedRoot);
const port = Number(process.env.PORT || 4173);
const types = new Map([
  [".html", "text/html; charset=utf-8"], [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"], [".svg", "image/svg+xml"],
  [".png", "image/png"], [".ico", "image/x-icon"]
]);

const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
    let file = path.resolve(root, `.${pathname}`);
    if (file !== root && !file.startsWith(root + path.sep)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const info = await fs.stat(file);
    if (info.isDirectory()) file = path.join(file, "index.html");
    const finalInfo = await fs.stat(file);
    response.writeHead(200, {
      "Content-Type": types.get(path.extname(file)) || "application/octet-stream",
      "Content-Length": finalInfo.size,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": path.basename(file) === "sw.js" ? "no-cache" : "no-store"
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => process.stdout.write(`Kashmat is available at http://localhost:${port}\n`));
