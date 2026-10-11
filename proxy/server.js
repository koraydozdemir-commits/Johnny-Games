import express from "express";
import { createServer } from "node:http";
import { createBareServer } from "@tomphttp/bare-server-node";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const directory = dirname(fileURLToPath(import.meta.url));
const port = Number.parseInt(process.env.PORT || "3000", 10);
const publicDirectory = join(directory, "public");

// Bare blocks private and non-routable IP destinations by default, including
// DNS results, which prevents the proxy from reaching Render's internal network.
const bare = createBareServer("/bare/");
const app = express();
app.disable("x-powered-by");
app.use((_, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  next();
});

app.get("/health", (_, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.json({ ok: true, service: "johnny-games-ultraviolet" });
});

app.get("/frog/uv.config.js", (_, response) => {
  response.sendFile(join(publicDirectory, "uv.config.js"));
});

app.use("/frog", express.static(uvPath, { fallthrough: false, immutable: true, maxAge: "1h" }));
app.use(express.static(publicDirectory, { index: "index.html", maxAge: "5m" }));

const server = createServer(app);

server.on("request", (request, response) => {
  if (bare.shouldRoute(request)) {
    void bare.routeRequest(request, response);
  } else {
    app(request, response);
  }
});

server.on("upgrade", (request, socket, head) => {
  if (bare.shouldRoute(request)) {
    void bare.routeUpgrade(request, socket, head);
  } else {
    socket.destroy();
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Johnny Games Ultraviolet listening on port ${port}`);
});

function shutdown() {
  server.close(() => {
    bare.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
